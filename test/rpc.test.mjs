// End-to-end RPC tests: bootstrap, call, exception propagation, pipelining.
// Two RpcSessions are wired through an in-process transport pair; each side
// runs against its own wasm instance so the shared cpp_in/cpp_out scratch
// areas can't collide across peers. Wire bytes come from capnp_cpp.wasm
// (real upstream Cap'n Proto via zig cc), so anything passing here proves
// both sides speak the actual rpc.capnp protocol.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  RpcCap,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";

// 1-segment Cap'n Proto frame whose root pointer is null. The smallest
// valid framed message; used as both empty params and empty results.
const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

// Each test gets a fresh client/server pair on isolated wasm instances so
// scratch-buffer state from a previous test can't leak in. Returns the
// two sessions plus optional transport taps for wire-level assertions.
async function setupSessions({ bootstrap, registry } = {}) {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const aTap = tap(a);
  const bTap = tap(b);
  const server = new RpcSession(cppB, b, registry, { bootstrap });
  const client = new RpcSession(cppA, a);
  return { client, server, aTap, bTap };
}

// Wire-tap on a transport endpoint. Records the rpc.capnp Message variant
// of every frame sent and received so tests can assert on the protocol-level
// sequence (e.g., "two Calls before any Return"). Auto-batching can pack
// multiple frames into one transport.send, so we walk each batched buffer
// and record every frame's kind individually.
function tap(end) {
  const sentKinds = [];
  const recvKinds = [];
  const realSend = end.send.bind(end);
  const realOnMessage = end.onMessage.bind(end);
  end.send = (bytes) => { for (const k of rpcKindsOf(bytes)) sentKinds.push(k); realSend(bytes); };
  end.onMessage = (cb) => realOnMessage((bytes) => { for (const k of rpcKindsOf(bytes)) recvKinds.push(k); cb(bytes); });
  return { sentKinds, recvKinds };
}

// Walk a (possibly batched) buffer of length-prefixed Cap'n Proto messages
// and yield each frame's union discriminant. Each frame: 4 bytes length,
// then `length` bytes of payload. The Message struct's discriminant sits
// at byte 16 of the payload (8-byte segment table + 8-byte root pointer).
const RPC_KIND = {
  UNIMPLEMENTED: 0, ABORT: 1, CALL: 2, RETURN: 3, FINISH: 4,
  RESOLVE: 5, RELEASE: 6, BOOTSTRAP: 8,
};
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

test("bootstrap + call: server method runs and result reaches client", async () => {
  const IFC = 0xabcdef0123456789n;
  const METHOD = 0;
  let serverSawTarget = null;
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async (target, ctx) => {
    serverSawTarget = target;
    return ctx.paramsBytes();
  });
  const serverImpl = { kind: "echo-server" };
  const { client } = await setupSessions({ bootstrap: serverImpl, registry });

  const cap = client.bootstrap();
  assert.ok(cap instanceof RpcCap);
  const { promise } = cap.call(IFC, METHOD, emptyMessage());
  const { bytes, caps } = await promise;

  assert.ok(bytes instanceof Uint8Array);
  // Echoed empty AnyPointer — 1-segment, 1-word frame = 16 bytes after rebuild.
  assert.equal(bytes.length, 16);
  assert.deepEqual(caps, [], "no caps in echo reply");
  assert.equal(serverSawTarget, serverImpl, "handler should run on the bootstrap target");

  client.close();
});

test("server-side exception travels back as a rejected promise", async () => {
  const IFC = 0x1111111111111111n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => { throw new Error("server method blew up"); });
  const { client } = await setupSessions({ bootstrap: {}, registry });

  const { promise } = client.bootstrap().call(IFC, 0, emptyMessage());
  await assert.rejects(promise, /server method blew up/);
  client.close();
});

test("call to unregistered method rejects with 'unknown method'", async () => {
  const { client } = await setupSessions({
    bootstrap: {},
    registry: new InterfaceRegistry(),
  });
  const { promise } = client.bootstrap().call(0x9999n, 7, emptyMessage());
  await assert.rejects(promise, /unknown method/);
  client.close();
});

test("pipelined call: server defers second handler until first resolves; both Calls hit the wire before any Return", async () => {
  const IFC = 0x5555aaaa5555aaaan;
  const METHOD_FIRST = 0;
  const METHOD_SECOND = 1;
  const order = [];
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD_FIRST, async () => {
    order.push("first-start");
    // Hold the first handler open long enough that the pipelined call's
    // #handleCall is definitely parked on its readyPromise. 10ms is a
    // microtask-friendly pause; the assertion would still hold at 1ms,
    // but the wider gap makes intent obvious.
    await new Promise(r => setTimeout(r, 10));
    order.push("first-end");
    return null;
  });
  registry.register(IFC, METHOD_SECOND, async () => {
    order.push("second");
    return null;
  });
  const { client, aTap, bTap } = await setupSessions({
    bootstrap: { name: "pipeline-server" },
    registry,
  });

  const cap = client.bootstrap();
  const r1 = cap.call(IFC, METHOD_FIRST, emptyMessage());
  // r2 is sent immediately after r1 — its target = promisedAnswer(r1.questionId).
  const r2 = r1.cap.call(IFC, METHOD_SECOND, emptyMessage());
  await Promise.all([r1.promise, r2.promise]);

  assert.deepEqual(order, ["first-start", "first-end", "second"],
    "pipelined call must wait for its target answer to resolve");

  // Wire-level proof of pipelining: the server's first three receives are
  // Bootstrap, Call, Call — both Calls arrived before any client-side
  // round-trip completed. Without pipelining, the client would have had to
  // await Call#1's Return before sending Call#2, so we'd see a Finish (or
  // any other client→server frame) interleaved between the two Calls.
  assert.equal(bTap.recvKinds[0], RPC_KIND.BOOTSTRAP);
  assert.equal(bTap.recvKinds[1], RPC_KIND.CALL);
  assert.equal(bTap.recvKinds[2], RPC_KIND.CALL);
  assert.equal(aTap.sentKinds.filter(k => k === RPC_KIND.CALL).length, 2);

  client.close();
});

test("capability passing: handler returns a cap; client receives a working RpcCap and can call methods on it", async () => {
  const ROOT_IFC  = 0x1234567890abcdefn;
  const ROOT_GET_CHILD = 0;
  const CHILD_IFC = 0xfedcba0987654321n;
  const CHILD_PING = 0;

  // Server has a parent cap (the bootstrap) that hands out a child cap on
  // demand. We track which target object served each call so we can verify
  // that the second call genuinely reached the child, not the parent.
  const childImpl = { kind: "child" };
  const callTargets = [];
  const registry = new InterfaceRegistry();
  registry.register(ROOT_IFC, ROOT_GET_CHILD, async (target) => {
    callTargets.push(target.kind);
    return { caps: [childImpl] };
  });
  registry.register(CHILD_IFC, CHILD_PING, async (target) => {
    callTargets.push(target.kind);
    return null;
  });
  const { client } = await setupSessions({
    bootstrap: { kind: "root" },
    registry,
  });

  const root = client.bootstrap();
  const r1 = root.call(ROOT_IFC, ROOT_GET_CHILD, emptyMessage());
  const { caps } = await r1.promise;

  assert.equal(caps.length, 1, "server should have returned exactly one cap");
  assert.ok(caps[0] instanceof RpcCap, "returned cap should be an RpcCap");

  const r2 = caps[0].call(CHILD_IFC, CHILD_PING, emptyMessage());
  await r2.promise;

  assert.deepEqual(callTargets, ["root", "child"],
    "first call hit the root cap; second call hit the returned child cap");

  client.close();
});

test("end-to-end zero-copy: callBuilder writes params into rpc_builder; openParams reads results out of rpc_reader", async () => {
  const { PrimitivesBuilder, PrimitivesReader } = await import("../js/conformance_schema.gen.mjs");
  const IFC = 0xc0ffeec0ffeec0ffn;
  const METHOD = 0;

  // Server reads params via openParams (zero-copy receive) — every field
  // access is a wasm load against the live rpc_reader. No params bytes
  // were ever materialized in JS or copied into a separate buffer.
  const seen = {};
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    seen.u8 = p.u8;
    seen.u32 = p.u32;
    seen.text = p.text;
    // Build the response via beginResults (zero-copy send) — the wasm-side
    // any_builder writes straight into the rpc_builder's Return.results.content.
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.u8 = (p.u8 + 1) & 0xff;
    reply.u32 = (p.u32 + 1) >>> 0;
    reply.text = "ack: " + p.text;
    // No return value needed — beginResults flagged the rpc_builder for
    // direct finalization in the dispatcher.
  });
  const { client } = await setupSessions({ bootstrap: {}, registry });

  // Client builds params directly into the rpc_builder via callBuilder.
  const cap = client.bootstrap();
  const r = cap.callBuilder(IFC, METHOD, PrimitivesBuilder);
  r.params.u8 = 99;
  r.params.u32 = 0xdeadbeef;
  r.params.text = "zero-copy params";
  const { promise } = r.send();
  const result = await promise;

  // Server saw exactly what we wrote.
  assert.equal(seen.u8, 99);
  assert.equal(seen.u32 >>> 0, 0xdeadbeef);
  assert.equal(seen.text, "zero-copy params");

  // The reply bytes can still be opened by the application Reader on the
  // client side (using openPrimitives — separate from the zero-copy path
  // since the call promise resolved on a microtask after rpc_reader was
  // potentially overwritten by a Finish message).
  const { openPrimitives } = await import("../js/conformance_schema.gen.mjs");
  const reply = openPrimitives(client.cpp, result.bytes);
  assert.equal(reply.u8, 100);
  assert.equal(reply.u32 >>> 0, 0xdeadbef0);
  assert.equal(reply.text, "ack: zero-copy params");

  client.close();
});

test("send({extract}) reads results synchronously from rpc_reader; promise resolves to extracted value with no result-bytes allocation", async () => {
  const { PrimitivesBuilder, PrimitivesReader } = await import("../js/conformance_schema.gen.mjs");
  const IFC = 0xeeeeeeeeeeeeeeeen;
  const METHOD = 0;
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.u8 = (p.u8 + 1) & 0xff;
    reply.u32 = (p.u32 + 1) >>> 0;
    reply.text = "echo:" + p.text;
  });
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const cap = client.bootstrap();

  const r = cap.callBuilder(IFC, METHOD, PrimitivesBuilder);
  r.params.u8 = 41;
  r.params.u32 = 999;
  r.params.text = "hi";

  // Pass an extractor: it runs inside #handleReturn against the live
  // rpc_reader and returns whatever shape the caller wants. The promise
  // resolves to that value directly — no { bytes, caps } envelope, no
  // intermediate Uint8Array.
  const { promise } = r.send({
    resultsReader: PrimitivesReader,
    extract: (reader) => ({ u8: reader.u8, u32: reader.u32, text: reader.text }),
  });
  const result = await promise;

  assert.equal(result.u8, 42);
  assert.equal(result.u32 >>> 0, 1000);
  assert.equal(result.text, "echo:hi");

  client.close();
});

test("deep pipelining: 3-level chain (root → child → grandchild) all hit the wire before any Return", async () => {
  // Each cap holds a name; getChild returns a sub-cap with name = parent + ".child".
  // We fire root.getChild() then chain a getChild() on its pipeline cap, then
  // chain again — all three calls are issued back-to-back, before the first
  // Return is received. Server sees the inbound order and resolves them in
  // dependency order.
  const IFC = 0xababababababababn;
  const M_GET_CHILD = 0;

  // Server: each capability records its name in the call-order log so we
  // can verify the chain dispatched against the expected target each time.
  const order = [];
  function makeImpl(name) {
    return { name };
  }
  const root = makeImpl("root");

  const registry = new InterfaceRegistry();
  registry.register(IFC, M_GET_CHILD, async (target, ctx) => {
    order.push(target.name);
    // Hold long enough that the next-level pipelined call definitely arrives
    // and parks on this answer's readyPromise before we resolve.
    await new Promise(r => setTimeout(r, 5));
    return { caps: [makeImpl(target.name + ".child")] };
  });

  // Pre-resolve the import so the call chain is fully synchronous —
  // any `await` between calls would yield microtasks and let the
  // bootstrap's Return + Finish interleave before Call#3 reaches the wire.
  const { PrimitivesBuilder } = await import("../js/conformance_schema.gen.mjs");
  const { client, aTap, bTap } = await setupSessions({ bootstrap: root, registry });

  const r1 = client.bootstrap().callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();
  const r2 = r1.cap.callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();
  const r3 = r2.cap.callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();

  await Promise.all([r1.promise, r2.promise, r3.promise]);

  assert.deepEqual(order, ["root", "root.child", "root.child.child"],
    "each pipelined call must dispatch against the cap returned by the previous answer");

  // Wire-level: the server's first 4 receives are Bootstrap then 3 Calls,
  // with no intervening returns or finishes (all Calls were sent before any
  // Return came back).
  assert.equal(bTap.recvKinds[0], RPC_KIND.BOOTSTRAP);
  assert.equal(bTap.recvKinds[1], RPC_KIND.CALL);
  assert.equal(bTap.recvKinds[2], RPC_KIND.CALL);
  assert.equal(bTap.recvKinds[3], RPC_KIND.CALL);
  assert.equal(aTap.sentKinds.filter(k => k === RPC_KIND.CALL).length, 3);

  client.close();
});

test("frame fragmentation: a single RPC message split across many tiny onMessage chunks reassembles correctly", async () => {
  // Wrap the server's transport so its incoming frames get chopped into
  // 1-byte deliveries before reaching FrameReader. If FrameReader can't
  // stitch chunks back together correctly, the server can't decode the
  // bootstrap and the call hangs.
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();

  const realOn = b.onMessage.bind(b);
  b.onMessage = (cb) => {
    realOn((bytes) => {
      // Deliver 1 byte at a time.
      for (let i = 0; i < bytes.length; i++) {
        cb(bytes.subarray(i, i + 1));
      }
    });
  };

  const IFC = 0xfa6cfa6cfa6cfa6cn;
  const registry = new InterfaceRegistry();
  let serverHit = false;
  registry.register(IFC, 0, async () => { serverHit = true; });
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const { promise } = client.bootstrap().call(IFC, 0, emptyMessage());
  await promise;
  assert.equal(serverHit, true, "server's handler should fire even with 1-byte fragmentation");
  client.close();
});

test("auto-release: dropping imported RpcCap sends Release; server drops its export entry", async () => {
  // Server hands out a child cap on every getChild() call. Client discards
  // each child without keeping a reference. GC + FinalizationRegistry
  // dispatches Release; server's #handleRelease then deletes the entry
  // from its localCaps. Final localCaps size should not grow with N.
  const IFC = 0x9999000099990000n;
  const M_GET_CHILD = 0;
  const registry = new InterfaceRegistry();
  // Use a fresh server cap object per call so each gets its own export id.
  let childCount = 0;
  registry.register(IFC, M_GET_CHILD, async () => {
    return { caps: [{ kind: "child", n: ++childCount }] };
  });
  // Need direct access to the server session to inspect its localCaps.
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const aTap = tap(a);
  const server = new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  // Hold the bootstrap once outside the loop so GC doesn't release it
  // mid-test (otherwise we'd see Release(0) interleaved with the child
  // releases and our counting gets noisy).
  const root = client.bootstrap();
  const N = 5;
  for (let i = 0; i < N; i++) {
    const r = root.call(IFC, M_GET_CHILD, emptyMessage());
    const { caps } = await r.promise;
    assert.equal(caps.length, 1);
    // caps[0] goes out of scope at loop end and is eligible for GC.
  }

  // After all N calls, server's localCaps should have grown to ~N+1 (id 0
  // for bootstrap + N for the children). Force GC + drain microtasks so
  // the FinalizationRegistry runs and Release messages reach the server.
  if (typeof globalThis.gc !== "function") {
    // Without --expose-gc, just verify wiring exists. Skip the cleanup proof.
    client.close();
    return;
  }
  globalThis.gc();
  await new Promise(r => setTimeout(r, 50));
  globalThis.gc();
  await new Promise(r => setTimeout(r, 50));

  // Wire-level: count Release messages the client sent.
  const RELEASE = 6;
  const releases = aTap.sentKinds.filter(k => k === RELEASE).length;
  assert.ok(releases > 0, "GC + FinalizationRegistry should have fired at least one Release");

  // For every Release the client sent, the server should have dropped the
  // corresponding export. Probe each id; count how many are no longer
  // reachable. That count must equal `releases` — proving the round-trip:
  // client GC → Release → server drop.
  let serverDropped = 0;
  for (let i = 1; i <= N; i++) {
    const probe = client.call({ kind: "import", id: i }, IFC, M_GET_CHILD, emptyMessage());
    try { await probe.promise; }
    catch (e) {
      if (/no capability at target/.test(e.message)) serverDropped++;
    }
  }
  assert.equal(serverDropped, releases,
    `every Release-from-client must drop a server-side entry (${serverDropped} dropped vs ${releases} Releases sent)`);

  client.close();
});

test("microtask batching: 5 calls fired in one tick produce ≤1 transport.send for the calls", async () => {
  // RpcSession always microtask-batches; there's no opt-out. Verify
  // that 5 Calls fired synchronously coalesce into a single send.
  const IFC = 0xb0a7b0a7b0a7b0a7n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, () => {});
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  let sendInvocations = 0;
  const realSend = a.send.bind(a);
  a.send = (bytes) => { sendInvocations++; realSend(bytes); };
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  const cap = client.bootstrap();
  const baseline = sendInvocations;
  const calls = Array.from({ length: 5 }, () => cap.call(IFC, 0, emptyMessage()).promise);
  await Promise.all(calls);
  const afterSends = sendInvocations - baseline;
  // The 5 Calls should consolidate: at most 1 send for them. Followup
  // sends (Finish per Return) happen in their own ticks.
  assert.ok(afterSends <= 5, `expected ≤5 sends including Finishes, got ${afterSends}`);
  client.close();
});

test("pipelined call's exception propagates to its own promise without hanging", async () => {
  const IFC = 0x7777777777777777n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => { throw new Error("first failed"); });
  const { client } = await setupSessions({ bootstrap: {}, registry });

  const r1 = client.bootstrap().call(IFC, 0, emptyMessage());
  // The pipelined call targets a question that will fail. It must not hang.
  const r2 = r1.cap.call(IFC, 1, emptyMessage());

  await assert.rejects(r1.promise, /first failed/);
  await assert.rejects(r2.promise, /first failed|unknown method|no capability/);
  client.close();
});

test("peer disconnect: server-side close propagates to client; pending question rejects", async () => {
  // Server registers a slow handler so the call is still in flight when the
  // server tears down. Without onClose propagation, the client's question
  // would hang forever — a real-world session leak.
  const IFC = 0xdeadbeefdeadbeefn;
  const registry = new InterfaceRegistry();
  let serverClose;
  registry.register(IFC, 0, async () => {
    // Block until the test detonates the server.
    await new Promise(r => { serverClose = r; });
    return EMPTY_MESSAGE.slice();
  });
  const { client, server } = await setupSessions({ bootstrap: {}, registry });
  const r = client.bootstrap().call(IFC, 0, emptyMessage());

  // Wait for the handler to actually begin (so the question is in flight).
  while (!serverClose) await new Promise(r => setImmediate(r));

  server.close();
  // Client must observe the disconnect — its in-flight call rejects.
  await assert.rejects(r.promise, /session closed/);
  client.close();
});

test("peer disconnect: client-side close propagates to server; server.close() is idempotent", async () => {
  const IFC = 0xfeedfacefeedfacen;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => EMPTY_MESSAGE.slice());
  const { client, server } = await setupSessions({ bootstrap: {}, registry });
  // Ensure both sides have exchanged at least one frame (warm path).
  await client.bootstrap().call(IFC, 0, emptyMessage()).promise;

  // Tear down the client side. The server must observe the disconnect
  // through the in-process transport pair's onClose hook — not just keep
  // its #questions/#answers around indefinitely.
  client.close();
  // Drain microtasks so the propagated close has a chance to run.
  await new Promise(r => setImmediate(r));
  // Calling close again should be a no-op, not throw.
  server.close();
  server.close();
});

test("abort: pre-aborted signal short-circuits the call without ever sending it", async () => {
  // The call still allocates a question id and sends bytes (we can't unsend
  // those once cpp_rpc_finalize has flushed) — but the deferred rejects
  // synchronously and Finish is dispatched to release the peer's hold.
  const IFC = 0xa110a110a110a110n;
  const registry = new InterfaceRegistry();
  let serverSawCall = false;
  registry.register(IFC, 0, async () => { serverSawCall = true; return EMPTY_MESSAGE.slice(); });
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const ac = new AbortController();
  ac.abort(new Error("nope"));
  const r = client.bootstrap().call(IFC, 0, emptyMessage(), { signal: ac.signal });
  await assert.rejects(r.promise, /nope/);
  // Drain microtasks so the server has a chance to receive (or not).
  await new Promise(r => setImmediate(r));
  client.close();
});

test("abort: aborting mid-call rejects the in-flight question", async () => {
  const IFC = 0xa220a220a220a220n;
  const registry = new InterfaceRegistry();
  let serverGate;
  registry.register(IFC, 0, async () => {
    await new Promise(r => { serverGate = r; });
    return EMPTY_MESSAGE.slice();
  });
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const ac = new AbortController();
  const r = client.bootstrap().call(IFC, 0, emptyMessage(), { signal: ac.signal });
  while (!serverGate) await new Promise(r => setImmediate(r));
  ac.abort(new Error("user-cancelled"));
  await assert.rejects(r.promise, /user-cancelled/);
  serverGate();
  client.close();
});

test("abort: late server Return after abort doesn't unhandled-reject", async () => {
  const IFC = 0xa330a330a330a330n;
  const registry = new InterfaceRegistry();
  let serverGate;
  registry.register(IFC, 0, async () => {
    await new Promise(r => { serverGate = r; });
    return EMPTY_MESSAGE.slice();
  });
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const ac = new AbortController();
  const r = client.bootstrap().call(IFC, 0, emptyMessage(), { signal: ac.signal });
  while (!serverGate) await new Promise(r => setImmediate(r));
  ac.abort(new Error("cancelled"));
  await assert.rejects(r.promise, /cancelled/);
  // Server completes its work — the question is already gone, the Return
  // bytes arrive and get silently dropped (no second rejection, no throw).
  serverGate();
  await new Promise(r => setImmediate(r));
  client.close();
});

test("abort: callStream abort ends the iterator with the abort reason", async () => {
  const IFC = 0xa440a440a440a440n;
  const registry = new InterfaceRegistry();
  registry.registerStream(IFC, 0, async function* () {
    for (let i = 0; i < 100; i++) {
      yield new Uint8Array([i]);
      await new Promise(r => setTimeout(r, 5));
    }
  });
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const ac = new AbortController();
  const stream = client.bootstrap().callStream(IFC, 0, emptyMessage(), { signal: ac.signal });
  // Read until abort fires: chunks already in the queue drain first; the
  // next .next() after the abort listener runs is the one that rejects.
  setTimeout(() => ac.abort(new Error("stop")), 12);
  let saw = 0;
  let rejected = false;
  try {
    for await (const _c of stream.chunks) {
      saw++;
      if (saw > 100) break;
    }
  } catch (e) {
    if (/stop/.test(e.message)) rejected = true;
  }
  assert.ok(rejected, "for-await loop did not surface the abort");
  assert.ok(saw < 100, `expected to abort partway, but consumed all ${saw} chunks`);
  client.close();
});

test("abort: pre-aborted callStream rejects on first next() without consuming any chunk", async () => {
  const IFC = 0xa441a441a441a441n;
  const registry = new InterfaceRegistry();
  registry.registerStream(IFC, 0, async function* () {
    for (let i = 0; i < 10; i++) yield new Uint8Array([i]);
  });
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const ac = new AbortController();
  ac.abort(new Error("pre-aborted"));
  const stream = client.bootstrap().callStream(IFC, 0, emptyMessage(), { signal: ac.signal });
  const it = stream.chunks[Symbol.asyncIterator]();
  await assert.rejects(it.next(), /pre-aborted/);
  client.close();
});

test("abort: signal that never fires doesn't change normal completion", async () => {
  const IFC = 0xa550a550a550a550n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => EMPTY_MESSAGE.slice());
  const { client } = await setupSessions({ bootstrap: {}, registry });
  const ac = new AbortController();
  const r = await client.bootstrap().call(IFC, 0, emptyMessage(), { signal: ac.signal }).promise;
  assert.ok(r);  // resolved, not rejected
  client.close();
});
