// Probe production-safety: auth, retry, secret masking, multi-input.
//
// All tested with an injected fetch (no real HTTP server needed for
// most tests) plus an HTTP mock for the multi-input run-end-to-end.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probe, resolveAuth } from "../js/probe.mjs";
import { buildManifest } from "../js/manifest.mjs";
import { parseOpenApi } from "../js/openapi_parser.mjs";

// Build a probable manifest from a tiny OpenAPI spec.
function tinyManifest(opts = {}) {
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } } } } } } },
        },
      },
    },
  };
  return buildManifest(parseOpenApi(spec), { source: { name: "spec.json", format: "openapi" } });
}

// Minimal fake-fetch that returns a known body and records the request.
function fakeFetch({ status = 200, body = { items: [] }, headers = {}, retryAfterFirst, captureInto } = {}) {
  const calls = [];
  let attemptsLeft = retryAfterFirst ?? 0;
  const ff = (url, init = {}) => {
    calls.push({ url, init });
    if (captureInto) captureInto.push({ url, init });
    if (attemptsLeft > 0) {
      attemptsLeft--;
      return Promise.resolve(makeResponse(429, { error: "rate-limited" }, { "retry-after": "0" }));
    }
    return Promise.resolve(makeResponse(status, body, headers));
  };
  ff.calls = calls;
  return ff;
}

function makeResponse(status, body, headers = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    statusText: status === 200 ? "OK" : status === 429 ? "Too Many Requests" : "",
    headers: { get: (n) => headerMap.get(n.toLowerCase()) ?? null },
    text: async () => JSON.stringify(body),
  };
}

// ---- resolveAuth -----------------------------------------------------

test("resolveAuth: cli > env > config", () => {
  const fromCli = resolveAuth({ cli: { type: "bearer", token: "from-cli" }, env: { CAPNWASM_PROBE_AUTH_TYPE: "apikey", CAPNWASM_PROBE_AUTH_TOKEN: "from-env" } });
  assert.equal(fromCli.type, "bearer");
  assert.equal(fromCli.token, "from-cli");

  const fromEnv = resolveAuth({ env: { CAPNWASM_PROBE_AUTH_TYPE: "bearer", CAPNWASM_PROBE_AUTH_TOKEN: "from-env" } });
  assert.equal(fromEnv.type, "bearer");
  assert.equal(fromEnv.token, "from-env");

  const fromCfg = resolveAuth({ env: {}, configFile: { probe: { auth: { type: "apikey", token: "from-cfg", in: "header", name: "x-api-key" } } } });
  assert.equal(fromCfg.type, "apikey");
  assert.equal(fromCfg.token, "from-cfg");
});

test("resolveAuth: env-namespaced selector picks the right environment", () => {
  const env = {
    CAPNWASM_PROBE_ENV: "staging",
    CAPNWASM_PROBE_STAGING_AUTH_TYPE: "bearer",
    CAPNWASM_PROBE_STAGING_AUTH_TOKEN: "stg",
    CAPNWASM_PROBE_PROD_AUTH_TYPE: "bearer",
    CAPNWASM_PROBE_PROD_AUTH_TOKEN: "prd",
  };
  assert.equal(resolveAuth({ env }).token, "stg");
  assert.equal(resolveAuth({ env: { ...env, CAPNWASM_PROBE_ENV: "prod" } }).token, "prd");
});

test("resolveAuth: config-file environments selector", () => {
  const cfg = {
    probe: {
      environments: {
        staging: { auth: { type: "bearer", token: "stg" } },
        prod:    { auth: { type: "bearer", token: "prd" } },
      },
    },
  };
  assert.equal(resolveAuth({ env: { CAPNWASM_PROBE_ENV: "staging" }, configFile: cfg }).token, "stg");
  assert.equal(resolveAuth({ env: { CAPNWASM_PROBE_ENV: "prod" },    configFile: cfg }).token, "prd");
});

// ---- Auth attached to requests ---------------------------------------

test("probe: bearer auth → Authorization header", async () => {
  const captured = [];
  const fetch = fakeFetch({ captureInto: captured });
  await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "bearer", token: "abc" },
  });
  assert.equal(captured[0].init.headers["authorization"], "Bearer abc");
});

test("probe: basic auth → base64-encoded user:pass", async () => {
  const captured = [];
  const fetch = fakeFetch({ captureInto: captured });
  await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "basic", token: "user:pass" },
  });
  assert.equal(captured[0].init.headers["authorization"], "Basic " + Buffer.from("user:pass", "utf8").toString("base64"));
});

test("probe: apikey-in-header → custom header", async () => {
  const captured = [];
  const fetch = fakeFetch({ captureInto: captured });
  await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "apikey", in: "header", name: "x-api-key", token: "k1" },
  });
  assert.equal(captured[0].init.headers["x-api-key"], "k1");
});

test("probe: apikey-in-query → URL gets the key appended", async () => {
  const captured = [];
  const fetch = fakeFetch({ captureInto: captured });
  await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "apikey", in: "query", name: "api_key", token: "k1" },
  });
  assert.match(captured[0].url, /api_key=k1/);
});

test("probe: apikey-in-cookie → Cookie header", async () => {
  const captured = [];
  const fetch = fakeFetch({ captureInto: captured });
  await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "apikey", in: "cookie", name: "session", token: "s1" },
  });
  assert.equal(captured[0].init.headers["cookie"], "session=s1");
});

// ---- Retry ----------------------------------------------------------

test("probe: 429 with Retry-After triggers a retry", async () => {
  const fetch = fakeFetch({ retryAfterFirst: 1 });
  const r = await probe(null, tinyManifest(), { restTarget: "https://example.test", fetch, maxRetries: 3 });
  // Two fetches: one rate-limited, one OK.
  assert.equal(fetch.calls.length, 2);
  assert.equal(r.results[0].retries, 1);
  assert.equal(r.results[0].outcome, "ok");
});

test("probe: gives up after maxRetries and returns the last error response", async () => {
  const fetch = fakeFetch({ retryAfterFirst: 5 });
  const r = await probe(null, tinyManifest(), { restTarget: "https://example.test", fetch, maxRetries: 2 });
  // 1 + 2 retries = 3 calls.
  assert.equal(fetch.calls.length, 3);
  assert.equal(r.results[0].outcome, "error");
});

// ---- Secret masking -------------------------------------------------

test("probe: report masks the configured apikey header by name", async () => {
  // Synthesize a result that has a `headers` block containing the
  // sensitive header. The probe report itself doesn't currently echo
  // request headers, but the masker should still scrub any nested
  // `headers` block we pass through.
  const { resolveAuth: _ } = await import("../js/probe.mjs");
  // Inject the report shape directly via probe.maskSecrets-style path
  // by passing a manifest that hits the apikey config. The auth block
  // on the returned report should not contain the token.
  const fetch = fakeFetch();
  const r = await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "apikey", in: "header", name: "x-api-key", token: "secret-token" },
  });
  assert.equal(r.auth.type, "apikey");
  assert.equal(r.auth.name, "x-api-key");
  // Token must not leak anywhere in the JSON.
  assert.ok(!JSON.stringify(r).includes("secret-token"), "auth token leaked into report");
});

test("probe: query-string apikey value gets masked in any url field of the report", async () => {
  // Inject a synthetic report and ensure maskSecrets walks `url` fields.
  // We do this by forcing a 5xx to populate result.error path, then
  // checking that the Authorization isn't echoed. (Today's probe doesn't
  // reflect URLs in the report; this asserts the no-leak invariant.)
  const fetch = fakeFetch({ status: 500, body: { error: "boom" } });
  const r = await probe(null, tinyManifest(), {
    restTarget: "https://example.test", fetch,
    auth: { type: "apikey", in: "query", name: "api_key", token: "ATOKEN" },
    maxRetries: 0,
  });
  assert.ok(!JSON.stringify(r).includes("ATOKEN"), "query-param secret leaked into report");
});

// ---- Multi-input (probe-dir) ----------------------------------------

test("CLI: probe a directory of manifests writes per-API reports + a summary", async () => {
  // Spin up a tiny HTTP mock and run `npx capnwasm probe <dir>`. Use
  // async spawn so the server's event loop isn't blocked by the child
  // process (which was the cause of a 5-minute hang in the sync version).
  const server = createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ items: [] }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const target = `http://127.0.0.1:${port}`;

  const dir = mkdtempSync(join(tmpdir(), "capnwasm-probe-dir-"));
  for (const tag of ["a", "b"]) {
    const m = tinyManifest();
    writeFileSync(join(dir, `${tag}.manifest.json`), JSON.stringify(m, null, 2));
  }

  const { spawn } = await import("node:child_process");
  const status = await new Promise((resolve, reject) => {
    const child = spawn("node", ["bin/capnwasm.mjs", "probe", dir, "--rest-target", target, "--max-retries", "0"], { cwd: process.cwd() });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
  server.close();
  // Probe exits 0 when nothing drifts, 2 when something does. Either is
  // acceptable for this multi-input test (we're checking on-disk
  // artifacts, not drift).
  assert.ok(status.code === 0 || status.code === 2, `unexpected exit ${status.code}\n${status.stderr}`);

  const reportsDir = join(dir, "probe-reports");
  const entries = readdirSync(reportsDir).sort();
  assert.deepEqual(entries, ["a.report.json", "b.report.json", "summary.json"]);
  const summary = JSON.parse(readFileSync(join(reportsDir, "summary.json"), "utf8"));
  assert.equal(summary.aggregate.total, 2);   // one op per manifest
});
