import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildManifest } from "../js/manifest.mjs";
import { diffManifests, fingerprintManifest } from "../js/compat.mjs";

const CLI = fileURLToPath(new URL("../bin/capnwasm.mjs", import.meta.url));

function restManifest(methods, structs = []) {
  return buildManifest({
    structs,
    restApis: [{ name: "Pets", baseUrl: null, defaults: {}, methods }],
  }, { source: { name: "api.ts", format: "typescript-rest" } });
}

test("fingerprintManifest: ignores source metadata and generatedAt", () => {
  const a = restManifest([{ name: "list", method: "GET", path: "/pets", params: [], returnType: "Pet[]" }]);
  const b = JSON.parse(JSON.stringify(a));
  b.source.name = "renamed.json";
  b.source.path = "/tmp/renamed.json";
  b.source.generatedAt = "2099-01-01T00:00:00.000Z";

  assert.equal(fingerprintManifest(a), fingerprintManifest(b));
});

test("diffManifests: added optional REST param and operation are non-breaking", () => {
  const v1 = restManifest([{ name: "list", method: "GET", path: "/pets", params: [], returnType: "Pet[]" }]);
  const v2 = restManifest([
    { name: "list", method: "GET", path: "/pets", params: [{ name: "limit", role: "query", type: "number", optional: true }], returnType: "Pet[]" },
    { name: "get", method: "GET", path: "/pets/{id}", params: [{ name: "id", role: "path", type: "string", optional: false }], returnType: "Pet" },
  ]);

  const report = diffManifests(v1, v2);
  assert.equal(report.compatible, true);
  assert.equal(report.summary.breaking, 0);
  assert.equal(report.summary.nonBreaking, 2);
  assert.ok(report.changes.some((c) => c.kind === "param.added" && c.severity === "non-breaking"));
  assert.ok(report.changes.some((c) => c.kind === "operation.added" && c.severity === "non-breaking"));
});

test("diffManifests: removed REST operation, path change, and required param are breaking", () => {
  const v1 = restManifest([
    { name: "list", method: "GET", path: "/pets", params: [], returnType: "Pet[]" },
    { name: "get", method: "GET", path: "/pets/{id}", params: [{ name: "id", role: "path", type: "string", optional: false }], returnType: "Pet" },
  ]);
  const v2 = restManifest([
    { name: "list", method: "GET", path: "/animals", params: [{ name: "tenant", role: "query", type: "string", optional: false }], returnType: "Pet[]" },
  ]);

  const report = diffManifests(v1, v2);
  assert.equal(report.compatible, false);
  assert.ok(report.summary.breaking >= 3);
  assert.ok(report.changes.some((c) => c.kind === "operation.removed"));
  assert.ok(report.changes.some((c) => c.kind === "operation.pathChanged"));
  assert.ok(report.changes.some((c) => c.kind === "param.added" && c.severity === "breaking"));
});

test("diffManifests: struct field removal/type/ordinal changes are breaking", () => {
  const v1 = restManifest([], [{
    name: "Pet",
    fields: [
      { name: "id", ordinal: 0, type: "Text", kind: "pointer" },
      { name: "age", ordinal: 1, type: "UInt32", kind: "data" },
      { name: "tag", ordinal: 2, type: "Text", kind: "pointer" },
    ],
  }]);
  const v2 = restManifest([], [{
    name: "Pet",
    fields: [
      { name: "id", ordinal: 0, type: "Text", kind: "pointer" },
      { name: "age", ordinal: 3, type: "Text", kind: "pointer" },
      { name: "weight", ordinal: 4, type: "Float64", kind: "data" },
    ],
  }]);

  const report = diffManifests(v1, v2);
  assert.equal(report.compatible, false);
  assert.ok(report.changes.some((c) => c.kind === "field.removed" && c.path.endsWith(".tag")));
  assert.ok(report.changes.some((c) => c.kind === "field.typeChanged" && c.path.endsWith(".age.type")));
  assert.ok(report.changes.some((c) => c.kind === "field.ordinalChanged" && c.path.endsWith(".age.ordinal")));
  assert.ok(report.changes.some((c) => c.kind === "field.added" && c.severity === "non-breaking"));
});

test("diffManifests: OpenAPI object schema changes are classified conservatively", () => {
  const v1 = {
    manifestVersion: 1,
    structs: [],
    interfaces: [],
    restApis: [],
    openapi: { components: { schemas: { Pet: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        kind: { type: "string", enum: ["dog", "cat"] },
      },
    } } } },
  };
  const v2 = {
    ...v1,
    openapi: { components: { schemas: { Pet: {
      type: "object",
      required: ["id", "displayName"],
      properties: {
        id: { type: "string" },
        displayName: { type: "string" },
        kind: { type: "string", enum: ["dog", "hamster"] },
      },
    } } } },
  };

  const report = diffManifests(v1, v2);
  assert.equal(report.compatible, false);
  assert.ok(report.changes.some((c) => c.kind === "schema.propertyRemoved" && c.path.endsWith(".name")));
  assert.ok(report.changes.some((c) => c.kind === "schema.propertyAdded" && c.path.endsWith(".displayName") && c.severity === "breaking"));
  assert.ok(report.changes.some((c) => c.kind === "schema.enumValueRemoved" && c.path.endsWith(".cat")));
  assert.ok(report.changes.some((c) => c.kind === "schema.enumValueAdded" && c.severity === "non-breaking"));
});

test("CLI: compat writes report and exits 2 when breaking changes are found", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-compat-"));
  const oldPath = join(dir, "old.manifest.json");
  const newPath = join(dir, "new.manifest.json");
  const v1 = restManifest([{ name: "get", method: "GET", path: "/pets/{id}", params: [{ name: "id", role: "path", type: "string", optional: false }], returnType: "Pet" }]);
  const v2 = restManifest([{ name: "get", method: "GET", path: "/animals/{id}", params: [{ name: "id", role: "path", type: "string", optional: false }], returnType: "Pet" }]);
  writeFileSync(oldPath, JSON.stringify(v1, null, 2));
  writeFileSync(newPath, JSON.stringify(v2, null, 2));

  const result = spawnSync(process.execPath, [CLI, "compat", oldPath, newPath], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /compat: 1 change\(s\): 1 breaking, 0 non-breaking/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.compatible, false);
  assert.equal(report.summary.breaking, 1);
  assert.equal(report.changes[0].kind, "operation.pathChanged");
});
