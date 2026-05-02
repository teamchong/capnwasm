// Three-party handoff: Alice introduces Carol to Bob's cap, Carol calls Bob
// directly without Alice in the path.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import {
  InMemoryHandoffStore,
  registerHandoffHandlers,
  introduce,
  redeem,
} from "../js/handoff.mjs";

const IFC = 0x55aa55aa55aa55aan;
const METHOD = 1;

const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

// Bob: holds the resource (counter); Alice and Carol both connect to Bob.
async function makeBob(store, target) {
  const cpp = await loadWasm();
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async (t) => {
    t.counter[0] += 1;
    return emptyMessage();
  });
  registerHandoffHandlers(registry, store);
  const { a: aliceConn, b: bobAlice } = createMemoryTransportPair();
  const { a: carolConn, b: bobCarol } = createMemoryTransportPair();
  // Bob runs two sessions. One per peer. Real deployments would be one
  // ws-server with one session per accepted connection.
  const cppForAlice = await loadWasm();
  const cppForCarol = await loadWasm();
  new RpcSession(cppForAlice, bobAlice, registry, { bootstrap: target });
  new RpcSession(cppForCarol, bobCarol, registry, { bootstrap: target });
  return { aliceConn, carolConn };
}

test("handoff: alice introduces carol to bob, carol calls bob directly", async () => {
  const store = new InMemoryHandoffStore();
  const target = { counter: [0] };
  const { aliceConn, carolConn } = await makeBob(store, target);

  const cppAlice = await loadWasm();
  const cppCarol = await loadWasm();
  const aliceSession = new RpcSession(cppAlice, aliceConn);
  const carolSession = new RpcSession(cppCarol, carolConn);

  // Alice gets Bob's bootstrap, asks Bob to mint a token bound to Carol.
  const aliceCapOnBob = aliceSession.bootstrap();
  const token = await introduce(aliceCapOnBob, "carol");
  assert.ok(token instanceof Uint8Array);
  assert.equal(store.size, 1);

  // Carol redeems with her bootstrap on Bob. Gets a cap on the same target.
  const carolBootstrap = carolSession.bootstrap();
  const carolCap = await redeem(carolBootstrap, token, "carol");
  await carolCap.call(IFC, METHOD, emptyMessage(), []).promise;

  assert.equal(target.counter[0], 1, "carol's call hit bob's target directly");
});

test("handoff: wrong recipient cannot redeem", async () => {
  const store = new InMemoryHandoffStore();
  const target = { counter: [0] };
  const { aliceConn, carolConn } = await makeBob(store, target);

  const cppAlice = await loadWasm();
  const cppCarol = await loadWasm();
  const aliceSession = new RpcSession(cppAlice, aliceConn);
  const carolSession = new RpcSession(cppCarol, carolConn);

  const token = await introduce(aliceSession.bootstrap(), "carol");
  await assert.rejects(
    redeem(carolSession.bootstrap(), token, "eve"),
    /not redeemable for this recipient/,
  );
  assert.equal(target.counter[0], 0, "no call happened on rejection");
});

test("handoff: consumeOnRedeem makes token one-shot", async () => {
  const store = new InMemoryHandoffStore({ consumeOnRedeem: true });
  const target = { counter: [0] };
  const { aliceConn, carolConn } = await makeBob(store, target);

  const cppAlice = await loadWasm();
  const cppCarol = await loadWasm();
  const aliceSession = new RpcSession(cppAlice, aliceConn);
  const carolSession = new RpcSession(cppCarol, carolConn);

  const token = await introduce(aliceSession.bootstrap(), "carol");
  await redeem(carolSession.bootstrap(), token, "carol");
  // Second redemption fails. Entry was consumed.
  await assert.rejects(
    redeem(carolSession.bootstrap(), token, "carol"),
    /not redeemable/,
  );
});

test("handoff: pluggable verifier (e.g. signature check)", async () => {
  // Fake signature scheme: identity is "<key>:<sig>"; valid iff sig === sha-ish(expected||key).
  const fakeSign = (key, expected) => `${key}:${[...expected].reverse().join("") + key}`;
  const verify = (claimed, expected) => {
    const [key, sig] = claimed.split(":");
    return sig === [...expected].reverse().join("") + key;
  };
  const store = new InMemoryHandoffStore({ verify });
  const target = { counter: [0] };
  const { aliceConn, carolConn } = await makeBob(store, target);

  const cppAlice = await loadWasm();
  const cppCarol = await loadWasm();
  const aliceSession = new RpcSession(cppAlice, aliceConn);
  const carolSession = new RpcSession(cppCarol, carolConn);

  // Alice mints for "carol"; Carol presents key=alpha + valid sig.
  const token = await introduce(aliceSession.bootstrap(), "carol");
  const carolProof = fakeSign("alpha", "carol");
  const cap = await redeem(carolSession.bootstrap(), token, carolProof);
  await cap.call(IFC, METHOD, emptyMessage(), []).promise;
  assert.equal(target.counter[0], 1);

  // Bad sig is rejected.
  await assert.rejects(
    redeem(carolSession.bootstrap(), token, "alpha:wrongsig"),
    /not redeemable/,
  );
});

test("handoff: invalid token rejected", async () => {
  const store = new InMemoryHandoffStore();
  const target = { counter: [0] };
  const { aliceConn } = await makeBob(store, target);
  const cppAlice = await loadWasm();
  const aliceSession = new RpcSession(cppAlice, aliceConn);

  const garbage = new Uint8Array(40);
  garbage.fill(0xff);
  await assert.rejects(
    redeem(aliceSession.bootstrap(), garbage, "carol"),
    /bad magic/,
  );
});

test("handoff: input validation", () => {
  assert.throws(() => registerHandoffHandlers(null, new InMemoryHandoffStore()), /registry is required/);
  assert.throws(() => registerHandoffHandlers(new InterfaceRegistry(), {}), /must implement mint/);
});
