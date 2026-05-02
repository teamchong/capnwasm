// Per-stream credit-based flow control. Verifies that when the client opts
// into windowSize, the server pauses its generator until credits arrive.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";

const IFC = 0xf10cf10cf10cf10cn;
const METHOD = 1;

const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

// Server stream that emits N chunks. Records the chunk index at the moment
// each yield is *attempted* (before the server-side credit check), so the
// test can verify the generator paused at the credit boundary.
function makeStreamFixture({ totalChunks }) {
  const yieldedAt = [];        // chunkIdx → ms timestamp the yield happened
  let yieldCount = 0;
  const stream = async function* () {
    for (let i = 0; i < totalChunks; i++) {
      yieldedAt.push({ idx: i, t: performance.now() });
      yieldCount += 1;
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setUint32(0, i, true);
      yield buf;
    }
  };
  return { stream, yieldedAt, getYieldCount: () => yieldCount };
}

async function pair(handler) {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const registry = new InterfaceRegistry();
  registry.registerStream(IFC, METHOD, handler);
  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  return { client, server };
}

test("flow control: no windowSize → unbounded (current behavior)", async () => {
  const fix = makeStreamFixture({ totalChunks: 50 });
  const { client } = await pair(fix.stream);

  const r = client.bootstrap().callStream(IFC, METHOD, emptyMessage(), {});
  const seen = [];
  for await (const chunk of r.chunks) {
    seen.push(new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(0, true));
  }
  assert.equal(seen.length, 50);
  assert.equal(fix.getYieldCount(), 50);
});

test("flow control: windowSize=4 pauses the generator until credits replenish", async () => {
  const fix = makeStreamFixture({ totalChunks: 20 });
  const { client } = await pair(fix.stream);

  const r = client.bootstrap().callStream(IFC, METHOD, emptyMessage(), { windowSize: 4 });
  const it = r.chunks[Symbol.asyncIterator]();

  // Consume the first 2 chunks. The server should have been able to send up
  // to 4 (the initial window), then paused. With refill threshold = window/2
  // = 2, after we consume 2 chunks the client sends a WINDOW(2). Server now
  // has 2 more credits available, sends 2 more chunks then pauses again.
  const a = await it.next(); assert.equal(a.done, false);
  const b = await it.next(); assert.equal(b.done, false);

  // Yield to the event loop a few times so any pending sends/receives flush.
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 5));

  // At this point the server has yielded somewhere between 4 and 6. It sent
  // the initial 4-window worth, then on the WINDOW(2) refill another 2.
  // It should NOT have yielded all 20 yet.
  const yielded = fix.getYieldCount();
  assert.ok(yielded < 20, `expected generator paused, got ${yielded} yields`);
  assert.ok(yielded >= 4, `expected at least the initial window, got ${yielded}`);

  // Now drain the rest. Each next() triggers further refills, eventually
  // letting the server complete.
  let count = 2;
  while (true) {
    const r = await it.next();
    if (r.done) break;
    count += 1;
  }
  assert.equal(count, 20);
  assert.equal(fix.getYieldCount(), 20);
});

test("flow control: windowSize=1 forces strict one-at-a-time", async () => {
  const fix = makeStreamFixture({ totalChunks: 5 });
  const { client } = await pair(fix.stream);

  const r = client.bootstrap().callStream(IFC, METHOD, emptyMessage(), { windowSize: 1 });
  const seen = [];
  for await (const chunk of r.chunks) {
    seen.push(new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(0, true));
    // Synthetic slow consumer: yield to event loop. With windowSize=1 the
    // server should be paused after each chunk, waiting for the WINDOW(1)
    // refill that fires when this loop iterates.
    await new Promise(r => setTimeout(r, 5));
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
});

test("flow control: error after pause still propagates to client", async () => {
  let yieldCount = 0;
  const stream = async function* () {
    for (let i = 0; i < 10; i++) {
      yieldCount += 1;
      yield new Uint8Array(8);
      if (i === 2) throw new Error("planned");
    }
  };
  const { client } = await pair(stream);

  const r = client.bootstrap().callStream(IFC, METHOD, emptyMessage(), { windowSize: 4 });
  const errs = [];
  try {
    for await (const _chunk of r.chunks) {
      await new Promise(r => setTimeout(r, 5));
    }
  } catch (e) {
    errs.push(e.message);
  }
  assert.equal(errs.length, 1);
  assert.match(errs[0], /planned/);
});
