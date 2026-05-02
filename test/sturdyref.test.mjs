// Sturdyref: persist a cap, get a token, hand the token back later (even on
// a fresh session) to recover a cap pointing at the same target.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import {
  InMemorySturdyrefStore,
  registerSturdyrefHandlers,
  persist,
  restoreRef,
  STURDYREF_INTERFACE_ID,
  STURDYREF_METHOD_RESTORE,
} from "../js/sturdyref.mjs";

const IFC = 0x1234567890abcdefn;
const METHOD = 1;

const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

// Server-side bootstrap object that doubles as a cap target. Its handler
// bumps a counter so we can verify a restored cap really hits the same
// object as the original one.
function makeTarget(label) {
  const counter = [0];
  return { label, counter };
}

async function makeServer(store, target) {
  const cpp = await loadWasm();
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async (t) => {
    t.counter[0] += 1;
    return emptyMessage();
  });
  registerSturdyrefHandlers(registry, store);
  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cpp, b, registry, { bootstrap: target });
  return { cpp, server, transport: a };
}

async function makeClient(transport) {
  const cpp = await loadWasm();
  const session = new RpcSession(cpp, transport);
  return { cpp, session };
}

test("sturdyref: persist + restore in same process", async () => {
  const store = new InMemorySturdyrefStore();
  const target = makeTarget("alpha");
  const server = await makeServer(store, target);

  const { session: client } = await makeClient(server.transport);
  const cap = client.bootstrap();

  const token = await persist(cap);
  assert.ok(token instanceof Uint8Array, "token is bytes");
  assert.ok(token.length >= 8 + 32, "token has magic + version + payload");
  assert.equal(store.size, 1, "store has one entry");

  const restored = await restoreRef(client.bootstrap(), token);
  assert.ok(restored, "restored cap exists");

  await restored.call(IFC, METHOD, emptyMessage(), []).promise;
  assert.equal(target.counter[0], 1, "restored cap hits the same target");
});

test("sturdyref: token survives a session reconnect", async () => {
  const store = new InMemorySturdyrefStore();
  const target = makeTarget("beta");

  // First session: get a token, then tear down.
  let server1 = await makeServer(store, target);
  const { session: client1 } = await makeClient(server1.transport);
  const token = await persist(client1.bootstrap());
  client1.close();
  server1.server.close();

  // New transport pair, new sessions. Same store + same target object -
  // the only durable thing is the store. Token should still resolve.
  const server2 = await makeServer(store, target);
  const { session: client2 } = await makeClient(server2.transport);

  const restored = await restoreRef(client2.bootstrap(), token);
  await restored.call(IFC, METHOD, emptyMessage(), []).promise;
  assert.equal(target.counter[0], 1, "restored cap on new session hits target");
});

test("sturdyref: invalid token rejected", async () => {
  const store = new InMemorySturdyrefStore();
  const target = makeTarget("gamma");
  const server = await makeServer(store, target);
  const { session: client } = await makeClient(server.transport);

  // Build a params payload with garbage bytes (not a valid token).
  const garbage = new Uint8Array(40);
  garbage.fill(0xff);
  await assert.rejects(
    restoreRef(client.bootstrap(), garbage),
    /bad magic/,
  );
});

test("sturdyref: unknown token rejected", async () => {
  const store = new InMemorySturdyrefStore();
  const target = makeTarget("delta");
  const server = await makeServer(store, target);
  const { session: client } = await makeClient(server.transport);

  // Real-shape token, but not in the store.
  const fake = new Uint8Array(8 + 32);
  fake[0] = 0x43; fake[1] = 0x57; fake[2] = 0x53; fake[3] = 0x52;  // "CWSR"
  new DataView(fake.buffer).setUint32(4, 1, true);
  for (let i = 0; i < 32; i++) fake[8 + i] = (i * 13) & 0xff;
  await assert.rejects(
    restoreRef(client.bootstrap(), fake),
    /token not found/,
  );
});

test("sturdyref: forget removes the token", async () => {
  const store = new InMemorySturdyrefStore();
  const target = makeTarget("epsilon");
  const server = await makeServer(store, target);
  const { session: client } = await makeClient(server.transport);

  const token = await persist(client.bootstrap());
  assert.equal(store.size, 1);
  // The store payload is the inner bytes. Strip the 8-byte frame.
  const payload = token.subarray(8);
  assert.equal(store.forget(payload), true);
  assert.equal(store.size, 0);
  await assert.rejects(
    restoreRef(client.bootstrap(), token),
    /token not found/,
  );
});

test("sturdyref: registerSturdyrefHandlers validates inputs", () => {
  const store = new InMemorySturdyrefStore();
  assert.throws(() => registerSturdyrefHandlers(null, store), /registry is required/);
  assert.throws(() => registerSturdyrefHandlers(new InterfaceRegistry(), {}), /must implement mint/);
});
