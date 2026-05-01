// Contract test harness emitter — end-to-end coverage.
//
// The harness's value is that the generated test file is actually
// runnable and actually passes against an in-process mock. So this
// test does the full round trip:
//
//   .capnp/.ts schema
//     → npx capnwasm gen   → SDK module (.gen.mjs)
//     → npx capnwasm manifest  → manifest JSON
//     → npx capnwasm harness   → contract test file
//     → node --test            → assert it passes
//
// Generated artifacts live under a tmpdir inside the project root so
// Node's package self-resolution finds "capnwasm" via the repo's own
// package.json (the codegen output and the harness both
// `import "capnwasm"` / `import "capnwasm/rest"`).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildHarness } from "../js/harness.mjs";
import { buildManifest } from "../js/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

// ---- buildHarness unit tests ------------------------------------------

test("buildHarness: requires opts.genImport", () => {
  assert.throws(() => buildHarness({ interfaces: [] }, {}), /genImport/);
});

test("buildHarness: emits capnp test per interface method, with operationId in test name", () => {
  const m = buildManifest({
    interfaces: [{
      name: "S", id: 0xab1234ff00cc0001n,
      methods: [
        { id: 0, name: "getThing" },
        { id: 1, name: "ping" },
      ],
    }],
    structs: [
      { name: "getThing$Params",  fields: [{ name: "id",   ordinal: 0, type: "UInt64" }] },
      { name: "getThing$Results", fields: [{ name: "name", ordinal: 0, type: "Text"   }] },
      { name: "ping$Params",      fields: [] },
      { name: "ping$Results",     fields: [] },
    ],
  }, { source: { name: "s.capnp", format: "capnp" } });
  const src = buildHarness(m, { genImport: "./s.gen.mjs" });
  assert.match(src, /test\("S\.getThing: call returns a parseable response"/);
  assert.match(src, /test\("S\.ping: call returns a parseable response"/);
  assert.match(src, /reg\.register\(0xab1234ff00cc0001n, 0,/);
  assert.match(src, /r\.params\.id = 0n;/);
  assert.match(src, /import \* as gen from "\.\/s\.gen\.mjs";/);
});

test("buildHarness: emits REST test that needs CAPNWASM_HARNESS_REST_TARGET", () => {
  const m = buildManifest({
    restApis: [{
      name: "MyAPI",
      baseUrl: "https://api.example.com",
      defaults: {},
      methods: [{
        name: "getUser", method: "GET", path: "/users/{id}",
        params: [{ name: "id", role: "path", type: "string", optional: false }],
        returnType: "User",
      }],
    }],
  }, { source: { name: "api.ts", format: "typescript-rest" } });
  const src = buildHarness(m, { genImport: "./api.gen.mjs" });
  assert.match(src, /test\("MyAPI\.getUser: GET \/users\/\{id\}"/);
  assert.match(src, /CAPNWASM_HARNESS_REST_TARGET/);
  assert.match(src, /createMyAPIClient\({ baseUrl: REST_TARGET }\)/);
  assert.match(src, /client\.getUser\("contract-test"\)/);
});

test("buildHarness: rpcImport overrides the default '<runtime>/rpc' subpath", () => {
  const m = buildManifest(
    { interfaces: [{ name: "S", id: 0n, methods: [] }], structs: [] },
    { source: { name: "s.capnp", format: "capnp" } },
  );
  const src = buildHarness(m, {
    genImport: "./s.gen.mjs",
    runtimeImport: "/abs/inlined.mjs",
    rpcImport:     "/abs/rpc.mjs",
  });
  assert.match(src, /from "\/abs\/inlined\.mjs"/);
  assert.match(src, /from "\/abs\/rpc\.mjs"/);
  assert.doesNotMatch(src, /\/abs\/inlined\.mjs\/rpc/);
});

// ---- End-to-end CLI integration ---------------------------------------
//
// Generates schema → SDK → manifest → harness → runs the harness, all
// inside a tmp dir under the repo root so package self-resolve picks
// up `capnwasm` and `capnwasm/rest` via the project's own package.json.

const tmp = mkdtempSync(join(ROOT, ".tmp-harness-test-"));
// Best-effort cleanup at process exit. Failure to clean is not a test
// failure — the directory name pattern is gitignored anyway.
process.on("exit", () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

function cleanTestEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test("end-to-end: capnp schema → harness file passes against in-process mock", () => {
  const schema = join(tmp, "svc.capnp");
  writeFileSync(schema, `@0xcc1234ff00cc0001;
interface UserService {
  getUser @0 (id :UInt64) -> (name :Text, email :Text);
  ping @1 () -> ();
}`);

  // 1) gen → SDK
  let r = spawnSync("node", [CLI, "gen", schema, "-o", join(tmp, "svc.gen.mjs")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("gen failed: " + r.stderr);

  // 2) manifest
  r = spawnSync("node", [CLI, "manifest", schema, "-o", join(tmp, "svc.manifest.json")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("manifest failed: " + r.stderr);

  // 3) harness (defaults — relies on package self-resolve from inside ROOT)
  r = spawnSync("node", [
    CLI, "harness", join(tmp, "svc.manifest.json"),
    "--gen", "./svc.gen.mjs",
    "-o", join(tmp, "svc.contract.test.mjs"),
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("harness failed: " + r.stderr);

  // 4) run the generated harness — must pass.
  // NODE_TEST_CONTEXT is set when this test is itself running under
  // `node --test`; if we inherit it, the child's TAP reporter routes its
  // output to an IPC channel instead of stdout and we see nothing.
  r = spawnSync("node", ["--test", join(tmp, "svc.contract.test.mjs")], {
    encoding: "utf8",
    env: cleanTestEnv(),
  });
  assert.equal(r.status, 0,
    `harness run failed:\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  // Both tests should have passed (one per method).
  assert.match(r.stdout, /UserService\.getUser: call returns a parseable response/);
  assert.match(r.stdout, /UserService\.ping: call returns a parseable response/);
  assert.match(r.stdout, /# pass 2/);
  assert.match(r.stdout, /# fail 0/);
});

test("end-to-end: REST manifest → harness emits skip when target unset", () => {
  const schema = join(tmp, "api.ts");
  writeFileSync(schema, `interface User { id: number; name: string; }

// @rest baseUrl=https://api.example.com
interface MyAPI {
  // @get /users/{id}
  getUser(id: number): Promise<User>;
}`);

  let r = spawnSync("node", [CLI, "gen", schema, "-o", join(tmp, "api.gen.mjs")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("gen failed: " + r.stderr);

  r = spawnSync("node", [CLI, "manifest", schema, "-o", join(tmp, "api.manifest.json")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("manifest failed: " + r.stderr);

  r = spawnSync("node", [
    CLI, "harness", join(tmp, "api.manifest.json"),
    "--gen", "./api.gen.mjs",
    "-o", join(tmp, "api.contract.test.mjs"),
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("harness failed: " + r.stderr);

  // Run with REST_TARGET unset — the test should skip with the documented message,
  // not fail. node --test still exits 0 when tests skip.
  // Strip NODE_TEST_CONTEXT (see comment above) so the child's TAP
  // output lands on stdout.
  r = spawnSync("node", ["--test", join(tmp, "api.contract.test.mjs")], {
    encoding: "utf8",
    env: { ...cleanTestEnv(), CAPNWASM_HARNESS_REST_TARGET: "" },
  });
  assert.equal(r.status, 0,
    `harness run failed unexpectedly:\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /MyAPI\.getUser: GET \/users\/\{id\}/);
  assert.match(r.stdout, /set CAPNWASM_HARNESS_REST_TARGET to run/);
  assert.match(r.stdout, /# fail 0/);
});
