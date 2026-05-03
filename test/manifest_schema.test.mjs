// manifest.schema.json: validates a real manifest end-to-end.
//
// Uses a small in-tree validator (no new runtime dep) that covers the
// JSON Schema constructs the manifest schema actually uses: required,
// type, enum, const, additionalProperties, items, $ref, properties,
// pattern, anyOf. Sufficient for the schema we publish.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseOpenApi } from "../js/openapi_parser.mjs";
import { buildManifest } from "../js/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCHEMA = JSON.parse(readFileSync(resolve(ROOT, "schemas/manifest.schema.json"), "utf8"));

// --- Tiny JSON Schema validator (subset) -----------------------------

function validate(value, schema, root = schema, path = "") {
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/(.+)$/);
    if (!m) return [`${path}: external $ref not supported`];
    const parts = m[1].split("/");
    let cur = root;
    for (const p of parts) cur = cur?.[p];
    return cur ? validate(value, cur, root, path) : [`${path}: $ref ${schema.$ref} did not resolve`];
  }
  if (schema.anyOf) {
    for (const s of schema.anyOf) {
      const errs = validate(value, s, root, path);
      if (errs.length === 0) return [];
    }
    return [`${path}: did not match any of anyOf`];
  }
  if (schema.const !== undefined && value !== schema.const) {
    return [`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`];
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer-or-number" : typeof value;
    const ok = types.some((t) => {
      if (t === "integer") return typeof value === "number" && Number.isInteger(value);
      if (t === "number") return typeof value === "number";
      if (t === "string") return typeof value === "string";
      if (t === "boolean") return typeof value === "boolean";
      if (t === "null") return value === null;
      if (t === "array") return Array.isArray(value);
      if (t === "object") return value && typeof value === "object" && !Array.isArray(value);
      return false;
    });
    if (!ok) return [`${path}: expected type ${types.join("|")}, got ${actual}`];
  }
  if (schema.pattern && typeof value === "string") {
    if (!new RegExp(schema.pattern).test(value)) {
      return [`${path}: does not match pattern ${schema.pattern}`];
    }
  }
  const errs = [];
  if (schema.type === "object" || schema.properties || schema.required) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const r of schema.required ?? []) {
        if (!(r in value)) errs.push(`${path}: missing required property ${r}`);
      }
      for (const [k, v] of Object.entries(value)) {
        const sub = schema.properties?.[k];
        if (sub) errs.push(...validate(v, sub, root, `${path}.${k}`));
      }
    }
  }
  if (schema.type === "array" && schema.items) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => errs.push(...validate(v, schema.items, root, `${path}[${i}]`)));
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const [k, v] of Object.entries(value)) {
        if (!known.has(k)) errs.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
      }
    }
  }
  return errs;
}

// --- Tests -----------------------------------------------------------

test("manifest.schema.json: file is a valid JSON Schema (parses, has $defs)", () => {
  assert.equal(SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.ok(SCHEMA.$defs?.struct);
  assert.ok(SCHEMA.$defs?.restMethod);
  assert.ok(SCHEMA.$defs?.lock);
});

test("manifest.schema.json: validates a manifest from the petstore smoke spec", () => {
  const m = buildManifest(parseOpenApi({
    openapi: "3.0.3",
    info: { title: "Petstore", version: "1.0.0" },
    paths: {
      "/pets": {
        get: { operationId: "listPets", responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } } },
      },
    },
    components: {
      schemas: {
        Pet: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
      },
    },
  }), { source: { name: "smoke.json", format: "openapi" } });
  const errs = validate(m, SCHEMA);
  assert.deepEqual(errs, [], `validation errors:\n${errs.join("\n")}`);
});

test("manifest.schema.json: validates an empty manifest envelope", () => {
  const m = buildManifest(
    { structs: [], interfaces: [], restApis: [] },
    { source: { name: "empty.capnp", format: "capnp" } },
  );
  const errs = validate(m, SCHEMA);
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("manifest.schema.json: rejects a manifest with a bad source.format", () => {
  const m = buildManifest(
    { structs: [], interfaces: [], restApis: [] },
    { source: { name: "x", format: "xml" } },     // bogus
  );
  const errs = validate(m, SCHEMA);
  assert.ok(errs.some((e) => e.includes("source.format") && e.includes("not one of")), `expected source.format error, got:\n${errs.join("\n")}`);
});

test("CLI: `manifest --schema` prints the JSON Schema", () => {
  const r = spawnSync("node", [resolve(ROOT, "bin/capnwasm.mjs"), "manifest", "--schema"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.$id, SCHEMA.$id);
  assert.equal(parsed.title, SCHEMA.title);
});
