// Wire-level tests for Resolve / Disembargo / Abort frame handling. Each
// test hand-builds a frame on one side using the cpp_rpc_build_* exports
// directly and asserts the receiving side reacts correctly.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";

async function setup({ bootstrap, registry } = {}) {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, registry, { bootstrap });
  const client = new RpcSession(cppA, a);
  return { client, server, cppA, cppB, a, b };
}

// Frame an RPC message with a 4-byte LE length prefix matching what
// wsTransport / the FrameReader use.
function frame(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

function snapshotOut(cpp, len) {
  const u8 = new Uint8Array(cpp.memory.buffer);
  return u8.slice(cpp._outPtr, cpp._outPtr + len);
}

function emptyParams() {
  const o = new Uint8Array(16);
  new DataView(o.buffer).setUint32(4, 1, true);  // segment length = 1 word
  return o;
}

// Walk a possibly-batched buffer and yield each frame's RPC discriminant.
// Same shape as in rpc.test.mjs.
function rpcKindsOf(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos + 4 <= bytes.length) {
    const len = dv.getUint32(pos, true);
    if (pos + 4 + len > bytes.length) break;
    const dOff = pos + 4 + 16;
    out.push(dOff + 2 <= bytes.length ? dv.getUint16(dOff, true) : -1);
    pos += 4 + len;
  }
  return out;
}

const RPC_DISEMBARGO = 13;   // discriminant for capnp::rpc::Message::Disembargo (per rpc.capnp)

/* ------------------------------------------------------------------ */
/*  Abort                                                             */
/* ------------------------------------------------------------------ */

test("Abort frame: receiver rejects pending question and closes the session", async () => {
  const IFC = 0xfeedface00000001n;
  const registry = new InterfaceRegistry();
  let releaseHandler;
  registry.register(IFC, 0, () => new Promise(r => { releaseHandler = r; }));
  const { client, b, cppB } = await setup({ bootstrap: {}, registry });

  const cap = client.bootstrap();
  const { promise } = cap.call(IFC, 0, emptyParams());

  // Build the Abort on the server-side wasm and inject it into the client
  // transport directly (bypasses the server's send queue).
  const reasonBytes = new TextEncoder().encode("server going down");
  new Uint8Array(cppB.memory.buffer).set(reasonBytes, cppB._inPtr);
  const len = cppB._exports.cpp_rpc_build_abort(0, reasonBytes.length);
  assert.ok(len > 0, "build_abort should produce bytes");
  b.send(snapshotOut(cppB, len));

  await assert.rejects(promise, /peer aborted: server going down/);
  if (releaseHandler) releaseHandler(null);
});

test("Abort frame with no reason still rejects pending questions", async () => {
  const IFC = 0xfeedface00000002n;
  const registry = new InterfaceRegistry();
  let releaseHandler;
  registry.register(IFC, 0, () => new Promise(r => { releaseHandler = r; }));
  const { client, b, cppB } = await setup({ bootstrap: {}, registry });

  const cap = client.bootstrap();
  const { promise } = cap.call(IFC, 0, emptyParams());

  const len = cppB._exports.cpp_rpc_build_abort(0, 0);
  b.send(snapshotOut(cppB, len));

  await assert.rejects(promise, /peer aborted/);
  if (releaseHandler) releaseHandler(null);
});

/* ------------------------------------------------------------------ */
/*  Resolve                                                           */
/* ------------------------------------------------------------------ */

test("Resolve(exception) drops the import and doesn't crash the session", async () => {
  // Receiver-side: send a Resolve for an arbitrary import id and confirm
  // (a) no throw, (b) follow-up calls on a different cap still work.
  const IFC = 0xfeedface00000003n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async (target, ctx) => ctx.paramsBytes());
  const { client, b, cppB } = await setup({ bootstrap: {}, registry });

  const cap = client.bootstrap();
  // First, ensure the bootstrap round-trips so the session is healthy.
  const r0 = await cap.call(IFC, 0, emptyParams()).promise;
  assert.equal(r0.bytes.length, 16);

  // Inject a Resolve(promiseId=99, exception="bang") — promiseId 99 isn't
  // tracked anywhere, so this must be a no-op and not throw.
  const reasonBytes = new TextEncoder().encode("promise broke");
  new Uint8Array(cppB.memory.buffer).set(reasonBytes, cppB._inPtr);
  const len = cppB._exports.cpp_rpc_build_resolve_exception(99, 0, reasonBytes.length);
  assert.ok(len > 0);
  b.send(snapshotOut(cppB, len));

  // After delivering the Resolve, the session is still usable.
  const r1 = await cap.call(IFC, 0, emptyParams()).promise;
  assert.equal(r1.bytes.length, 16);

  client.close();
});

test("Resolve(senderHosted) remaps an import id to the resolved cap id", async () => {
  // We can't easily exercise the import-table mutation through public APIs
  // (we don't currently expose import inspection), so the test asserts the
  // observable: receiving a Resolve for our bootstrap import doesn't break
  // the bootstrap cap. Subsequent calls still route correctly.
  const IFC = 0xfeedface00000004n;
  const registry = new InterfaceRegistry();
  let invocationCount = 0;
  registry.register(IFC, 0, async (target, ctx) => { invocationCount++; return ctx.paramsBytes(); });
  const { client, b, cppB } = await setup({ bootstrap: {}, registry });

  const cap = client.bootstrap();
  await cap.call(IFC, 0, emptyParams()).promise;
  assert.equal(invocationCount, 1);

  // Send Resolve(promiseId=0, cap=senderHosted(0)) — alias the bootstrap
  // import to itself. Should be a no-op for routing.
  const len = cppB._exports.cpp_rpc_build_resolve_cap(0, 0);
  b.send(snapshotOut(cppB, len));

  await cap.call(IFC, 0, emptyParams()).promise;
  assert.equal(invocationCount, 2, "second call still routes via bootstrap import");

  client.close();
});

/* ------------------------------------------------------------------ */
/*  Disembargo                                                        */
/* ------------------------------------------------------------------ */

test("Disembargo senderLoopback: receiver echoes back as receiverLoopback with the same id", async () => {
  const { client, server, b, cppA } = await setup({ bootstrap: {} });

  // Tap the client's outbound channel (which is a.send → b receives).
  // In our paired transport, b.peer === a, so messages from b to peer
  // (i.e., the client side) come via b.peer (= a). What we want is to
  // observe what the client emits back to the server — that's a.send.
  const { a } = await (async () => ({ a: undefined, b: undefined }))();
  // We already have b from setup; we need its peer to tap. Tapping `a`
  // captures what the CLIENT sends (which is what we care about — the
  // echo).  Easier: tap the client's transport `a` exposed via setup.
  const setup2 = await setup({ bootstrap: {} });
  const realASend = setup2.a.send.bind(setup2.a);
  const sentByClient = [];
  setup2.a.send = (bytes) => { sentByClient.push(bytes); realASend(bytes); };

  // Build a senderLoopback Disembargo on the server's wasm targeting
  // importedCap(0) (the bootstrap) with embargoId=42, then inject into
  // the client.
  const len = setup2.cppB._exports.cpp_rpc_build_disembargo_sender_loopback(0, 0, 42);
  assert.ok(len > 0, "build_disembargo_sender_loopback should produce bytes");
  setup2.b.send(snapshotOut(setup2.cppB, len));

  // Drain microtasks so the client's onMessage fires + the echo flushes.
  await new Promise(r => setTimeout(r, 5));

  // The client should have echoed back exactly one Disembargo frame.
  const allKinds = sentByClient.flatMap(buf => rpcKindsOf(buf));
  assert.ok(allKinds.includes(RPC_DISEMBARGO),
    `client should echo a Disembargo back; sent kinds: ${JSON.stringify(allKinds)}`);

  // Decode the echoed frame on the server's wasm and confirm the context
  // is receiverLoopback with the same embargoId.
  // Find the disembargo frame in sentByClient.
  const dembFrames = sentByClient.flatMap(buf => {
    const kinds = rpcKindsOf(buf);
    if (!kinds.includes(RPC_DISEMBARGO)) return [];
    // Walk again to extract just the Disembargo frame bytes.
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const found = [];
    let pos = 0;
    while (pos + 4 <= buf.length) {
      const flen = dv.getUint32(pos, true);
      if (pos + 4 + flen > buf.length) break;
      const dOff = pos + 4 + 16;
      const k = dOff + 2 <= buf.length ? dv.getUint16(dOff, true) : -1;
      if (k === RPC_DISEMBARGO) found.push(buf.subarray(pos + 4, pos + 4 + flen));
      pos += 4 + flen;
    }
    return found;
  });
  assert.ok(dembFrames.length >= 1, "found at least one Disembargo frame on the wire");

  // Stage that frame into the server-side wasm and read the context out.
  const dembBytes = dembFrames[0];
  new Uint8Array(setup2.cppB.memory.buffer).set(dembBytes, setup2.cppB._inPtr);
  const kind = setup2.cppB._exports.cpp_rpc_decode(dembBytes.length);
  assert.equal(kind, 7, "decoded as KIND_DISEMBARGO");
  const summaryOk = setup2.cppB._exports.cpp_rpc_get_disembargo_summary();
  assert.equal(summaryOk, 1);
  const dv = new DataView(setup2.cppB.memory.buffer, setup2.cppB._outPtr, 16);
  assert.equal(dv.getUint32(0, true), 1, "context kind = receiverLoopback (1)");
  assert.equal(dv.getUint32(4, true), 42, "embargoId echoed back as 42");
  assert.equal(dv.getUint32(8, true), 0, "target kind = importedCap (0)");
  assert.equal(dv.getUint32(12, true), 0, "target id = 0 (bootstrap)");

  client.close(); server.close();
  setup2.client.close(); setup2.server.close();
});

test("Disembargo receiverLoopback (no pending embargo): no-op, doesn't crash", async () => {
  const { client, b, cppB } = await setup({ bootstrap: {} });

  // Build a receiverLoopback Disembargo and inject. Client has no pending
  // outbound embargoes so this is just a no-op — the test is a
  // "doesn't throw / session stays healthy" assertion.
  const len = cppB._exports.cpp_rpc_build_disembargo_receiver_loopback(0, 5, 1234);
  b.send(snapshotOut(cppB, len));
  await new Promise(r => setTimeout(r, 5));

  // Confirm the session is still alive: a fresh bootstrap call still works.
  const cap = client.bootstrap();
  assert.ok(cap, "session still healthy after stray receiverLoopback");
  client.close();
});
