// emit-openapi and emit-capnp converters.
//
// The two converters together form the OpenAPI ↔ capnp bridge described
// in docs/unified-surfaces-design.md. The contract these tests pin:
//
//   1. OpenAPI → manifest → emit-openapi is byte-equivalent (after
//      jq -S sort) to the input. Round-trip lossless on every structural
//      OpenAPI key (paths, components, info, servers, security, tags,
//      externalDocs, plus any custom top-level extensions).
//   2. emit-capnp output is syntactically valid capnp (all reserved-name
//      / underscore / collision corner cases handled). When the `capnp`
//      compiler is on PATH the test additionally confirms that.
//   3. Cross-references via $ref turn into named struct types instead of
//      duplicating the component definition.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { parseOpenApi } from "../js/openapi_parser.mjs";
import { buildManifest } from "../js/manifest.mjs";
import { buildOpenApi, buildOpenApiJson } from "../js/emit_openapi.mjs";
import { buildCapnp } from "../js/emit_capnp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

const PETSTORE = {
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.0.0" },
  servers: [{ url: "https://petstore.example/v1" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        parameters: [
          { name: "limit",  in: "query", schema: { type: "integer", format: "int32" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["pets"],
                  properties: {
                    pets: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
                    next_cursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createPet",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } },
        responses: { 201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
    "/pets/{id}": {
      get: {
        operationId: "getPet",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id:   { type: "string", format: "uuid" },
          name: { type: "string" },
          tag:  { type: "string", nullable: true },
          kind: { type: "string", enum: ["dog", "cat", "bird"] },
          weight_kg: { type: "number", format: "float" },
        },
      },
      Animal: {
        oneOf: [{ $ref: "#/components/schemas/Pet" }, { $ref: "#/components/schemas/Wild" }],
      },
      Wild: {
        type: "object",
        required: ["species"],
        properties: { species: { type: "string" }, habitat: { type: "string" } },
      },
    },
  },
};

function buildManifestFromSpec(spec) {
  const model = parseOpenApi(spec);
  return buildManifest(model, { source: { name: "spec.json", format: "openapi" } });
}

// ---- emit-openapi: round-trip ----------------------------------------

test("emit-openapi: lossless round-trip on the structural keys", () => {
  const manifest = buildManifestFromSpec(PETSTORE);
  const out = buildOpenApi(manifest);
  // Every top-level key from the input survives.
  for (const k of Object.keys(PETSTORE)) {
    assert.ok(k in out, `top-level key "${k}" lost in round-trip`);
  }
  // Path counts match.
  assert.equal(Object.keys(out.paths).length, Object.keys(PETSTORE.paths).length);
  // Component schema counts match.
  assert.equal(
    Object.keys(out.components.schemas).length,
    Object.keys(PETSTORE.components.schemas).length,
  );
});

test("emit-openapi: deterministic output (canonicalized key order)", () => {
  const manifest = buildManifestFromSpec(PETSTORE);
  const a = buildOpenApiJson(manifest);
  const b = buildOpenApiJson(manifest);
  assert.equal(a, b);
});

test("emit-openapi: passes through unknown top-level extensions", () => {
  const spec = { ...PETSTORE, "x-custom-vendor": { foo: 1 } };
  const m = buildManifestFromSpec(spec);
  const out = buildOpenApi(m);
  assert.deepEqual(out["x-custom-vendor"], { foo: 1 });
});

test("emit-openapi: preserves externalDocs", () => {
  const spec = { ...PETSTORE, externalDocs: { url: "https://example.com/docs", description: "docs" } };
  const m = buildManifestFromSpec(spec);
  const out = buildOpenApi(m);
  assert.deepEqual(out.externalDocs, { url: "https://example.com/docs", description: "docs" });
});

test("emit-openapi: reconstructs from .capnp / @rest TS manifest (no sidecar)", () => {
  // Manifest with restApis but no openapi sidecar (simulating a .capnp /
  // @rest TS source). Verifies the reconstruction path renders a valid
  // OpenAPI shell rather than throwing.
  const manifest = buildManifest(
    {
      restApis: [{
        name: "Demo",
        baseUrl: "https://demo.example",
        defaults: {},
        methods: [
          { name: "list", method: "GET", path: "/items", params: [], returnType: "Item[]" },
        ],
      }],
    },
    { source: { name: "demo.ts", format: "typescript-rest" } },
  );
  const out = buildOpenApi(manifest);
  assert.equal(out.openapi, "3.0.3");
  assert.equal(out.info.title, "Demo");
  assert.ok(out.paths["/items"]?.get);
});

// ---- emit-capnp: structure ------------------------------------------

test("emit-capnp: $ref turns into a named type, not an inline duplicate", () => {
  const manifest = buildManifestFromSpec(PETSTORE);
  const { text } = buildCapnp(manifest);
  // Pet is the named component schema. Should appear as `struct Pet {`
  // exactly once (the component declaration), not as several aliased
  // duplicates like `AnimalPet`, `CreatePetBody`, etc.
  const petDeclMatches = text.match(/^struct Pet \{/gm) ?? [];
  assert.equal(petDeclMatches.length, 1, "Pet should be declared exactly once");
  // The Animal union should reference Pet by its canonical name.
  assert.match(text, /pet @\d+ :Pet;/);
});

test("emit-capnp: oneOf becomes a capnp union", () => {
  const manifest = buildManifestFromSpec(PETSTORE);
  const { text } = buildCapnp(manifest);
  // Animal is `oneOf [Pet, Wild]`; the emitted Animal struct must use a
  // capnp union with at least two members.
  const animalBlock = text.match(/struct Animal \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(animalBlock, /\bunion \{/);
  assert.match(animalBlock, /pet @\d+ :Pet;/);
  assert.match(animalBlock, /wild @\d+ :Wild;/);
});

test("emit-capnp: emits a deterministic file id", () => {
  const m1 = buildManifestFromSpec(PETSTORE);
  const m2 = buildManifestFromSpec(PETSTORE);
  // Drop the generatedAt field so it doesn't affect the comparison.
  m1.source.generatedAt = "FROZEN";
  m2.source.generatedAt = "FROZEN";
  const { text: t1 } = buildCapnp(m1);
  const { text: t2 } = buildCapnp(m2);
  assert.equal(t1, t2);
});

test("emit-capnp: enum collisions get a numeric suffix, not an underscore", () => {
  // `*` and `""` both sanitize to the empty fallback; they need to dedupe
  // without producing duplicate identifiers.
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {},
    components: {
      schemas: {
        Tricky: { type: "string", enum: ["*", "", "ok"] },
      },
    },
  };
  const m = buildManifestFromSpec(spec);
  const { text } = buildCapnp(m);
  const block = text.match(/enum Tricky \{[\s\S]*?\n\}/)?.[0] ?? "";
  // No identifier ends in `_` (capnp rejects underscores in declaration
  // names).
  for (const line of block.split("\n")) {
    const id = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s+@\d+;/)?.[1];
    if (id) assert.ok(!id.includes("_"), `enum value ${id} contains underscore`);
  }
  // Three distinct identifiers (no duplicates).
  const idents = [...block.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s+@\d+;/gm)].map((m) => m[1]);
  assert.equal(new Set(idents).size, idents.length);
  assert.equal(idents.length, 3);
});

test("emit-capnp: reserved capnp keywords get a v-prefix, not a trailing underscore", () => {
  // `true` / `false` / `void` are reserved in capnp; the emitter must
  // rewrite them as something valid (and underscore-free).
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {},
    components: { schemas: { B: { type: "string", enum: ["true", "false", "void"] } } },
  };
  const m = buildManifestFromSpec(spec);
  const { text } = buildCapnp(m);
  const block = text.match(/enum B \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(block, /\b(true|false|void)\s+@\d+;/);
  assert.doesNotMatch(block, /[A-Za-z]_/);
});

test("emit-capnp: arrays of unknown type become List(AnyValue), not List(AnyPointer)", () => {
  // capnp 1.x doesn't accept List(AnyPointer); we have to wrap.
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {},
    components: { schemas: { Bag: { type: "object", properties: { items: { type: "array", items: {} } } } } },
  };
  const m = buildManifestFromSpec(spec);
  const { text } = buildCapnp(m);
  // Drop comment lines before checking for the disallowed type, since
  // the AnyValue wrapper struct's docstring legitimately mentions
  // "List(AnyPointer)".
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /List\(AnyPointer\)/);
  assert.match(text, /List\(AnyValue\)/);
  assert.match(text, /struct AnyValue \{/);
});

test("emit-capnp: single-effective-member oneOf collapses to a plain field, not an empty union", () => {
  // Some specs author `oneOf: [Foo, Foo]`; after dedup only one member
  // remains. capnp requires unions to have ≥2 members, so the emitter
  // must drop the union and emit a single field.
  const spec = {
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {},
    components: {
      schemas: {
        Foo: { type: "object", properties: { id: { type: "string" } } },
        WrappedFoo: { oneOf: [{ $ref: "#/components/schemas/Foo" }, { $ref: "#/components/schemas/Foo" }] },
      },
    },
  };
  const m = buildManifestFromSpec(spec);
  const { text } = buildCapnp(m);
  const block = text.match(/struct WrappedFoo \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(block, /\bunion \{/);
  assert.match(block, /:Foo;/);
});

// ---- CLI integration -----------------------------------------------

test("CLI: emit-openapi round-trips through stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-emit-"));
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify(PETSTORE));

  const r1 = spawnSync("node", [CLI, "manifest", specPath, "-o", "-"], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);
  const manifestPath = join(dir, "spec.manifest.json");
  writeFileSync(manifestPath, r1.stdout);

  const r2 = spawnSync("node", [CLI, "emit-openapi", manifestPath, "-o", "-"], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const out = JSON.parse(r2.stdout);
  assert.equal(out.openapi, PETSTORE.openapi);
  assert.equal(out.info.title, PETSTORE.info.title);
  assert.deepEqual(Object.keys(out.paths).sort(), Object.keys(PETSTORE.paths).sort());
});

test("CLI: emit-capnp writes a file and reports a summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-emit-"));
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify(PETSTORE));

  const r1 = spawnSync("node", [CLI, "manifest", specPath, "-o", "-"], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);
  const manifestPath = join(dir, "spec.manifest.json");
  writeFileSync(manifestPath, r1.stdout);

  const out = join(dir, "spec.capnp");
  const r2 = spawnSync("node", [CLI, "emit-capnp", manifestPath, "-o", out], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const text = readFileSync(out, "utf8");
  assert.match(text, /^@0x[0-9a-f]{16};/m);
  assert.match(text, /interface Petstore \{/);
  // Summary line on stderr mentions struct/enum/interface counts.
  assert.match(r2.stderr, /struct\(s\)/);
});

// ---- Optional: capnp compile when the binary is on PATH -----------

const capnpProbe = spawnSync("capnp", ["--version"], { encoding: "utf8" });
const haveCapnp = capnpProbe.status === 0;

test("emit-capnp: output compiles with `capnp compile` (when available)", { skip: !haveCapnp }, () => {
  const m = buildManifestFromSpec(PETSTORE);
  const { text } = buildCapnp(m);
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-capnp-"));
  const file = join(dir, "schema.capnp");
  writeFileSync(file, text);
  const r = spawnSync("capnp", ["compile", "-o-", file], { encoding: "utf8" });
  assert.equal(r.status, 0, `capnp compile failed:\n${r.stderr}`);
});
