// Operation manifest builder + CLI integration.
//
// Covers the three input formats: .capnp (interfaces + structs), .ts
// (with @rest), and OpenAPI JSON. The manifest shape is meant to be
// stable across all three so downstream tools (drift detectors, mock
// generators, contract test harnesses, MCP servers) can consume one
// envelope regardless of source.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { buildManifest, buildManifestJson } from "../js/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

// ---- buildManifest unit tests --------------------------------------

test("buildManifest: requires source.name + source.format", () => {
  assert.throws(() => buildManifest({ structs: [] }, {}), /source\.name/);
  assert.throws(() => buildManifest({ structs: [] }, { source: { name: "x" } }), /source\.format/);
});

test("buildManifest: empty model still produces a valid envelope", () => {
  const m = buildManifest(
    { structs: [], interfaces: [], restApis: [] },
    { source: { name: "empty.capnp", format: "capnp" } },
  );
  assert.equal(m.manifestVersion, 1);
  assert.equal(m.source.name, "empty.capnp");
  assert.equal(m.source.format, "capnp");
  assert.match(m.source.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(m.structs, []);
  assert.deepEqual(m.interfaces, []);
  assert.deepEqual(m.restApis, []);
});

test("buildManifest: struct fields normalize to {name, ordinal, type, kind, ...}", () => {
  const model = {
    structs: [{
      name: "User",
      dataWords: 3,
      ptrWords: 3,
      fields: [
        { name: "id",   ordinal: 0, type: "UInt64", kind: "data",    bitOffset: 0 },
        { name: "name", ordinal: 1, type: "Text",   kind: "pointer", ptrIndex: 0 },
      ],
    }],
  };
  const m = buildManifest(model, { source: { name: "u.capnp", format: "capnp" } });
  assert.equal(m.structs.length, 1);
  assert.equal(m.structs[0].name, "User");
  assert.equal(m.structs[0].dataWords, 3);
  assert.equal(m.structs[0].ptrWords, 3);
  assert.equal(m.structs[0].fields.length, 2);
  assert.equal(m.structs[0].fields[0].name, "id");
  assert.equal(m.structs[0].fields[0].kind, "data");
  assert.equal(m.structs[0].fields[1].ptrIndex, 0);
});

test("buildManifest: interface IDs normalize to 0x-prefixed lowercase hex", () => {
  // BigInt → 0xhex
  const m1 = buildManifest(
    { interfaces: [{ name: "S", id: 0xab1234ff00cc0001n, methods: [] }] },
    { source: { name: "s.capnp", format: "capnp" } },
  );
  assert.equal(m1.interfaces[0].id, "0xab1234ff00cc0001");

  // Decimal string (capnpc default) → 0xhex
  const m2 = buildManifest(
    { interfaces: [{ name: "S", id: "13288899311175752487", methods: [] }] },
    { source: { name: "s.capnp", format: "capnp" } },
  );
  assert.equal(m2.interfaces[0].id, "0xb86ba78412905b27");

  // Existing 0x string passes through, normalized case
  const m3 = buildManifest(
    { interfaces: [{ name: "S", id: "0xAB1234FF00CC0001", methods: [] }] },
    { source: { name: "s.capnp", format: "capnp" } },
  );
  assert.equal(m3.interfaces[0].id, "0xab1234ff00cc0001");
});

test("buildManifest: methods get operationId = `${interface}.${method}`", () => {
  const m = buildManifest(
    {
      interfaces: [{
        name: "MyService", id: 0xc0ffeen,
        methods: [
          { id: 0, name: "getUser" },
          { id: 1, name: "createUser" },
        ],
      }],
    },
    { source: { name: "s.capnp", format: "capnp" } },
  );
  const ops = m.interfaces[0].methods.map((mm) => mm.operationId);
  assert.deepEqual(ops, ["MyService.getUser", "MyService.createUser"]);
  assert.equal(m.interfaces[0].methods[0].ordinal, 0);
  assert.equal(m.interfaces[0].methods[0].paramsStruct, "getUser$Params");
  assert.equal(m.interfaces[0].methods[0].resultsStruct, "getUser$Results");
});

test("buildManifest: REST methods normalize HTTP verb + extract param `in` role", () => {
  const m = buildManifest(
    {
      restApis: [{
        name: "MyAPI",
        baseUrl: "https://api.example.com",
        defaults: { auth: { type: "bearer" } },
        methods: [
          {
            name: "getUser",
            method: "get",
            path: "/users/{id}",
            params: [{ name: "id", role: "path", type: "number", optional: false }],
            returnType: "User",
          },
          {
            name: "search",
            method: "GET",
            path: "/search",
            params: [
              { name: "q",     role: "query",  type: "string", optional: true },
              { name: "trace", role: "header", type: "string", optional: true, wireName: "X-Trace" },
            ],
            returnType: "SearchHits",
            isAsyncIterable: true,
            paginated: { style: "cursor" },
          },
        ],
      }],
    },
    { source: { name: "api.ts", format: "typescript-rest" } },
  );
  const api = m.restApis[0];
  assert.equal(api.baseUrl, "https://api.example.com");
  assert.equal(api.defaults.auth.type, "bearer");
  assert.equal(api.methods.length, 2);
  assert.equal(api.methods[0].operationId, "MyAPI.getUser");
  assert.equal(api.methods[0].httpMethod, "GET");
  assert.equal(api.methods[0].params[0].in, "path");
  assert.equal(api.methods[0].params[0].required, true);
  assert.equal(api.methods[1].isAsyncIterable, true);
  assert.deepEqual(api.methods[1].paginated, { style: "cursor" });
  assert.equal(api.methods[1].params[1].wireName, "X-Trace");
});

// ---- CLI integration -----------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "cw-manifest-"));

test("npx capnwasm manifest <user.capnp>: writes default *.manifest.json", () => {
  const schema = join(tmp, "u.capnp");
  writeFileSync(schema, `@0xb9d0a4e5d4f6e1c9;
struct User {
  id @0 :UInt64;
  name @1 :Text;
}`);
  const r = spawnSync("node", [CLI, "manifest", schema], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("CLI failed: " + r.stderr);
  const out = join(tmp, "u.manifest.json");
  const m = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(m.manifestVersion, 1);
  assert.equal(m.source.format, "capnp");
  assert.equal(m.structs.length, 1);
  assert.equal(m.structs[0].name, "User");
  assert.equal(m.structs[0].fields.length, 2);
});

test("npx capnwasm manifest <svc.capnp>: extracts interface methods with operationIds", () => {
  const schema = join(tmp, "svc.capnp");
  writeFileSync(schema, `@0xab1234ff00cc0001;
interface UserService {
  getUser @0 (id :UInt64) -> (name :Text);
  ping @1 () -> ();
}`);
  const r = spawnSync("node", [CLI, "manifest", schema, "-o", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("CLI failed: " + r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.interfaces.length, 1);
  assert.equal(m.interfaces[0].name, "UserService");
  assert.match(m.interfaces[0].id, /^0x[0-9a-f]+$/);
  const ops = m.interfaces[0].methods.map((mm) => mm.operationId);
  assert.deepEqual(ops, ["UserService.getUser", "UserService.ping"]);
});

test("npx capnwasm manifest <api.ts>: extracts REST endpoints with params + auth", () => {
  const schema = join(tmp, "api.ts");
  writeFileSync(schema, `interface User { id: number; name: string; }

// @rest baseUrl=https://api.example.com
// @auth bearer
interface MyAPI {
  // @get /users/{id}
  getUser(id: number): Promise<User>;

  // @post /users
  // @body body
  createUser(body: User): Promise<User>;
}`);
  const r = spawnSync("node", [CLI, "manifest", schema, "-o", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("CLI failed: " + r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.source.format, "typescript-rest");
  assert.equal(m.restApis.length, 1);
  const api = m.restApis[0];
  assert.equal(api.name, "MyAPI");
  assert.equal(api.baseUrl, "https://api.example.com");
  assert.equal(api.defaults.auth.type, "bearer");
  assert.equal(api.methods.length, 2);
  assert.equal(api.methods[0].operationId, "MyAPI.getUser");
  assert.equal(api.methods[0].httpMethod, "GET");
  assert.equal(api.methods[0].path, "/users/{id}");
  assert.equal(api.methods[0].params[0].in, "path");
  assert.equal(api.methods[1].httpMethod, "POST");
  assert.equal(api.methods[1].params[0].in, "body");
});

test("npx capnwasm manifest <openapi.json>: same envelope as the other formats", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "Things API", version: "1.0.0" },
    paths: {
      "/things/{id}": {
        get: {
          operationId: "getThing",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
  const schema = join(tmp, "things.json");
  writeFileSync(schema, JSON.stringify(spec));
  const r = spawnSync("node", [CLI, "manifest", schema, "-o", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("CLI failed: " + r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.source.format, "openapi");
  assert.equal(m.restApis.length, 1);
  const api = m.restApis[0];
  assert.equal(api.methods.length, 1);
  assert.equal(api.methods[0].operationId, `${api.name}.getThing`);
  assert.equal(api.methods[0].httpMethod, "GET");
  assert.equal(api.methods[0].path, "/things/{id}");
  assert.equal(api.methods[0].params[0].in, "path");
});

test("buildManifestJson: emits trailing newline and pretty-printed indent", () => {
  const json = buildManifestJson(
    { structs: [] },
    { source: { name: "x", format: "capnp" } },
  );
  assert.equal(json.endsWith("\n"), true);
  assert.match(json, /^{\n  "manifestVersion"/);
});
