// postMessage / MessageChannel transport: runs through a real MessageChannel
// (Node 22 has it built in), wiring two RpcSessions end to end.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { RpcSession, InterfaceRegistry } from "../js/rpc.mjs";
import {
  postMessageTransport,
  createMessageChannelTransportPair,
} from "../js/postmessage.mjs";

const EMPTY = (() => {
  const o = new Uint8Array(16);
  new DataView(o.buffer).setUint32(4, 1, true);
  return o;
})();
const emptyParams = () => EMPTY.slice();

test("postMessage transport: bootstrap + call round-trips through a MessageChannel", async () => {
  const IFC = 0xab12cd34ef560001n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async (target, ctx) => ctx.paramsBytes());

  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMessageChannelTransportPair();

  const server = new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const cap = client.bootstrap();
  const result = await cap.call(IFC, 0, emptyParams()).promise;
  assert.equal(result.bytes.length, 16);
  client.close(); server.close();
});

test("postMessage transport: many calls in same tick coalesce on the wire", async () => {
  const IFC = 0xab12cd34ef560002n;
  const registry = new InterfaceRegistry();
  let invocations = 0;
  registry.register(IFC, 0, async () => { invocations++; return null; });

  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMessageChannelTransportPair();

  // Tap the underlying postMessage to count actual messages.
  const realASend = a.send.bind(a);
  let messagesSent = 0;
  a.send = (bytes) => { messagesSent++; realASend(bytes); };

  const server = new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const cap = client.bootstrap();
  const results = await Promise.all([
    cap.call(IFC, 0, emptyParams()).promise,
    cap.call(IFC, 0, emptyParams()).promise,
    cap.call(IFC, 0, emptyParams()).promise,
  ]);
  assert.equal(results.length, 3);
  assert.equal(invocations, 3);
  // Without batching, 1 bootstrap + 3 Calls + 3 Finishes = 7 messages.
  // With microtask batching they collapse to: bootstrap+Calls in one
  // outbound batch, Finishes in another after Returns arrive ≈ 2-3.
  assert.ok(messagesSent <= 3,
    `client sent ${messagesSent} messages — expected ≤ 3 with microtask batching`);

  client.close(); server.close();
});

test("postMessage transport: server-side exception surfaces as a rejected promise", async () => {
  const IFC = 0xab12cd34ef560003n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => { throw new Error("boom"); });

  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMessageChannelTransportPair();

  const server = new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const { promise } = client.bootstrap().call(IFC, 0, emptyParams());
  await assert.rejects(promise, /boom/);
  client.close(); server.close();
});

test("postMessage transport: close() detaches the message handler", async () => {
  const ch = new MessageChannel();
  const t = postMessageTransport(ch.port1);
  let received = 0;
  t.onMessage(() => { received++; });

  // Send something via port2 — should arrive at port1.
  ch.port2.start();
  ch.port2.postMessage(new Uint8Array([1, 2, 3]).buffer);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(received, 1);

  t.close();
  ch.port2.postMessage(new Uint8Array([4, 5, 6]).buffer);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(received, 1, "no more messages after close");
});

test("postMessage transport: rejects targets without postMessage", () => {
  assert.throws(() => postMessageTransport({}), /must have postMessage/);
  assert.throws(() => postMessageTransport(null), /must have postMessage/);
});

test("postMessage transport: ignores non-binary messages on the port", async () => {
  const ch = new MessageChannel();
  const t = postMessageTransport(ch.port1);
  let received = 0;
  t.onMessage(() => { received++; });

  ch.port2.start();
  ch.port2.postMessage("a string");
  ch.port2.postMessage({ some: "object" });
  ch.port2.postMessage(42);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(received, 0, "non-binary messages ignored");

  ch.port2.postMessage(new Uint8Array([7]).buffer);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(received, 1, "binary message received");
  t.close();
});
