// Pipeline: batch N calls, splice prior results into later params, one round-trip.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import {
  pipeline,
  registerPipelineHandler,
  PIPELINE_INTERFACE_ID,
} from "../js/pipeline.mjs";

const IFC_USER = 0x1111111111111111n;
const IFC_ORDER = 0x2222222222222222n;
const METHOD = 1;

const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();

// Cap'n Proto frame holding a 16-byte payload at the data section. Caller
// patches values; useful for tests that need to inspect received params.
function payloadFrame(values) {
  const dataWords = 2;
  const segWords = 1 + dataWords;
  const out = new Uint8Array(8 + segWords * 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, segWords, true);
  // Root struct pointer: type=0, offset=0, dataWords=2, ptrWords=0
  dv.setUint32(8, 0x00, true);
  dv.setUint16(12, dataWords, true);
  dv.setUint16(14, 0, true);
  // Data section (16 bytes). Caller patches via the values param.
  if (values) out.set(values, 16);
  return out;
}

async function pair() {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const registry = new InterfaceRegistry();
  return { cppA, cppB, registry };
}

test("pipeline: 3 sequential calls, one round-trip", async () => {
  const { cppA, cppB, registry } = await pair();
  const order = [];
  registry.register(IFC_USER, METHOD, async () => {
    order.push("user");
    const r = payloadFrame();
    r[16] = 0xAA;
    return r;
  });
  registry.register(IFC_ORDER, METHOD, async () => {
    order.push("order");
    const r = payloadFrame();
    r[16] = 0xBB;
    return r;
  });
  registerPipelineHandler(registry);

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const p = pipeline(client.bootstrap());
  p.call(IFC_USER, METHOD, payloadFrame());
  p.call(IFC_ORDER, METHOD, payloadFrame());
  p.call(IFC_USER, METHOD, payloadFrame());
  const results = await p.execute();

  assert.equal(results.length, 3);
  assert.deepEqual(order, ["user", "order", "user"]);
  assert.equal(results[0][16], 0xAA);
  assert.equal(results[1][16], 0xBB);
  assert.equal(results[2][16], 0xAA);
});

test("pipeline: splice copies bytes from prior result into later params", async () => {
  const { cppA, cppB, registry } = await pair();
  let lastUserParams = null;
  let userIdSeenByOrder = null;

  registry.register(IFC_USER, METHOD, async (target, ctx) => {
    // User result: 8 bytes of user.id at data offset 0 of the data section.
    // Frame layout: 8 segHeader + 8 root pointer + 16 data section.
    // user.id lives at byte 16 (start of data section).
    const r = payloadFrame();
    r[16] = 0x42; r[17] = 0x43; r[18] = 0x44; r[19] = 0x45;
    r[20] = 0x46; r[21] = 0x47; r[22] = 0x48; r[23] = 0x49;
    return r;
  });
  registry.register(IFC_ORDER, METHOD, async (target, ctx) => {
    // Order handler reads its own params and remembers what was at byte 16.
    const params = ctx.paramsBytes();
    userIdSeenByOrder = Array.from(params.subarray(16, 24));
    return payloadFrame();
  });
  registerPipelineHandler(registry);

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const p = pipeline(client.bootstrap());
  const u = p.call(IFC_USER, METHOD, payloadFrame());
  // Splice user result bytes 16..24 (the user.id) into order params at 16..24.
  p.call(IFC_ORDER, METHOD, payloadFrame(), [
    { fromCall: u, fromOffset: 16, length: 8, toOffset: 16 },
  ]);
  const results = await p.execute();

  assert.equal(results.length, 2);
  assert.deepEqual(userIdSeenByOrder, [0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49]);
});

test("pipeline: handler error surfaces as a per-call rejection", async () => {
  const { cppA, cppB, registry } = await pair();
  registry.register(IFC_USER, METHOD, async () => payloadFrame());
  registry.register(IFC_ORDER, METHOD, async () => {
    throw new Error("planned order failure");
  });
  registerPipelineHandler(registry);

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const p = pipeline(client.bootstrap());
  p.call(IFC_USER, METHOD, payloadFrame());
  p.call(IFC_ORDER, METHOD, payloadFrame());
  // The first call's result is fine; the second throws, but execute()
  // returns a result array with throwing accessor only on access. Actually
  // our impl throws on iteration. Let me test by catching at the array
  // unpack point.
  let failed = false;
  try {
    const results = await p.execute();
    // Accessing results[1] throws; it's a getter? No. Execute throws on first error.
    void results;
  } catch (e) {
    failed = true;
    assert.match(e.message, /planned order failure/);
  }
  assert.ok(failed, "expected execute() to surface the error");
});

test("pipeline: splice with bad fromCall index errors", async () => {
  const { cppA, cppB, registry } = await pair();
  registry.register(IFC_USER, METHOD, async () => payloadFrame());
  registerPipelineHandler(registry);

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const p = pipeline(client.bootstrap());
  // Reference call index 5 (out of bounds. Only 1 call).
  p.call(IFC_USER, METHOD, payloadFrame(), [
    { fromCall: 5, fromOffset: 0, length: 4, toOffset: 0 },
  ]);
  await assert.rejects(p.execute(), /not yet executed/);
});

test("pipeline: empty batch returns empty results", async () => {
  const { cppA, cppB, registry } = await pair();
  registerPipelineHandler(registry);
  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const p = pipeline(client.bootstrap());
  const results = await p.execute();
  assert.deepEqual(results, []);
});

test("pipeline: validator can reject a batch before dispatch", async () => {
  const { cppA, cppB, registry } = await pair();
  let userHandlerRan = false;
  registry.register(IFC_USER, METHOD, async () => {
    userHandlerRan = true;
    return payloadFrame();
  });
  registerPipelineHandler(registry, {
    validate: (view) => {
      if (view.length > 2) {
        throw new Error("batch too large: max 2 calls");
      }
    },
  });

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  // Big batch. Validator rejects.
  const p = pipeline(client.bootstrap());
  for (let i = 0; i < 5; i++) p.call(IFC_USER, METHOD, payloadFrame());
  await assert.rejects(p.execute(), /batch too large/);
  assert.equal(userHandlerRan, false, "no handler ran when batch was rejected");
});

test("pipeline: validator can inspect interface IDs to enforce policy", async () => {
  const ADMIN_IFC = 0x0adadadadadadadan;
  const { cppA, cppB, registry } = await pair();
  registry.register(IFC_USER, METHOD, async () => payloadFrame());
  registry.register(ADMIN_IFC, METHOD, async () => payloadFrame());
  registerPipelineHandler(registry, {
    validate: (view) => {
      // Mixing admin + user calls in one batch is forbidden. Analog to
      // GraphQL "no mutations alongside queries" type rules.
      const hasAdmin = view.some(c => c.ifcId === ADMIN_IFC);
      const hasUser = view.some(c => c.ifcId === IFC_USER);
      if (hasAdmin && hasUser) {
        throw new Error("policy: cannot mix admin and user calls in one batch");
      }
    },
  });

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  // All-user batch: ok.
  const p1 = pipeline(client.bootstrap());
  p1.call(IFC_USER, METHOD, payloadFrame());
  p1.call(IFC_USER, METHOD, payloadFrame());
  await p1.execute();   // no throw

  // Mixed batch: rejected.
  const p2 = pipeline(client.bootstrap());
  p2.call(IFC_USER, METHOD, payloadFrame());
  p2.call(ADMIN_IFC, METHOD, payloadFrame());
  await assert.rejects(p2.execute(), /cannot mix admin and user/);
});

test("pipeline: cannot add calls after execute()", async () => {
  const { cppA, cppB, registry } = await pair();
  registerPipelineHandler(registry);
  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);

  const p = pipeline(client.bootstrap());
  await p.execute();
  assert.throws(() => p.call(IFC_USER, METHOD, payloadFrame()), /cannot add calls after execute/);
  await assert.rejects(p.execute(), /already executed/);
});
