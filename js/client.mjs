// High-level client helpers — three small abstractions over the lower-level
// RPC primitives in js/rpc.mjs:
//
//   createClient(url, opts?)      — load wasm + connect WebSocket + bootstrap, one line
//   subscribeQuery(cap, IFC, METHOD, params)  — wrap callStream with an unsubscribe
//   optimistic({ apply, send, revert })       — apply-locally-then-send-to-server pattern
//
// Each is small enough to read in 20 lines. The point is to make the common
// shape obvious without forcing every caller through the lower-level RPC
// API surface.

import { load } from "../dist/inlined.mjs";
import { connectWebSocket } from "./rpc.mjs";

/**
 * One-call client construction. Loads the wasm runtime, opens a WebSocket
 * to `url`, and returns `{ session, cap }` where `cap` is the bootstrap
 * capability.
 *
 *   const { session, cap } = await createClient("wss://api.example.com/rpc");
 *   const result = await cap.call(IFC, METHOD, params).promise;
 *
 * For Node, pass `opts.WebSocket` (e.g. from the `ws` package) — Node 22+
 * has a built-in WebSocket so this is only needed on older runtimes.
 *
 * @param {string} url - ws:// or wss:// URL
 * @param {object} [opts]
 * @param {InterfaceRegistry} [opts.registry] - typed wrappers for inbound calls
 * @param {object} [opts.bootstrap] - object exposed when peer requests Bootstrap
 * @param {Function} [opts.WebSocket] - WebSocket constructor (defaults to globalThis.WebSocket)
 */
export async function createClient(url, opts = {}) {
  const cpp = await load();
  const session = await connectWebSocket(cpp, url, opts);
  return { cpp, session, cap: session.bootstrap() };
}

/**
 * Wrap a server-driven stream with an idiomatic-feeling pub/sub shape. The
 * underlying transport is `cap.callStream` — the same WebSocket frames a
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
 * — see js/rpc.mjs for the semantics. Pass `{ signal }` to abort externally.
 */
export function subscribeQuery(cap, interfaceId, methodId, paramsBytes, opts = {}) {
  const ac = new AbortController();
  // Compose external abort with our own — abort either fires both.
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
 * propagates — the caller's local state never observes a partial mutation.
 */
export async function optimistic({ apply, send, revert }) {
  const undoToken = apply();
  try {
    return await send();
  } catch (err) {
    if (revert) {
      try { revert(undoToken); } catch { /* swallow — the original error is what mattered */ }
    }
    throw err;
  }
}
