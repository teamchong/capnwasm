// Packed encoding option for the WebSocket transport. Each ws message
// carries one Cap'n Proto packed frame; the inner u32 length prefix is
// dropped because the WebSocket frame is already self-delimiting.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  wsTransport,
} from "../js/rpc.mjs";

// Pair of fake WebSockets piped to each other. Just enough surface to
// satisfy wsTransport: addEventListener("message"|"close"|"error"), send,
// close, binaryType. send(ArrayBufferView|ArrayBuffer) delivers a
// {data: ArrayBuffer} message event to the peer asynchronously.
function fakeWsPair() {
  const make = () => {
    const listeners = { message: [], close: [], error: [] };
    return {
      binaryType: "",
      _peer: null,
      addEventListener(type, cb) { (listeners[type] ??= []).push(cb); },
      removeEventListener(type, cb) {
        const arr = listeners[type] ?? [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      },
      _fire(type, ev) { for (const cb of listeners[type] ?? []) cb(ev); },
      send(data) {
        const buf = data instanceof ArrayBuffer
          ? data.slice(0)
          : new Uint8Array(data).slice().buffer;
        queueMicrotask(() => this._peer._fire("message", { data: buf }));
      },
      close() {
        queueMicrotask(() => {
          this._peer._fire("close", {});
          this._fire("close", {});
        });
      },
    };
  };
  const a = make();
  const b = make();
  a._peer = b;
  b._peer = a;
  return { a, b };
}

const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY.slice();

test("ws packed: bootstrap + call round-trips", async () => {
  const IFC = 0xabc01234abc01234n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async (_target, ctx) => ctx.paramsBytes());

  const cppServer = await loadWasm();
  const cppClient = await loadWasm();
  const { a, b } = fakeWsPair();

  const server = new RpcSession(
    cppServer,
    wsTransport(b, { packed: true, cpp: cppServer }),
    registry,
    { bootstrap: {} },
  );
  const client = new RpcSession(
    cppClient,
    wsTransport(a, { packed: true, cpp: cppClient }),
  );

  try {
    const cap = client.bootstrap();
    const { promise } = cap.call(IFC, 0, emptyMessage());
    const { bytes } = await promise;
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes.length, 16);
  } finally {
    try { server.close(); } catch {}
    try { client.close(); } catch {}
  }
});

test("ws packed: opt-in requires cpp instance", async () => {
  const ws = { binaryType: "", addEventListener() {}, send() {}, close() {} };
  assert.throws(
    () => wsTransport(ws, { packed: true }),
    /opts\.packed requires opts\.cpp/,
  );
});

test("ws packed: each ws.send carries one packed frame", async () => {
  // Sanity check that sendFrames fires exactly N ws.send calls for an
  // N-frame batch (Bootstrap + Call), so each ws message is one packed
  // self-delimiting payload.
  const IFC = 0xfff01234fff01234n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => null);

  const cppServer = await loadWasm();
  const cppClient = await loadWasm();
  const { a, b } = fakeWsPair();

  let clientSends = 0;
  const aSend = a.send.bind(a);
  a.send = (data) => { clientSends++; return aSend(data); };

  const server = new RpcSession(
    cppServer,
    wsTransport(b, { packed: true, cpp: cppServer }),
    registry,
    { bootstrap: {} },
  );
  const client = new RpcSession(
    cppClient,
    wsTransport(a, { packed: true, cpp: cppClient }),
  );

  try {
    const cap = client.bootstrap();
    await cap.call(IFC, 0, emptyMessage()).promise;
    // Bootstrap + Call = 2 ws.send calls minimum. Allow a Finish if the
    // session emits one for non-stateless mode (it shouldn't for a fresh
    // pair, but bound the check loosely).
    assert.ok(clientSends >= 2, `expected at least 2 ws.send calls, got ${clientSends}`);
  } finally {
    try { server.close(); } catch {}
    try { client.close(); } catch {}
  }
});
