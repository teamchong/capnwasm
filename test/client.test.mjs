// High-level client helpers: subscribeQuery + optimistic.
// (createClient itself is tested implicitly via the RPC tests; testing it
// here would require spinning up a real WebSocket server, which the
// existing rpc.test.mjs already does indirectly.)

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import { subscribeQuery, optimistic } from "../js/client.mjs";

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
  new RpcSession(cppB, b, reg, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  return { client, cap: client.bootstrap() };
}

test("subscribeQuery: receives updates from a streaming method", async () => {
  const IFC = 0xc11ec11ec11ec11en;
  const { client, cap } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (let i = 0; i < 5; i++) yield new Uint8Array([i]);
      },
    },
  });
  const sub = subscribeQuery(cap, IFC, 0, EMPTY);
  const seen = [];
  for await (const chunk of sub.updates) seen.push(chunk[0]);
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  client.close();
});

test("subscribeQuery: unsubscribe ends the iterator with the unsubscribe reason", async () => {
  const IFC = 0xc12ec12ec12ec12en;
  const { client, cap } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (let i = 0; i < 100; i++) {
          yield new Uint8Array([i]);
          await new Promise(r => setTimeout(r, 5));
        }
      },
    },
  });
  const sub = subscribeQuery(cap, IFC, 0, EMPTY);
  setTimeout(() => sub.unsubscribe(new Error("user-canceled")), 12);
  let saw = 0;
  let rejected = false;
  try {
    for await (const _ of sub.updates) {
      saw++;
      if (saw > 100) break;
    }
  } catch (e) {
    if (/user-canceled/.test(e.message)) rejected = true;
  }
  assert.ok(rejected, "iterator did not surface the unsubscribe");
  client.close();
});

test("subscribeQuery: external AbortSignal also cancels the stream", async () => {
  const IFC = 0xc13ec13ec13ec13en;
  const { client, cap } = await setup({
    stream: {
      ifc: IFC, method: 0,
      handler: async function* () {
        for (let i = 0; i < 100; i++) {
          yield new Uint8Array([i]);
          await new Promise(r => setTimeout(r, 5));
        }
      },
    },
  });
  const ac = new AbortController();
  const sub = subscribeQuery(cap, IFC, 0, EMPTY, { signal: ac.signal });
  setTimeout(() => ac.abort(new Error("external")), 12);
  await assert.rejects(
    (async () => { for await (const _ of sub.updates) {} })(),
    /external/,
  );
  client.close();
});

test("optimistic: applies locally, returns send result on success", async () => {
  const log = [];
  const result = await optimistic({
    apply: () => { log.push("apply"); return "undo-token"; },
    send: async () => { log.push("send"); return "server-result"; },
    revert: () => { log.push("revert"); },
  });
  assert.equal(result, "server-result");
  assert.deepEqual(log, ["apply", "send"]);
});

test("optimistic: rolls back on send failure with the apply's return value", async () => {
  let revertReceived;
  await assert.rejects(
    optimistic({
      apply: () => "the-undo-token",
      send: async () => { throw new Error("server rejected"); },
      revert: (token) => { revertReceived = token; },
    }),
    /server rejected/,
  );
  assert.equal(revertReceived, "the-undo-token");
});

test("optimistic: revert errors are swallowed; original error wins", async () => {
  await assert.rejects(
    optimistic({
      apply: () => null,
      send: async () => { throw new Error("primary"); },
      revert: () => { throw new Error("secondary"); },
    }),
    /primary/,
  );
});

test("optimistic: apply error short-circuits without sending", async () => {
  let sent = false;
  await assert.rejects(
    optimistic({
      apply: () => { throw new Error("apply-failed"); },
      send: async () => { sent = true; return "x"; },
      revert: () => {},
    }),
    /apply-failed/,
  );
  assert.equal(sent, false, "send must not run if apply threw");
});

test("optimistic: revert is optional (undefined skips rollback)", async () => {
  await assert.rejects(
    optimistic({
      apply: () => 1,
      send: async () => { throw new Error("nope"); },
    }),
    /nope/,
  );
  // The point of this test is just that it rejects cleanly without
  // trying to call a missing revert.
});
