// End-to-end test of the streaming RPC extension.
// Server registers an async-generator handler; client iterates the chunks
// via cap.callStream(...).chunks as an AsyncIterable.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";

const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();

async function setup({ stream } = {}) {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const reg = new InterfaceRegistry();
  if (stream) reg.registerStream(stream.ifc, stream.method, stream.handler);
  new RpcSession(cppB, b, reg, { bootstrap: { kind: "stream-server" } });
  const client = new RpcSession(cppA, a);
  return { client, root: client.bootstrap() };
}

test("stream: server emits N chunks; client iterates them in order", async () => {
  const IFC = 0xabcdef0123456789n;
  const N = 25;
  const { client, root } = await setup({
    stream: {
      ifc: IFC,
      method: 0,
      handler: async function* (target, ctx) {
        for (let i = 0; i < N; i++) {
          // chunk = single u32 LE.
          const c = new Uint8Array(4);
          new DataView(c.buffer).setUint32(0, i, true);
          yield c;
        }
      },
    },
  });

  const r = root.callStream(IFC, 0, EMPTY);
  const seen = [];
  for await (const chunk of r.chunks) {
    seen.push(new DataView(chunk.buffer, chunk.byteOffset).getUint32(0, true));
  }
  assert.equal(seen.length, N);
  for (let i = 0; i < N; i++) assert.equal(seen[i], i);
  client.close();
});

test("stream: handler that yields nothing produces an empty iteration", async () => {
  const IFC = 0x1111111111111111n;
  const { client, root } = await setup({
    stream: { ifc: IFC, method: 0, handler: async function* () { /* nothing */ } },
  });
  const r = root.callStream(IFC, 0, EMPTY);
  let count = 0;
  for await (const _ of r.chunks) count++;
  assert.equal(count, 0);
  client.close();
});

test("stream: handler that throws surfaces as a rejection on next()", async () => {
  const IFC = 0x2222222222222222n;
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        yield new Uint8Array([0xaa]);
        throw new Error("server blew up mid-stream");
      },
    },
  });
  const r = root.callStream(IFC, 0, EMPTY);
  const it = r.chunks[Symbol.asyncIterator]();
  const first = await it.next();
  assert.equal(first.value[0], 0xaa);
  // Next call should reject because the handler threw.
  await assert.rejects(it.next(), /server blew up mid-stream/);
  client.close();
});

test("stream: chunks of varying sizes round-trip byte-perfectly", async () => {
  const IFC = 0x3333333333333333n;
  const sizes = [1, 100, 1000, 5000, 50000];
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (const n of sizes) {
          const c = new Uint8Array(n);
          for (let i = 0; i < n; i++) c[i] = (i * 7) & 0xff;
          yield c;
        }
      },
    },
  });
  const r = root.callStream(IFC, 0, EMPTY);
  const collected = [];
  for await (const c of r.chunks) collected.push(c);
  assert.equal(collected.length, sizes.length);
  for (let i = 0; i < sizes.length; i++) {
    assert.equal(collected[i].length, sizes[i]);
    for (let j = 0; j < sizes[i]; j++) {
      assert.equal(collected[i][j], (j * 7) & 0xff);
    }
  }
  client.close();
});
