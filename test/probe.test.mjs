// Drift probe. Manifest-vs-runtime conformance check.
//
// End-to-end: spin up real capnp + REST mocks, probe them, assert the
// report content matches what we sent back.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { probe } from "../js/probe.mjs";
import { buildManifest } from "../js/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let cpp;
async function getCpp() {
  if (cpp) return cpp;
  cpp = await (await import(`${ROOT}/dist/inlined.mjs`)).load();
  return cpp;
}

// ---- Capnp probe -----------------------------------------------------

test("probe: capnp method round-trips and reports readable fields", async () => {
  const cppA = await getCpp();
  const cppB = await (await import(`${ROOT}/dist/inlined.mjs`)).load();
  const { RpcSession, InterfaceRegistry, createMemoryTransportPair } =
    await import(`${ROOT}/js/rpc.mjs`);

  // Build manifest: one interface with one method (UserService.getUser).
  const IFC_ID = 0xab1234ff00cc0001n;
  const manifest = buildManifest({
    interfaces: [{
      name: "UserService", id: IFC_ID,
      methods: [{ id: 0, name: "getUser" }],
    }],
    structs: [
      {
        name: "getUser$Params", dataWords: 1, ptrWords: 0,
        fields: [{ name: "id", ordinal: 0, type: "UInt64", kind: "data", bitOffset: 0 }],
      },
      {
        name: "getUser$Results", dataWords: 0, ptrWords: 2,
        fields: [
          { name: "name",  ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 },
          { name: "email", ordinal: 1, type: "Text", kind: "pointer", ptrIndex: 1 },
        ],
      },
    ],
  }, { source: { name: "u.capnp", format: "capnp" } });

  // Server side: register a handler that uses dynamic builder to set
  // both result fields to non-default strings.
  const { defineSchema, buildDynamic } = await import(`${ROOT}/js/dynamic.mjs`);
  const ResultsSchema = defineSchema({
    name:  { kind: "text", slot: 0 },
    email: { kind: "text", slot: 1 },
  }, { dataWords: 0, ptrWords: 2 });
  const reg = new InterfaceRegistry();
  reg.register(IFC_ID, 0, (_t, _ctx) => {
    const b = buildDynamic(cppB, ResultsSchema);
    b.set("name",  "Probe Bot");
    b.set("email", "probe@example.test");
    return b.finalize();
  });

  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, reg, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  try {
    const report = await probe(cppA, manifest, {
      capnpTarget: "memory://test",
      // Inject a connector that returns the pre-built client session,
      // so we don't need a real WebSocket round-trip.
      connectWebSocket: async () => client,
    });
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.ok, 1);
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.drift, 0);
    const r = report.results[0];
    assert.equal(r.operationId, "UserService.getUser");
    assert.equal(r.outcome, "ok");
    assert.deepEqual(r.declaredFields, ["name", "email"]);
    assert.deepEqual(r.readableFields, ["name", "email"]);
    assert.deepEqual(r.unreadableFields, []);
    assert.ok(r.responseBytes > 0);
  } finally {
    try { server.close(); } catch {}
  }
});

test("probe: capnp method that throws is recorded as drift", async () => {
  const cppA = await getCpp();
  const cppB = await (await import(`${ROOT}/dist/inlined.mjs`)).load();
  const { RpcSession, InterfaceRegistry, createMemoryTransportPair } =
    await import(`${ROOT}/js/rpc.mjs`);

  const IFC_ID = 0xc0ffee01n;
  const manifest = buildManifest({
    interfaces: [{ name: "S", id: IFC_ID, methods: [{ id: 0, name: "fails" }] }],
    structs: [
      { name: "fails$Params",  dataWords: 0, ptrWords: 0, fields: [] },
      { name: "fails$Results", dataWords: 0, ptrWords: 0, fields: [] },
    ],
  }, { source: { name: "x.capnp", format: "capnp" } });

  const reg = new InterfaceRegistry();
  reg.register(IFC_ID, 0, () => { throw new Error("synthetic failure"); });
  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, reg, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  try {
    const report = await probe(cppA, manifest, {
      capnpTarget: "memory://test",
      connectWebSocket: async () => client,
    });
    assert.equal(report.summary.error, 1);
    assert.equal(report.summary.drift, 1);
    const r = report.results[0];
    assert.equal(r.outcome, "error");
    assert.match(r.error, /synthetic failure/);
    assert.equal(r.drift, true);
  } finally {
    try { server.close(); } catch {}
  }
});

// ---- REST probe ------------------------------------------------------

function mockHttpServer(handler) {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const reqBody = Buffer.concat(chunks).toString("utf8");
        const result = await handler({ method: req.method, url: req.url, body: reqBody });
        res.statusCode = result.status ?? 200;
        if (result.contentType) res.setHeader("content-type", result.contentType);
        res.end(result.body ?? "");
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err?.message ?? err));
      }
    });
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(r)) });
    });
  });
}

test("probe: REST endpoint with matching shape reports ok + observed keys", async () => {
  const manifest = buildManifest({
    structs: [{
      name: "User", dataWords: 0, ptrWords: 3,
      fields: [
        { name: "id", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 },
        { name: "name", ordinal: 1, type: "Text", kind: "pointer", ptrIndex: 1 },
        { name: "email", ordinal: 2, type: "Text", kind: "pointer", ptrIndex: 2 },
      ],
    }],
    restApis: [{
      name: "MyAPI", baseUrl: null, defaults: {},
      methods: [{
        name: "getUser", method: "GET", path: "/users/{id}",
        params: [{ name: "id", role: "path", type: "string", optional: false }],
        returnType: "User",
      }],
    }],
  }, { source: { name: "api.ts", format: "typescript-rest" } });

  const mock = await mockHttpServer(async ({ url }) => {
    assert.match(url, /^\/users\/probe-test$/);
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "probe-test", name: "Probe Bot", email: "probe@example.test" }),
    };
  });
  try {
    const report = await probe(await getCpp(), manifest, { restTarget: mock.url });
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.ok, 1);
    assert.equal(report.summary.drift, 0);
    const r = report.results[0];
    assert.equal(r.operationId, "MyAPI.getUser");
    assert.equal(r.httpStatus, 200);
    assert.deepEqual(r.declaredKeys, ["id", "name", "email"]);
    assert.deepEqual(r.observedKeys.sort(), ["email", "id", "name"]);
    assert.deepEqual(r.missingKeys, []);
    assert.deepEqual(r.extraKeys, []);
  } finally {
    await mock.close();
  }
});

test("probe: REST endpoint with missing and extra keys reports drift", async () => {
  const manifest = buildManifest({
    structs: [{
      name: "User", dataWords: 0, ptrWords: 3,
      fields: [
        { name: "id", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 },
        { name: "name", ordinal: 1, type: "Text", kind: "pointer", ptrIndex: 1 },
        { name: "email", ordinal: 2, type: "Text", kind: "pointer", ptrIndex: 2 },
      ],
    }],
    restApis: [{
      name: "MyAPI", baseUrl: null, defaults: {},
      methods: [{
        name: "getUser", method: "GET", path: "/users/{id}",
        params: [{ name: "id", role: "path", type: "string", optional: false }],
        returnType: "User",
      }],
    }],
  }, { source: { name: "api.ts", format: "typescript-rest" } });

  const mock = await mockHttpServer(async () => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "probe-test", name: "Probe Bot", nickname: "bot" }),
  }));
  try {
    const report = await probe(await getCpp(), manifest, { restTarget: mock.url });
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.ok, 1);
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.drift, 1);
    const r = report.results[0];
    assert.equal(r.outcome, "ok");
    assert.equal(r.drift, true);
    assert.deepEqual(r.missingKeys, ["email"]);
    assert.deepEqual(r.extraKeys, ["nickname"]);
  } finally {
    await mock.close();
  }
});

test("probe: REST endpoint returning HTTP 500 is recorded as drift", async () => {
  const manifest = buildManifest({
    restApis: [{
      name: "MyAPI", baseUrl: null, defaults: {},
      methods: [{
        name: "broken", method: "GET", path: "/broken",
        params: [], returnType: "void",
      }],
    }],
  }, { source: { name: "api.ts", format: "typescript-rest" } });

  const mock = await mockHttpServer(async () => ({ status: 500, body: "boom" }));
  try {
    const report = await probe(await getCpp(), manifest, { restTarget: mock.url });
    assert.equal(report.summary.error, 1);
    assert.equal(report.summary.drift, 1);
    const r = report.results[0];
    assert.equal(r.outcome, "error");
    assert.equal(r.httpStatus, 500);
    assert.match(r.error, /HTTP 500/);
  } finally {
    await mock.close();
  }
});

test("probe: REST endpoint returning array surfaces first element's keys", async () => {
  const manifest = buildManifest({
    restApis: [{
      name: "MyAPI", baseUrl: null, defaults: {},
      methods: [{
        name: "list", method: "GET", path: "/list",
        params: [], returnType: "User[]",
      }],
    }],
  }, { source: { name: "api.ts", format: "typescript-rest" } });

  const mock = await mockHttpServer(async () => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ]),
  }));
  try {
    const report = await probe(await getCpp(), manifest, { restTarget: mock.url });
    const r = report.results[0];
    assert.equal(r.outcome, "ok");
    assert.deepEqual(r.observedKeys.sort(), ["id", "name"]);
  } finally {
    await mock.close();
  }
});

test("probe: requires capnpTarget when manifest has interfaces", async () => {
  const manifest = buildManifest(
    { interfaces: [{ name: "S", id: 0n, methods: [] }] },
    { source: { name: "x.capnp", format: "capnp" } },
  );
  await assert.rejects(
    () => probe(null, manifest, {}),   // cpp not even needed before validation
    /capnpTarget required/,
  );
});

test("probe: requires restTarget when manifest has REST APIs", async () => {
  const manifest = buildManifest(
    { restApis: [{ name: "X", baseUrl: null, defaults: {}, methods: [] }] },
    { source: { name: "x.ts", format: "typescript-rest" } },
  );
  await assert.rejects(
    () => probe(null, manifest, {}),
    /restTarget required/,
  );
});
