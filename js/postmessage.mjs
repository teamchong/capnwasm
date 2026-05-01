// postMessage / MessageChannel transport for capnwasm RPC.
//
// Use cases:
//   • Worker ↔ main thread (DedicatedWorker, SharedWorker, ServiceWorker)
//   • iframe ↔ host window (postMessage with origin checks)
//   • One MessagePort end of a MessageChannel paired with the other end
//
// The transport handles ArrayBuffer + Uint8Array message payloads. For
// browser-to-Worker, send transferable ArrayBuffers (zero-copy across
// threads). For window.postMessage, the structured-clone algorithm
// handles the typed-array case automatically.
//
// Wire frames are the same length-prefixed Cap'n Proto bytes the WS
// transport sends — the receiver's FrameReader handles boundaries even
// if a single message contains multiple frames or the framing splits
// across messages.

/**
 * Wrap a postMessage-shaped target as a Transport. The target must expose:
 *   - postMessage(message, transfer?)
 *   - addEventListener("message", handler) | onmessage = handler
 *   - For Window targets: optionally origin-restricted via opts.targetOrigin
 *
 * @param {object} target  - MessagePort | Worker | Window | DedicatedWorkerGlobalScope
 * @param {object} [opts]
 * @param {string} [opts.targetOrigin]  - required for window.postMessage
 *        cross-origin sends; passed straight through. Use "*" for same-origin
 *        only when you've otherwise verified the peer.
 * @param {string} [opts.acceptOrigin]  - filter inbound messages by origin
 *        (window targets only — MessagePort/Worker messages have no origin).
 *        Set to "*" to accept any.
 * @param {boolean} [opts.transfer=true]  - when true and the message is a
 *        Uint8Array, transfer the underlying ArrayBuffer (zero-copy). The
 *        sender's reference becomes detached. Disable if your bytes need
 *        to outlive the send.
 */
export function postMessageTransport(target, opts = {}) {
  if (!target || typeof target.postMessage !== "function") {
    throw new TypeError("postMessageTransport: target must have postMessage()");
  }
  const targetOrigin = opts.targetOrigin;
  const acceptOrigin = opts.acceptOrigin;
  const transfer = opts.transfer !== false;

  // MessagePort needs start() before it delivers messages — it's a no-op
  // for Worker/Window. Calling on objects that don't expose it is fine
  // because of the optional-chain.
  target.start?.();

  let messageCb = null;
  let closeCb = null;
  let closed = false;

  const onMessage = (ev) => {
    if (closed || !messageCb) return;
    if (acceptOrigin && acceptOrigin !== "*" && ev.origin && ev.origin !== acceptOrigin) {
      return;
    }
    let data = ev.data;
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    else if (data && data.buffer instanceof ArrayBuffer && typeof data.byteLength === "number") {
      // Already a typed-array view (Uint8Array etc.). Pass straight through.
      data = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      // Skip non-binary messages — could be unrelated traffic on the same port.
      return;
    }
    messageCb(data);
  };

  // Browser MessagePort/Worker uses addEventListener; older Worker code
  // also accepts onmessage = . Use addEventListener so multiple consumers
  // (debug taps, etc.) can coexist.
  if (typeof target.addEventListener === "function") {
    target.addEventListener("message", onMessage);
  } else {
    target.onmessage = onMessage;
  }

  const onClose = () => {
    if (closed) return;
    closed = true;
    const c = closeCb;
    closeCb = null;
    messageCb = null;
    if (typeof target.removeEventListener === "function") {
      target.removeEventListener("message", onMessage);
    } else if (target.onmessage === onMessage) {
      target.onmessage = null;
    }
    if (c) c();
  };
  // Workers expose 'error' / 'messageerror'; ports expose neither
  // explicitly but if the underlying channel dies the transport is
  // unusable. We treat those as a single "close" trigger when present.
  target.addEventListener?.("messageerror", onClose);
  target.addEventListener?.("close", onClose);

  return {
    send(bytes) {
      if (closed) return;
      // Typed-array sends: optionally hand off the underlying buffer for
      // zero-copy. Slice the buffer to exactly the byteLength so we don't
      // accidentally transfer extra wasm scratch memory still attached.
      if (transfer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        if (targetOrigin) {
          target.postMessage(bytes.buffer, targetOrigin, [bytes.buffer]);
        } else {
          target.postMessage(bytes.buffer, [bytes.buffer]);
        }
        return;
      }
      // Otherwise copy into a standalone ArrayBuffer (avoids transferring
      // an in-use wasm-memory buffer which would detach all consumers).
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      if (targetOrigin) {
        if (transfer) {
          target.postMessage(copy.buffer, targetOrigin, [copy.buffer]);
        } else {
          target.postMessage(copy.buffer, targetOrigin);
        }
      } else {
        if (transfer) target.postMessage(copy.buffer, [copy.buffer]);
        else target.postMessage(copy.buffer);
      }
    },
    onMessage(handler) { messageCb = handler; },
    onClose(handler) { closeCb = handler; },
    close() { onClose(); },
  };
}

/**
 * One-call helper: create a connected pair of transports that talk via a
 * MessageChannel. Useful for tests and for in-process iframe-style setups
 * where both ends live in the same realm.
 *
 *   const { a, b } = createMessageChannelTransportPair();
 *   const client = new RpcSession(cppA, a);
 *   const server = new RpcSession(cppB, b, registry, { bootstrap });
 */
export function createMessageChannelTransportPair() {
  const channel = new MessageChannel();
  return {
    a: postMessageTransport(channel.port1),
    b: postMessageTransport(channel.port2),
    channel,
  };
}
