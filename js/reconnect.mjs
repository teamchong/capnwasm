// Reconnecting transport / WebSocket. Auto-reopens on close with exponential
// backoff; exposes an onReconnect hook so the caller can re-fetch the
// bootstrap and re-establish subscriptions. Pending calls on the dropped
// session reject. Caller decides whether to retry, since this helper has
// no idea which calls are idempotent.
//
//   import { reconnectingWebSocket } from "capnwasm/reconnect";
//
//   const conn = reconnectingWebSocket(cpp, "wss://api.example.com/rpc", {
//     registry,
//     onReconnect: async (session) => { await resubscribe(session); },
//   });
//   await conn.ready;
//   const cap = conn.session.bootstrap();

import { RpcSession, wsTransport } from "./rpc.mjs";

/**
 * Wrap a transport factory with auto-reconnect on close.
 *
 * @param {object} cpp - loaded CapnCpp instance
 * @param {() => Promise<object>} transportFactory - returns a fresh transport each call
 * @param {object} [opts]
 * @param {InterfaceRegistry} [opts.registry]
 * @param {object} [opts.bootstrap]
 * @param {number} [opts.initialBackoff=200]
 * @param {number} [opts.maxBackoff=30000]
 * @param {() => boolean} [opts.shouldReconnect]
 */
export function reconnectingTransport(cpp, transportFactory, opts = {}) {
  const initialBackoff = opts.initialBackoff ?? 200;
  const maxBackoff = opts.maxBackoff ?? 30_000;
  const shouldReconnect = opts.shouldReconnect ?? (() => true);
  const onReconnectFns = [];
  let stopped = false;
  let currentSession = null;
  let backoff = initialBackoff;
  let attempt = 0;

  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  async function loop() {
    while (!stopped) {
      let transport;
      try {
        transport = await transportFactory();
      } catch (err) {
        if (stopped) break;
        if (attempt === 0 && rejectReady) { rejectReady(err); rejectReady = null; resolveReady = null; }
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, maxBackoff);
        continue;
      }

      // Fan out the transport's single onClose slot: session close + our notify.
      let sessionCloseHandler = null;
      let resolveClosed;
      const closed = new Promise(r => { resolveClosed = r; });
      const wrapped = {
        send: (bytes) => transport.send(bytes),
        onMessage: (cb) => transport.onMessage(cb),
        onClose(cb) { sessionCloseHandler = cb; },
        close: () => transport.close(),
      };
      transport.onClose?.(() => {
        try { sessionCloseHandler?.(); } catch {}
        resolveClosed();
      });

      const session = new RpcSession(cpp, wrapped, opts.registry, {
        bootstrap: opts.bootstrap,
      });
      currentSession = session;
      backoff = initialBackoff;
      attempt += 1;
      if (resolveReady) { resolveReady(session); resolveReady = null; rejectReady = null; }
      for (const fn of onReconnectFns) {
        try { await fn(session, attempt); } catch {}
      }

      await closed;
      currentSession = null;
      if (stopped || !shouldReconnect()) break;
    }
  }
  loop();

  return {
    ready,
    get session() { return currentSession; },
    onReconnect(fn) {
      onReconnectFns.push(fn);
      return () => {
        const i = onReconnectFns.indexOf(fn);
        if (i >= 0) onReconnectFns.splice(i, 1);
      };
    },
    close() {
      stopped = true;
      currentSession?.close();
    },
  };
}

export function reconnectingWebSocket(cpp, url, opts = {}) {
  const WSCtor = opts.WebSocket ?? globalThis.WebSocket;
  if (!WSCtor) throw new Error("No WebSocket constructor available; pass opts.WebSocket");
  const handle = reconnectingTransport(cpp, async () => {
    const ws = new WSCtor(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return wsTransport(ws);
  }, opts);
  if (opts.onReconnect) handle.onReconnect(opts.onReconnect);
  return handle;
}
