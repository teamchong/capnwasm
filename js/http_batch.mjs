// HTTP batch transport for capnwasm RPC.
//
// Stateless request/response transport: client batches outbound RPC frames
// into a single HTTP POST, server handles them all in one fresh RpcSession,
// returns the responses as the HTTP body, and the session is torn down.
//
// Use this when the browser-side shape is request → response with no need
// for server push. Each HTTP request is its own session, so capabilities
// returned by the server don't survive across requests (capnp Disposes /
// Releases for that session are processed inline before the response is
// sent). For server push (subscriptions, progress streams, capability
// streams that outlive a request), use wsTransport instead.
//
// Wire envelope: a sequence of length-prefixed frames.
//
//     [u32 LE length][frame bytes][u32 LE length][frame bytes]...
//
// Each "frame" is exactly what wsTransport sends/receives in one
// WebSocket message. I.e., a complete capnp RPC frame.
//
// Content-Type for both directions: application/x-capnwasm-batch.

import { RpcSession } from "./rpc.mjs";

const MIME = "application/x-capnwasm-batch";
const MIME_PACKED = "application/x-capnwasm-batch+packed";

/* ------------------------------------------------------------------ */
/*  Envelope helpers                                                  */
/* ------------------------------------------------------------------ */

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

function decodeBatch(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p < bytes.length) {
    if (p + 4 > bytes.length) throw new Error("HTTP batch: truncated length prefix");
    const len = dv.getUint32(p, true);
    p += 4;
    if (p + len > bytes.length) throw new Error("HTTP batch: truncated frame");
    out.push(bytes.subarray(p, p + len));
    p += len;
  }
  return out;
}

// Wrap a framed Cap'n Proto message in the inner u32 length prefix that
// RpcSession's FrameReader expects. Used after unpacking a packed-batch
// frame so the downstream RPC layer sees a uniformly framed buffer.
function prependU32Len(framed) {
  const out = new Uint8Array(4 + framed.length);
  new DataView(out.buffer).setUint32(0, framed.length, true);
  out.set(framed, 4);
  return out;
}

// rpc.capnp Message discriminants we care about on the client→server side.
// Layout: each capnp framed message starts with [u32 LE segment count - 1]
// + the segment-table; for a 1-segment Message the discriminant lives at
// byte 16 of the payload (8 B segment table + 8 B root pointer).
const RPC_FINISH = 4;
const RPC_RELEASE = 6;

// Walk a concatenated buffer of length-prefixed RPC frames (the shape
// RpcSession produces from #flush) and yield only frames whose discriminant
// is NOT in `dropKinds`. Returns a fresh Uint8Array containing the kept
// frames concatenated, or null if every frame was filtered out.
function filterFrames(bytes, dropKinds) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep = [];
  let p = 0;
  let total = 0;
  while (p + 4 <= bytes.length) {
    const len = dv.getUint32(p, true);
    if (p + 4 + len > bytes.length) break;
    const dOff = p + 4 + 16;
    const kind = dOff + 2 <= bytes.length ? dv.getUint16(dOff, true) : -1;
    if (!dropKinds.has(kind)) {
      const frame = bytes.subarray(p, p + 4 + len);
      keep.push(frame);
      total += frame.length;
    }
    p += 4 + len;
  }
  if (keep.length === 0) return null;
  if (keep.length === 1 && keep[0].length === bytes.length) return bytes;
  const out = new Uint8Array(total);
  let q = 0;
  for (const f of keep) { out.set(f, q); q += f.length; }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Client                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a Transport that sends RPC frames via HTTP POST and delivers the
 * server's response frames back to the session.
 *
 * Outbound frames are coalesced per microtask boundary, so a burst of
 * `cap.foo()` / `cap.bar()` calls in the same tick produces one HTTP
 * request. The microtask batching means typical client code "just works"
 *. No manual `flush()` needed.
 *
 * @param {string} url - the gateway endpoint
 * @param {object} [opts]
 * @param {Function} [opts.fetch] - fetch implementation (defaults to globalThis.fetch)
 * @param {object} [opts.headers] - extra HTTP headers (e.g., auth)
 * @param {AbortSignal} [opts.signal] - aborts in-flight requests + closes the transport
 * @param {boolean} [opts.packed] - enable Cap'n Proto packed-encoding for every
 *        frame in the batch. Both ends must agree. The transport tags the
 *        Content-Type as `application/x-capnwasm-batch+packed` and the
 *        server handler auto-detects.
 * @param {object} [opts.cpp] - required when `packed` is true. Provides
 *        the wasm-backed `packMessage` / `unpackMessage` helpers.
 * @returns {{ send: Function, onMessage: Function, onClose: Function, close: Function }}
 */
export function httpBatchTransport(url, opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error("httpBatchTransport: no fetch available");
  const extraHeaders = opts.headers ?? {};
  const signal = opts.signal;
  const packed = !!opts.packed;
  const cpp = opts.cpp;
  if (packed && !cpp) {
    throw new Error("httpBatchTransport: opts.packed requires opts.cpp (load capnwasm)");
  }
  const mime = packed ? MIME_PACKED : MIME;

  let messageCb = null;
  let closeCb = null;
  let outbox = [];
  let flushScheduled = false;
  let closed = false;

  const fireClose = (err) => {
    if (closed) return;
    closed = true;
    const c = closeCb;
    closeCb = null;
    messageCb = null;
    outbox = [];
    if (c) c(err);
  };

  if (signal) {
    if (signal.aborted) fireClose(signal.reason ?? new Error("aborted"));
    else signal.addEventListener("abort", () => fireClose(signal.reason ?? new Error("aborted")), { once: true });
  }

  function scheduleFlush() {
    if (flushScheduled || closed) return;
    flushScheduled = true;
    queueMicrotask(doFlush);
  }

  async function doFlush() {
    flushScheduled = false;
    if (closed || outbox.length === 0) return;
    const batch = outbox;
    outbox = [];
    let body;
    try {
      // RpcSession queues frames as [u32 inner-length][framed-message]. The
      // batch envelope adds its own length prefix, so the inner one is
      // redundant in packed mode — strip it before packing, the receiver
      // re-adds it after unpacking so the inner FrameReader still sees a
      // valid length-prefixed payload.
      body = encodeBatch(packed ? batch.map((f) => cpp.packMessage(f.subarray(4))) : batch);
    } catch (err) {
      fireClose(err);
      return;
    }
    let res;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": mime, ...extraHeaders },
        body,
        signal,
      });
    } catch (err) {
      fireClose(err);
      return;
    }
    if (!res.ok) {
      fireClose(new Error(`HTTP ${res.status} ${res.statusText}`));
      return;
    }
    let respBytes;
    try {
      respBytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      fireClose(err);
      return;
    }
    if (closed || !messageCb) return;
    const respCt = res.headers?.get?.("Content-Type") ?? "";
    const respPacked = respCt.includes(MIME_PACKED);
    let frames;
    try {
      frames = decodeBatch(respBytes);
      if (respPacked) {
        if (!cpp) throw new Error("server returned packed batch but transport has no cpp to unpack");
        frames = frames.map((f) => prependU32Len(cpp.unpackMessage(f)));
      }
    } catch (err) {
      fireClose(err);
      return;
    }
    for (const f of frames) {
      if (closed || !messageCb) return;
      messageCb(f);
    }
  }

  // Each HTTP batch request is a fresh server-side RpcSession: there's
  // no server-side state for the client to release, so Finish and
  // Release frames the client emits in response to Returns are no-ops.
  // The connectHttpBatch wrapper passes stateless: true to RpcSession,
  // so those frames are never generated in the first place. No
  // post-send filterFrames pass is needed. (If a user wires this
  // transport up against a non-stateless session, Finish/Release frames
  // will go on the wire and waste a round-trip; pass `stateless: true`
  // to your RpcSession to fix.)

  const transport = {
    send(bytes) {
      if (closed) return;
      // Defensive copy: `bytes` is typically a slice of wasm memory that
      // gets reused before the fetch completes. Without the copy, the
      // POST body would be whatever wasm wrote next.
      outbox.push(new Uint8Array(bytes));
      scheduleFlush();
    },
    onMessage(handler) { messageCb = handler; },
    onClose(handler) { closeCb = handler; },
    close() { fireClose(); },
  };
  if (packed) {
    // Per-frame entry point. RpcSession#flush prefers sendFrames over
    // send() when present so packed-mode batches can pack each frame
    // individually. Without this, send() would receive a concatenated
    // [u32 len][frame][u32 len][frame] buffer and the pack op would
    // misinterpret the inner length prefix as part of the message.
    transport.sendFrames = (frames) => {
      if (closed) return;
      for (let i = 0; i < frames.length; i++) outbox.push(new Uint8Array(frames[i]));
      scheduleFlush();
    };
  }
  return transport;
}

/**
 * One-line client helper: open an HTTP batch session and resolve to a
 * connected RpcSession. Mirrors `connectWebSocket` but for the HTTP shape.
 *
 *   const session = await connectHttpBatch(cpp, "/rpc");
 *   const cap = session.bootstrap();
 *   const result = await cap.callBuilder(IFC, METHOD, Params)
 *                          .params.foo(1)
 *                          .send().promise;
 */
export function connectHttpBatch(cpp, url, opts = {}) {
  const transport = httpBatchTransport(url, { ...opts, cpp });
  return new RpcSession(cpp, transport, opts.registry, {
    bootstrap: opts.bootstrap,
    // Stateless mode: peer (server) creates a fresh session per request,
    // so Finish/Release frames are pointless. And sending them would
    // force the transport into an extra POST (wasted round-trip).
    stateless: true,
  });
}

/* ------------------------------------------------------------------ */
/*  Server                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a `fetch`-style handler that processes one HTTP batch request.
 *
 * Usage in a Cloudflare Worker:
 *
 *   const handler = createHttpBatchHandler(cpp, registry, {
 *     bootstrap: env.MY_BINDING,
 *   });
 *
 *   export default {
 *     async fetch(req) { return handler(req); },
 *   };
 *
 * Each request gets its own RpcSession; the session is torn down after the
 * response is flushed, so per-session state (export tables, in-flight
 * questions) doesn't leak between requests. Promise pipelining within a
 * single batch works as it does over WebSocket.
 *
 * @param {object} cpp - loaded CapnCpp instance
 * @param {InterfaceRegistry} registry - interface registrations
 * @param {object} [opts]
 * @param {object|Function} [opts.bootstrap] - bootstrap target, or a function
 *        `(req) => target` evaluated per request (lets you derive bootstrap
 *        from the incoming Request. Auth headers, query params, etc.)
 * @returns {(req: Request) => Promise<Response>}
 */
export function createHttpBatchHandler(cpp, registry, opts = {}) {
  return async function handle(req) {
    if (req.method !== "POST") {
      return new Response("expected POST", { status: 405 });
    }
    const ct = req.headers.get("Content-Type") ?? "";
    const packed = ct.includes(MIME_PACKED);
    if (!packed && !ct.includes(MIME) && !ct.includes("application/octet-stream")) {
      return new Response(`expected Content-Type: ${MIME} or ${MIME_PACKED}`, { status: 415 });
    }
    let bodyBytes;
    try {
      bodyBytes = new Uint8Array(await req.arrayBuffer());
    } catch (err) {
      return new Response(`bad request body: ${err.message ?? err}`, { status: 400 });
    }
    let frames;
    try {
      frames = decodeBatch(bodyBytes);
      if (packed) frames = frames.map((f) => prependU32Len(cpp.unpackMessage(f)));
    } catch (err) {
      return new Response(`bad batch envelope: ${err.message ?? err}`, { status: 400 });
    }

    const outbox = [];
    let messageCb = null;
    const transport = {
      send(bytes) { outbox.push(new Uint8Array(bytes)); },
      onMessage(handler) { messageCb = handler; },
      onClose() {},
      close() {},
    };
    if (packed) {
      // Same reasoning as the client: pack each Return frame separately so
      // the inner length prefix never gets fed to packMessage as message
      // body. RpcSession#flush calls sendFrames when present.
      transport.sendFrames = (frames) => {
        for (let i = 0; i < frames.length; i++) outbox.push(new Uint8Array(frames[i]));
      };
    }

    const bootstrap = typeof opts.bootstrap === "function"
      ? opts.bootstrap(req)
      : opts.bootstrap;

    // Stateless: this server-side session lives for the duration of one
    // request. Skip the wire features that only make sense across calls
    // (Finish/Release frames). Saves a per-call frame allocation.
    const session = new RpcSession(cpp, transport, registry, { bootstrap, stateless: true });

    try {
      for (const f of frames) {
        if (!messageCb) break;
        messageCb(f);
      }
      // Wait for all async handlers to settle and the send queue to drain.
      await session.idle();
    } finally {
      session.close();
    }

    const respFrames = packed ? outbox.map((f) => cpp.packMessage(f.subarray(4))) : outbox;
    return new Response(encodeBatch(respFrames), {
      status: 200,
      headers: { "Content-Type": packed ? MIME_PACKED : MIME },
    });
  };
}
