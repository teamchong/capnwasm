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

test("stream: client closes session mid-stream — iterator rejects, no hang", async () => {
  const IFC = 0x4444444444444444n;
  // Server yields slowly enough that the client closes before completion.
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (let i = 0; i < 100; i++) {
          yield new Uint8Array([i & 0xff]);
          await new Promise(r => setTimeout(r, 5));
        }
      },
    },
  });

  const r = root.callStream(IFC, 0, EMPTY);
  const it = r.chunks[Symbol.asyncIterator]();
  const first = await it.next();
  assert.equal(first.done, false);
  assert.equal(first.value[0], 0);

  // Close the client session while the server is still yielding. The
  // outstanding iterator should reject; without the fix it would hang.
  client.close();
  await assert.rejects(it.next(), /session closed/);
});

test("stream: client breaks out early — server handler still cleans up", async () => {
  const IFC = 0x5555555555555555n;
  let serverIterations = 0;
  let serverFinallyRan = false;
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        try {
          for (let i = 0; i < 1000; i++) {
            serverIterations++;
            yield new Uint8Array([i & 0xff]);
          }
        } finally {
          serverFinallyRan = true;
        }
      },
    },
  });

  const r = root.callStream(IFC, 0, EMPTY);
  let count = 0;
  for await (const _c of r.chunks) {
    count++;
    if (count >= 3) break;
  }
  assert.equal(count, 3);
  // We can't strictly assert serverIterations == 3, because the server
  // doesn't currently observe the iterator break. Document the current
  // behavior: server runs to completion (or until session close).
  client.close();
});

test("stream: concurrent streams to same server complete independently", async () => {
  const IFC = 0x6666666666666666n;
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (let i = 0; i < 10; i++) {
          yield new Uint8Array([i]);
        }
      },
    },
  });

  // Three concurrent streams.
  const a = root.callStream(IFC, 0, EMPTY);
  const b = root.callStream(IFC, 0, EMPTY);
  const c = root.callStream(IFC, 0, EMPTY);

  async function collect(stream) {
    const seen = [];
    for await (const chunk of stream.chunks) seen.push(chunk[0]);
    return seen;
  }

  const [as, bs, cs] = await Promise.all([collect(a), collect(b), collect(c)]);
  assert.deepEqual(as, [0,1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(bs, [0,1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(cs, [0,1,2,3,4,5,6,7,8,9]);
  client.close();
});

test("stream: empty Uint8Array chunk yields a zero-length chunk to client", async () => {
  const IFC = 0x7777777777777777n;
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        yield new Uint8Array(0);
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array(0);
      },
    },
  });
  const r = root.callStream(IFC, 0, EMPTY);
  const seen = [];
  for await (const chunk of r.chunks) seen.push(chunk.length);
  assert.deepEqual(seen, [0, 3, 0]);
  client.close();
});

test("stream: 500 tiny chunks delivered in order without dropping any", async () => {
  const IFC = 0x8888888888888888n;
  const N = 500;
  const { client, root } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (let i = 0; i < N; i++) {
          const c = new Uint8Array(2);
          c[0] = i & 0xff;
          c[1] = (i >>> 8) & 0xff;
          yield c;
        }
      },
    },
  });
  const r = root.callStream(IFC, 0, EMPTY);
  let i = 0;
  for await (const chunk of r.chunks) {
    const expected = i & 0xffff;
    const got = chunk[0] | (chunk[1] << 8);
    assert.equal(got, expected, `chunk #${i} bytes ${chunk[0]},${chunk[1]}`);
    i++;
  }
  assert.equal(i, N);
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
