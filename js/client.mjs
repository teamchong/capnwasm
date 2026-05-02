// High-level client helpers. Three small abstractions over the lower-level
// RPC primitives in js/rpc.mjs:
//
//   createClient(url, opts?)     . Load wasm + connect WebSocket + bootstrap, one line
//   subscribeQuery(cap, IFC, METHOD, params) . Wrap callStream with an unsubscribe
//   optimistic({ apply, send, revert })      . Apply-locally-then-send-to-server pattern
//
// Each is small enough to read in 20 lines. The point is to make the common
// shape obvious without forcing every caller through the lower-level RPC
// API surface.

// Transports are dynamically imported per-call so a bundler only includes
// the transport modules the user actually reaches. A typed-proxy + HTTP-
// batch consumer pays for rpc.mjs (foundational) + http_batch.mjs only -
// http_stream.mjs and postmessage.mjs stay out of the bundle.
//
// Default wasm loader is also dynamic so the heavy inlined-wasm bundle
// isn't pulled into browser builds when the caller already has a loaded
// `cpp` (e.g. `await load()` from "capnwasm/browser") or supplies their
// own loader.
async function defaultLoad() {
  const m = await import("../dist/inlined.mjs");
  return m.load();
}

/**
 * One-call client construction. Loads the wasm runtime, opens a connection
 * to `url`, and returns `{ session, cap }` where `cap` is the bootstrap
 * capability. The transport is picked by URL scheme:
 *
 *   ws:// or wss://      → WebSocket transport (full-duplex, long-lived)
 *   http:// or https://  → HTTP batch transport (stateless POST/response)
 *   any URL + opts.transport === "stream" → HTTP streaming transport
 *
 *   const { session, cap } = await createClient("wss://api.example.com/rpc");
 *   const result = await cap.call(IFC, METHOD, params).promise;
 *
 * For Node WebSocket, pass `opts.WebSocket` (e.g. from the `ws` package) -
 * Node 22+ has a built-in WebSocket so this is only needed on older runtimes.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {"auto"|"ws"|"batch"|"stream"} [opts.transport="auto"]
 * @param {InterfaceRegistry} [opts.registry] - typed wrappers for inbound calls
 * @param {object} [opts.bootstrap] - object exposed when peer requests Bootstrap
 * @param {Function} [opts.WebSocket] - WebSocket constructor (defaults to globalThis.WebSocket)
 * @param {Function} [opts.fetch] - fetch implementation (HTTP transports)
 * @param {object} [opts.headers] - extra HTTP headers (HTTP transports)
 * @param {AbortSignal} [opts.signal] - aborts in-flight HTTP requests + closes
 * @param {object} [opts.cpp] - pre-loaded CapnCpp instance. Pass this from
 *   "capnwasm/browser" (`await load()`) to avoid pulling the inlined-wasm
 *   bundle into your browser build.
 * @param {Function} [opts.load] - custom loader that returns a CapnCpp.
 */
export async function createClient(url, opts = {}) {
  const cpp = opts.cpp ?? (opts.load ? await opts.load() : await defaultLoad());
  const transport = opts.transport ?? autoDetect(url);
  let session;
  if (transport === "ws") {
    const { connectWebSocket } = await import("./rpc.mjs");
    session = await connectWebSocket(cpp, url, opts);
  } else if (transport === "batch") {
    const { connectHttpBatch } = await import("./http_batch.mjs");
    session = connectHttpBatch(cpp, url, opts);
  } else if (transport === "stream") {
    const { connectHttpStream } = await import("./http_stream.mjs");
    session = connectHttpStream(cpp, url, opts);
  } else {
    throw new Error(`createClient: unknown transport "${transport}"`);
  }
  return { cpp, session, cap: session.bootstrap() };
}

function autoDetect(url) {
  if (url.startsWith("ws:") || url.startsWith("wss:")) return "ws";
  if (url.startsWith("http:") || url.startsWith("https:")) return "batch";
  throw new Error(`createClient: cannot auto-detect transport from "${url}"; pass opts.transport`);
}

/**
 * Wrap a server-driven stream with an idiomatic-feeling pub/sub shape. The
 * underlying transport is `cap.callStream`. The same WebSocket frames a
 * Cap'n Proto C++ peer would speak. This helper just adds the unsubscribe.
 *
 *   const sub = subscribeQuery(cap, MESSAGES_IFC, METHOD_WATCH, paramsBytes);
 *   for await (const chunk of sub.updates) { renderMessage(chunk); }
 *   sub.unsubscribe();   // sends Finish + tears down the iterator
 *
 * The `for await` loop also unwinds naturally if you `break` from it; the
 * unsubscribe is for cases where the consumer is decoupled from the loop
 * (component unmount, route change, etc).
 *
 * Pass `{ maxQueueSize }` to bound the in-memory buffer for slow consumers
 *. See js/rpc.mjs for the semantics. Pass `{ signal }` to abort externally.
 */
export function subscribeQuery(cap, interfaceId, methodId, paramsBytes, opts = {}) {
  const ac = new AbortController();
  // Compose external abort with our own. Abort either fires both.
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason);
    else opts.signal.addEventListener("abort", () => ac.abort(opts.signal.reason), { once: true });
  }
  const stream = cap.callStream(interfaceId, methodId, paramsBytes, {
    signal: ac.signal,
    maxQueueSize: opts.maxQueueSize,
  });
  return {
    updates: stream.chunks,
    unsubscribe(reason) { ac.abort(reason ?? new Error("unsubscribed")); },
    questionId: stream.questionId,
  };
}

/**
 * Apply a mutation locally before the server confirms it. Standard UI
 * pattern: the user clicks "send", the message appears immediately, and
 * if the server rejects we roll the local view back.
 *
 *   await optimistic({
 *     apply:  () => state.messages.push(msg),
 *     send:   () => api.sendMessage(msg).promise,
 *     revert: () => state.messages.pop(),
 *   });
 *
 * `apply` runs first and may return a value (an undo token, etc.). If
 * `send` throws, `revert` runs with that value. The error then re-throws
 * so the caller can choose how to surface it (toast, log, retry).
 *
 * If `apply` itself throws, nothing is sent and the original error
 * propagates. The caller's local state never observes a partial mutation.
 */
export async function optimistic({ apply, send, revert }) {
  const undoToken = apply();
  try {
    return await send();
  } catch (err) {
    if (revert) {
      try { revert(undoToken); } catch { /* swallow. The original error is what mattered */ }
    }
    throw err;
  }
}
