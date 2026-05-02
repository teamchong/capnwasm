// Capnweb-wire compat shim tested against the actual capnweb library.
// Stand up a capnweb RpcSession in-process, point our JsonWireSession at
// it via a MessageChannel pair, and verify a method call round-trips.
//
// Skips if the local capnweb sibling repo isn't built. The test relies
// on the dist/ output being present at ../capnweb/dist/index.js.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JsonWireSession, messagePortTransport } from "../js/capnweb_wire.mjs";

const CAPNWEB_DIST = resolve(import.meta.dirname, "..", "..", "capnweb", "dist", "index.js");
const skip = !existsSync(CAPNWEB_DIST);
if (skip) {
  test("capnweb-wire: skipped (capnweb dist not present at ../capnweb/dist)", { skip: true }, () => {});
}

async function loadCapnweb() {
  return await import(CAPNWEB_DIST);
}

test("capnweb-wire: capnwasm client → capnweb server, simple method call", { skip }, async () => {
  const { newMessagePortRpcSession } = await loadCapnweb();
  const channel = new MessageChannel();
  // Server side: capnweb RpcSession exposing a tiny RpcTarget.
  const main = {
    echo(s) { return `echoed:${s}`; },
    add(a, b) { return a + b; },
  };
  newMessagePortRpcSession(channel.port1, main);

  // Client side: our JsonWireSession.
  const client = new JsonWireSession(messagePortTransport(channel.port2));
  const r1 = await client.call(["echo"], ["hello"]);
  assert.equal(r1, "echoed:hello");
  const r2 = await client.call(["add"], [2, 40]);
  assert.equal(r2, 42);
  client.close();
});

test("capnweb-wire: capnwasm client receives an Error from a capnweb server", { skip }, async () => {
  const { newMessagePortRpcSession } = await loadCapnweb();
  const channel = new MessageChannel();
  const main = {
    boom() { throw new Error("planned failure"); },
  };
  newMessagePortRpcSession(channel.port1, main);

  const client = new JsonWireSession(messagePortTransport(channel.port2));
  await assert.rejects(client.call(["boom"], []), /planned failure/);
  client.close();
});

test("capnweb-wire: BigInt + Date + Uint8Array round-trip", { skip }, async () => {
  const { newMessagePortRpcSession } = await loadCapnweb();
  const channel = new MessageChannel();
  const main = {
    bigInt(x)    { return x + 1n; },
    nextDay(d)   { return new Date(d.getTime() + 86_400_000); },
    sumBytes(u8) { let s = 0; for (const b of u8) s += b; return s; },
  };
  newMessagePortRpcSession(channel.port1, main);

  const client = new JsonWireSession(messagePortTransport(channel.port2));
  const big = await client.call(["bigInt"], [9007199254740993n]);
  assert.equal(big, 9007199254740994n);
  const d = await client.call(["nextDay"], [new Date(0)]);
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), 86_400_000);
  const sum = await client.call(["sumBytes"], [new Uint8Array([1, 2, 3, 4, 5])]);
  assert.equal(sum, 15);
  client.close();
});

test("capnweb-wire: nested object + array literal", { skip }, async () => {
  const { newMessagePortRpcSession } = await loadCapnweb();
  const channel = new MessageChannel();
  const main = {
    summarize(obj) { return { count: obj.items.length, first: obj.items[0] }; },
  };
  newMessagePortRpcSession(channel.port1, main);

  const client = new JsonWireSession(messagePortTransport(channel.port2));
  const r = await client.call(["summarize"], [{ items: ["a", "b", "c"] }]);
  assert.deepEqual(r, { count: 3, first: "a" });
  client.close();
});
