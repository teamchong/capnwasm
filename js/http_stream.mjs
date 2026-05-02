// HTTP streaming-response transport for capnwasm RPC.
//
// Shape: client makes one POST whose body is a batched envelope of initial
// frames (subscribe, call, etc.); server returns a streaming response body
// containing length-prefixed binary frames. The response stays open for as
// long as the server has events to push. When the client wants to stop,
// it aborts the fetch.
//
// What this transport supports:
//   • Subscriptions (server pushes events for a long time)
//   • Capability streams (capnp's stream methods. Chunks pushed by server)
//   • Progress / notification feeds
//
// What this transport does NOT support (use wsTransport for those):
//   • Multiple client→server calls after the initial batch. Fetch upload
//     streaming is HTTP/2-only and inconsistent across browsers, so this
//     transport is one-shot client→server.
//   • Capabilities returned from the server can be invoked WITHIN this
//     stream's lifetime, but those calls go out as part of a *new* POST
//     to the same endpoint. That's pipelining within a single subscription
//     boundary; cross-stream cap reuse isn't supported.
//
// Wire envelope (both directions): a sequence of length-prefixed frames.
//
//     [u32 LE length][frame bytes][u32 LE length][frame bytes]...
//
// Same envelope shape as http_batch.mjs; the difference is that http-stream
// keeps reading frames from the response body until it ends.

import { RpcSession } from "./rpc.mjs";

const MIME = "application/x-capnwasm-stream";

/* ------------------------------------------------------------------ */
/*  Frame walker over a stream                                        */
/* ------------------------------------------------------------------ */

// Greedily extract complete length-prefixed frames from a sliding buffer.
// Returns the unconsumed tail so the caller can keep prepending it to the
// next chunk that arrives.
function extractFrames(buf) {
  const out = [];
  let p = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (p + 4 <= buf.length) {
    const len = dv.getUint32(p, true);
    if (p + 4 + len > buf.length) break;
    out.push(buf.subarray(p + 4, p + 4 + len));
    p += 4 + len;
  }
  return { frames: out, rest: p === buf.length ? null : buf.subarray(p) };
}

function appendBuffer(prev, next) {
  if (!prev) return next;
  const out = new Uint8Array(prev.length + next.length);
  out.set(prev, 0);
  out.set(next, prev.length);
  return out;
}

function encodeBatch(frames) {
  let total = 0;
  for (const f of frames) total += 4 + f.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const f of frames) {
    dv.setUint32(p, f.length, true);
    p += 4;
    out.set(f, p);
    p += f.length;
  }
  return out;
}

function frameOne(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Client                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a Transport that sends an initial batch via HTTP POST and reads a
 * streaming response body for as long as the server keeps pushing frames.
 *
 * The first send() (or the burst of sends in the same microtask) becomes
 * the request body. Any sends after the request has been issued are
 * dropped. See the module comment for why fetch upload streaming isn't
 * a viable browser cross-target option.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {Function} [opts.fetch] - fetch impl (defaults to globalThis.fetch)
 * @param {object} [opts.headers] - extra headers on the POST
 * @param {AbortSignal} [opts.signal] - aborts the in-flight stream + closes
 */
export function httpStreamTransport(url, opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error("httpStreamTransport: no fetch available");
  const extraHeaders = opts.headers ?? {};
  const externalSignal = opts.signal;

  let messageCb = null;
  let closeCb = null;
  let outbox = [];
  let scheduled = false;
  let started = false;
  let closed = false;
  const ctrl = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort",
      () => ctrl.abort(externalSignal.reason), { once: true });
  }

  const fireClose = (err) => {
    if (closed) return;
    closed = true;
    try { ctrl.abort(); } catch {}
    const c = closeCb;
    closeCb = null;
    messageCb = null;
    outbox = [];
    if (c) c(err);
  };

  function scheduleStart() {
    if (scheduled || started || closed) return;
    scheduled = true;
    queueMicrotask(start);
  }

  async function start() {
    scheduled = false;
    if (started || closed || outbox.length === 0) return;
    started = true;
    const body = encodeBatch(outbox);
    outbox = [];
    let res;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": MIME, "Accept": MIME, ...extraHeaders },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      fireClose(err);
      return;
    }
    if (!res.ok) {
      fireClose(new Error(`HTTP ${res.status} ${res.statusText}`));
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) { fireClose(new Error("response has no readable body")); return; }
    let pending = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (closed) break;
        pending = appendBuffer(pending, value);
        const { frames, rest } = extractFrames(pending);
        pending = rest;
        for (const f of frames) {
          if (closed || !messageCb) return;
          messageCb(f);
        }
      }
    } catch (err) {
      fireClose(err);
      return;
    }
    fireClose();
  }

  return {
    send(bytes) {
      if (closed) return;
      if (started) return;       // post-initial sends ignored. See module doc
      outbox.push(new Uint8Array(bytes));
      scheduleStart();
    },
    onMessage(handler) { messageCb = handler; },
    onClose(handler) { closeCb = handler; },
    close() { fireClose(); },
  };
}

/**
 * One-line client helper: open a streaming session and resolve to a
 * connected RpcSession. Mirrors `connectWebSocket` / `connectHttpBatch`.
 */
export function connectHttpStream(cpp, url, opts = {}) {
  const transport = httpStreamTransport(url, opts);
  return new RpcSession(cpp, transport, opts.registry, {
    bootstrap: opts.bootstrap,
    // Client-side: this transport is one-shot client→server (only the
    // initial POST carries client frames). Finish/Release frames the
    // RpcSession would emit after the initial wave just get dropped by
    // the transport's `started` guard, so don't bother building them.
    stateless: true,
  });
}

/* ------------------------------------------------------------------ */
/*  Server                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a `fetch`-style handler that processes one HTTP streaming request.
 *
 * Same shape as createHttpBatchHandler but the response body is a
 * ReadableStream that stays open for the lifetime of the session. Outbound
 * frames produced by handlers (immediately or asynchronously over time)
 * are written into the stream as length-prefixed binary chunks.
 *
 * The session ends when:
 *   • The client aborts the request (most common. User navigates away,
 *     unsubscribes, or the AbortController fires).
 *   • All inbound calls have settled AND the user passes opts.endOnIdle:
 *     true. The default is to keep the stream open so subscription-style
 *     handlers can keep pushing.
 *
 * Handlers that want server push beyond the initial Return need to keep a
 * reference to the cap they were called from (or to the bootstrap target)
 * and emit further calls; those are queued for the response stream just
 * like initial Returns.
 *
 * @param {object} cpp - loaded CapnCpp
 * @param {InterfaceRegistry} registry
 * @param {object} [opts]
 * @param {object|Function} [opts.bootstrap] - bootstrap target or `(req) => target`
 * @param {boolean} [opts.endOnIdle=false] - close the stream once idle()
 */
export function createHttpStreamHandler(cpp, registry, opts = {}) {
  const endOnIdle = opts.endOnIdle === true;
  return async function handle(req) {
    if (req.method !== "POST") {
      return new Response("expected POST", { status: 405 });
    }
    const ct = req.headers.get("Content-Type") ?? "";
    if (!ct.includes(MIME) && !ct.includes("application/octet-stream")) {
      return new Response(`expected Content-Type: ${MIME}`, { status: 415 });
    }
    let bodyBytes;
    try {
      bodyBytes = new Uint8Array(await req.arrayBuffer());
    } catch (err) {
      return new Response(`bad request body: ${err.message ?? err}`, { status: 400 });
    }
    const { frames: initialFrames, rest } = extractFrames(bodyBytes);
    if (rest && rest.length > 0) {
      return new Response("malformed batch envelope", { status: 400 });
    }

    const bootstrap = typeof opts.bootstrap === "function"
      ? opts.bootstrap(req)
      : opts.bootstrap;

    let session;
    let messageCb = null;
    let streamController = null;
    let sessionClosed = false;

    const transport = {
      send(bytes) {
        if (sessionClosed || !streamController) return;
        try {
          streamController.enqueue(frameOne(bytes));
        } catch {
          sessionClosed = true;
        }
      },
      onMessage(handler) { messageCb = handler; },
      onClose() {},
      close() {},
    };

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        // Server-side: client is one-shot (no follow-up Finish frames
        // ever arrive), so we have nothing to release on the client's
        // behalf either. Skip Finish/Release generation.
        session = new RpcSession(cpp, transport, registry, { bootstrap, stateless: true });
        // Feed the initial batch synchronously so the first wave of Returns
        // is in the stream by the time the response head reaches the client.
        for (const f of initialFrames) {
          if (!messageCb) break;
          messageCb(f);
        }
        // If the caller asked to end-on-idle, watch for idle and close. The
        // default is to leave the stream open for subscription handlers
        // that keep pushing frames after the initial Returns are sent.
        if (endOnIdle) {
          const finish = () => {
            sessionClosed = true;
            try { session.close(); } catch {}
            try { controller.close(); } catch {}
          };
          session.idle().then(finish, finish);
        }
        // Client disconnect → session close. The browser firing AbortError
        // surfaces here as `cancel()` below, but if the underlying socket
        // closes without an explicit abort, ReadableStream calls cancel
        // too. Both paths land at the same teardown.
      },
      cancel(reason) {
        sessionClosed = true;
        try { session?.close(); } catch {}
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": MIME,
        // No buffering. Push frames straight to the wire as soon as they
        // hit controller.enqueue. Some proxies will buffer chunked-encoded
        // bodies otherwise (defeats the streaming).
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  };
}
