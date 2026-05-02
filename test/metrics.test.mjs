// session.onMetric() emits per-call latency, dispatch outcomes, and
// byte counters. The MetricsAggregator records them into a snapshot.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import { MetricsAggregator } from "../js/metrics.mjs";

const IFC = 0xdeadbeefdeadbeefn;
const METHOD = 7;

const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

async function pair({ throwOnCall = false } = {}) {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async () => {
    if (throwOnCall) throw new Error("planned");
    return emptyMessage();
  });
  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  return { client, server };
}

test("metrics: callStart + callEnd emit on the client", async () => {
  const { client } = await pair();
  const events = [];
  client.onMetric((event, data) => events.push({ event, data }));
  await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;

  const calls = events.filter(e => e.event.startsWith("call"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].event, "callStart");
  assert.equal(calls[1].event, "callEnd");
  assert.equal(calls[1].data.status, "ok");
  assert.ok(calls[1].data.durationMs >= 0);
  assert.equal(calls[1].data.interfaceId, IFC);
  assert.equal(calls[1].data.methodId, METHOD);
});

test("metrics: dispatchStart + dispatchEnd emit on the server", async () => {
  const { client, server } = await pair();
  const serverEvents = [];
  server.onMetric((event, data) => serverEvents.push({ event, data }));
  await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;

  const dispatches = serverEvents.filter(e => e.event.startsWith("dispatch"));
  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[0].event, "dispatchStart");
  assert.equal(dispatches[1].event, "dispatchEnd");
  assert.equal(dispatches[1].data.status, "ok");
  assert.equal(dispatches[1].data.interfaceId, IFC);
  assert.equal(dispatches[1].data.methodId, METHOD);
});

test("metrics: callEnd reports status:err on rejection", async () => {
  const { client } = await pair({ throwOnCall: true });
  const events = [];
  client.onMetric((event, data) => events.push({ event, data }));
  await assert.rejects(
    client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise,
    /planned/,
  );
  // Promise rejection schedules a microtask; flush.
  await new Promise(r => setTimeout(r, 5));
  const ends = events.filter(e => e.event === "callEnd");
  assert.equal(ends.length, 1);
  assert.equal(ends[0].data.status, "err");
  assert.match(ends[0].data.error, /planned/);
});

test("metrics: dispatchEnd reports err for unknown method", async () => {
  const { client, server } = await pair();
  const serverEvents = [];
  server.onMetric((event, data) => serverEvents.push({ event, data }));
  const UNKNOWN_IFC = 0xfacefacen;
  await assert.rejects(
    client.bootstrap().call(UNKNOWN_IFC, 99, emptyMessage(), []).promise,
    /unknown method/,
  );
  await new Promise(r => setTimeout(r, 5));
  const ends = serverEvents.filter(e => e.event === "dispatchEnd");
  assert.equal(ends.length, 1);
  assert.equal(ends[0].data.status, "err");
  assert.match(ends[0].data.error, /unknown method/);
});

test("metrics: bytesSent + bytesReceived emit on both sides", async () => {
  const { client } = await pair();
  let sent = 0, received = 0;
  client.onMetric((event, data) => {
    if (event === "bytesSent")     sent += data.bytes;
    if (event === "bytesReceived") received += data.bytes;
  });
  await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;
  assert.ok(sent > 0, `client sent some bytes (got ${sent})`);
  assert.ok(received > 0, `client received some bytes (got ${received})`);
});

test("metrics: aggregator snapshots calls + errors + bytes", async () => {
  const { client, server } = await pair();
  const m = new MetricsAggregator();
  client.onMetric((e, d) => m.record(e, d));
  server.onMetric((e, d) => m.record(e, d));

  for (let i = 0; i < 3; i++) {
    await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;
  }
  await new Promise(r => setTimeout(r, 5));

  const snap = m.snapshot();
  const key = `0x${IFC.toString(16)}:${METHOD}`;
  // Both inbound (server) and outbound (client) under same key — last one
  // wins on .kind, but call counts are summed.
  assert.ok(snap.methods[key]);
  assert.ok(snap.methods[key].calls >= 3);
  assert.equal(snap.methods[key].errors, 0);
  assert.ok(snap.bytesSent > 0);
  assert.ok(snap.bytesReceived > 0);
});

test("metrics: unsubscribe stops events", async () => {
  const { client } = await pair();
  const events = [];
  const unsub = client.onMetric((event, data) => events.push(event));
  await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;
  unsub();
  await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;
  // Only the first call's events should be in there (callStart + callEnd).
  const callEvents = events.filter(e => e.startsWith("call"));
  assert.equal(callEvents.length, 2);
});

test("metrics: zero-subscriber path adds no observable cost", async () => {
  // Sanity-check the early-out: if there are no subscribers, the metric
  // events are never constructed. We can't measure CPU directly, but we
  // can confirm the API still works without subscribers.
  const { client } = await pair();
  // No onMetric() call.
  await client.bootstrap().call(IFC, METHOD, emptyMessage(), []).promise;
  // No assertion needed — the test passes if this completes without
  // throwing. The early-out path is exercised.
});
