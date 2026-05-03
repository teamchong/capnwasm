// JSON ↔ capnp wire-bytes codec emitter.
//
// The contract: for each top-level named struct in a manifest, the
// emitted module exposes <Name>ToCapnp(obj) → Uint8Array and
// <Name>FromCapnp(bytes) → obj. Round-trip should be lossless (modulo
// expected wire-format quirks: Float32 precision, capnp scalar defaults
// for absent fields).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { parseOpenApi } from "../js/openapi_parser.mjs";
import { buildManifest } from "../js/manifest.mjs";
import { buildCodec } from "../js/emit_codec.mjs";
import { buildCapnp } from "../js/emit_capnp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

// In-tree imports for the smoke imports (the emitted module references
// "capnwasm" / "capnwasm/dynamic"; for in-tree tests we rewrite them).
const RUNTIME_IMPORT = pathToFileURL(join(ROOT, "dist", "inlined.mjs")).href;
const DYNAMIC_IMPORT = pathToFileURL(join(ROOT, "js", "dynamic.mjs")).href;

function rewriteImports(text) {
  return text
    .replace(/"capnwasm\/dynamic"/g, JSON.stringify(DYNAMIC_IMPORT))
    .replace(/"capnwasm"/g, JSON.stringify(RUNTIME_IMPORT));
}

// --- Unit: emit-only (no execution) ---------------------------------

test("buildCodec: emits *ToCapnp / *FromCapnp pairs for layout-bearing structs", () => {
  const structs = [{
    name: "Pet",
    dataWords: 1,
    ptrWords: 2,
    fields: [
      { name: "id",   ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 },
      { name: "age",  ordinal: 1, type: "UInt32", kind: "data", bitOffset: 0 },
      { name: "name", ordinal: 2, type: "Text", kind: "pointer", ptrIndex: 1 },
    ],
  }];
  const m = buildManifest({ structs }, { source: { name: "x.capnp", format: "capnp" } });
  const { text, summary } = buildCodec(m);
  assert.equal(summary.emitted.length, 1);
  assert.equal(summary.emitted[0], "Pet");
  assert.match(text, /export async function PetToCapnp\(obj\)/);
  assert.match(text, /export async function PetFromCapnp\(bytes\)/);
  assert.match(text, /defineSchema\(\{[\s\S]*?id: \{ kind: "text", slot: 0 \}/);
});

test("buildCodec: skips structs missing wire layout", () => {
  const structs = [{
    name: "NoLayout",
    fields: [{ name: "x", ordinal: 0, type: "Text" }],
  }];
  const m = buildManifest({ structs }, { source: { name: "x.capnp", format: "capnp" } });
  const { summary } = buildCodec(m);
  assert.equal(summary.emitted.length, 0);
  assert.equal(summary.skipped.length, 1);
  assert.match(summary.skipped[0].reason, /no wire layout/);
});

test("buildCodec: nested struct ref is inlined as a defineSchema call", () => {
  const structs = [
    {
      name: "Pet",
      dataWords: 0,
      ptrWords: 1,
      fields: [{ name: "name", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 }],
    },
    {
      name: "Owner",
      dataWords: 0,
      ptrWords: 1,
      fields: [{ name: "pet", ordinal: 0, type: "Pet", kind: "pointer", ptrIndex: 0 }],
    },
  ];
  const m = buildManifest({ structs }, { source: { name: "x.capnp", format: "capnp" } });
  const { text, summary } = buildCodec(m);
  assert.equal(summary.skipped.length, 0);
  // The Owner schema embeds an inline `defineSchema(...)` for Pet via
  // the `schema:` key on the struct descriptor.
  assert.match(text, /pet: \{ kind: "struct", slot: 0, schema: defineSchema\(/);
});

test("buildCodec: List<Struct> emits an `element: defineSchema(...)`", () => {
  const structs = [
    { name: "Pet", dataWords: 0, ptrWords: 1, fields: [{ name: "name", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 }] },
    { name: "Pets", dataWords: 0, ptrWords: 1, fields: [{ name: "items", ordinal: 0, type: "List(Pet)", kind: "pointer", ptrIndex: 0 }] },
  ];
  const m = buildManifest({ structs }, { source: { name: "x.capnp", format: "capnp" } });
  const { text } = buildCodec(m);
  assert.match(text, /items: \{ kind: "listStruct", slot: 0, element: defineSchema\(/);
});

test("buildCodec: cycle in struct refs bottoms out as anyPointer instead of recursing forever", () => {
  const structs = [
    { name: "Node", dataWords: 0, ptrWords: 1, fields: [{ name: "next", ordinal: 0, type: "Node", kind: "pointer", ptrIndex: 0 }] },
  ];
  const m = buildManifest({ structs }, { source: { name: "cyc.capnp", format: "capnp" } });
  const { text, summary } = buildCodec(m);
  assert.equal(summary.skipped.length, 0);
  // The Node.next field should resolve to anyPointer (cycle bottom-out)
  // rather than expanding indefinitely.
  assert.match(text, /next: \{ kind: "anyPointer", slot: 0 \}/);
});

// --- End-to-end: run the emitted module against the real wasm runtime ---

async function emitAndImport(structs, manifestSource = "spec.capnp") {
  const m = buildManifest({ structs }, { source: { name: manifestSource, format: "capnp" } });
  const { text } = buildCodec(m);
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-codec-"));
  const path = join(dir, "codec.mjs");
  writeFileSync(path, rewriteImports(text));
  return await import(pathToFileURL(path).href);
}

test("end-to-end: scalar + Text round-trip preserves every field", async () => {
  const mod = await emitAndImport([{
    name: "Pet",
    dataWords: 1,
    ptrWords: 3,
    fields: [
      { name: "id",       ordinal: 0, type: "Text",    kind: "pointer", ptrIndex: 0 },
      { name: "name",     ordinal: 1, type: "Text",    kind: "pointer", ptrIndex: 1 },
      { name: "tag",      ordinal: 2, type: "Text",    kind: "pointer", ptrIndex: 2 },
      { name: "age",      ordinal: 3, type: "UInt32",  kind: "data",    bitOffset: 0 },
      { name: "weight",   ordinal: 4, type: "Float32", kind: "data",    bitOffset: 32 },
    ],
  }]);
  const obj = { id: "p-1", name: "Rex", tag: "good", age: 7, weight: 12.5 };
  const bytes = await mod.PetToCapnp(obj);
  assert.ok(bytes.length > 0);
  const back = await mod.PetFromCapnp(bytes);
  assert.equal(back.id, "p-1");
  assert.equal(back.name, "Rex");
  assert.equal(back.tag, "good");
  assert.equal(back.age, 7);
  // Float32 is precision-limited but 12.5 is exactly representable.
  assert.equal(back.weight, 12.5);
});

test("end-to-end: List<Text> round-trip", async () => {
  const mod = await emitAndImport([{
    name: "Tags",
    dataWords: 0,
    ptrWords: 1,
    fields: [{ name: "items", ordinal: 0, type: "List(Text)", kind: "pointer", ptrIndex: 0 }],
  }]);
  const obj = { items: ["a", "b", "c"] };
  const bytes = await mod.TagsToCapnp(obj);
  const back = await mod.TagsFromCapnp(bytes);
  assert.deepEqual(back.items, ["a", "b", "c"]);
});

test("end-to-end: nested struct round-trip", async () => {
  const mod = await emitAndImport([
    { name: "Pet", dataWords: 0, ptrWords: 1, fields: [{ name: "name", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 }] },
    { name: "Owner", dataWords: 0, ptrWords: 2, fields: [
      { name: "name", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 },
      { name: "pet",  ordinal: 1, type: "Pet",  kind: "pointer", ptrIndex: 1 },
    ] },
  ]);
  const obj = { name: "Alice", pet: { name: "Rex" } };
  const bytes = await mod.OwnerToCapnp(obj);
  const back = await mod.OwnerFromCapnp(bytes);
  assert.equal(back.name, "Alice");
  assert.equal(back.pet.name, "Rex");
});

test("end-to-end: List<Struct> round-trip", async () => {
  const mod = await emitAndImport([
    { name: "Pet", dataWords: 0, ptrWords: 1, fields: [{ name: "name", ordinal: 0, type: "Text", kind: "pointer", ptrIndex: 0 }] },
    { name: "Pets", dataWords: 0, ptrWords: 1, fields: [{ name: "items", ordinal: 0, type: "List(Pet)", kind: "pointer", ptrIndex: 0 }] },
  ]);
  const obj = { items: [{ name: "Rex" }, { name: "Whiskers" }, { name: "Tweety" }] };
  const bytes = await mod.PetsToCapnp(obj);
  const back = await mod.PetsFromCapnp(bytes);
  assert.deepEqual(back.items, [{ name: "Rex" }, { name: "Whiskers" }, { name: "Tweety" }]);
});

// --- CLI integration -----------------------------------------------

test("CLI: emit-codec writes a module + reports per-struct summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-codec-cli-"));
  // Use a capnp source so layouts are computed by the bundled compiler.
  const capnpPath = join(dir, "demo.capnp");
  writeFileSync(capnpPath, `@0xabcd1234abcd0001;\n\nstruct Pet { name @0 :Text; age @1 :UInt32; }\n`);
  const manifestPath = join(dir, "demo.manifest.json");
  const r1 = spawnSync("node", [CLI, "manifest", capnpPath, "-o", manifestPath], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);

  const codecPath = join(dir, "codec.mjs");
  const r2 = spawnSync("node", [CLI, "emit-codec", manifestPath, "-o", codecPath], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stderr, /codec\(s\) emitted/);

  const text = readFileSync(codecPath, "utf8");
  assert.match(text, /export async function PetToCapnp/);
  assert.match(text, /export async function PetFromCapnp/);
});

test("CLI: emit-codec on an OpenAPI source resolves layouts via emit-capnp + capnpc", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-codec-cli-"));
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify({
    openapi: "3.0.3",
    info: { title: "T", version: "0" },
    paths: {},
    components: {
      schemas: {
        Pet: { type: "object", required: ["id"], properties: { id: { type: "string" }, name: { type: "string" } } },
      },
    },
  }));
  const manifestPath = join(dir, "spec.manifest.json");
  const r1 = spawnSync("node", [CLI, "manifest", specPath, "-o", manifestPath], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);

  const codecPath = join(dir, "codec.mjs");
  const r2 = spawnSync("node", [CLI, "emit-codec", manifestPath, "-o", codecPath], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const text = readFileSync(codecPath, "utf8");
  // OpenAPI's `Pet` schema becomes a capnp `struct Pet` and gets a codec.
  assert.match(text, /export async function PetToCapnp/);
});
