// AGENTS.md / skill.md / llms.txt emitters.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { parseOpenApi } from "../js/openapi_parser.mjs";
import { buildManifest } from "../js/manifest.mjs";
import { buildAgentsMd, buildSkillMd, buildLlmsTxt } from "../js/emit_agents.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

const PETSTORE = {
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets in the store.",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
    "/pets/{id}": {
      get: {
        operationId: "getPet",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
  },
  components: { schemas: { Pet: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } },
};

function manifestFromSpec(spec) {
  return buildManifest(parseOpenApi(spec), { source: { name: "spec.json", format: "openapi" } });
}

// --- AGENTS.md ----------------------------------------------------

test("buildAgentsMd: emits one section per operation with arguments", () => {
  const md = buildAgentsMd(manifestFromSpec(PETSTORE));
  assert.match(md, /^# Petstore$/m);
  assert.match(md, /## `petstore_list_pets`/);
  assert.match(md, /## `petstore_get_pet`/);
  assert.match(md, /\*\*Arguments:\*\*/);
  assert.match(md, /^- `id` \(required, string\)/m);
  assert.match(md, /^- `limit` \(optional/m);
});

test("buildAgentsMd: uses extensions.agentDescription when present", () => {
  const m = manifestFromSpec(PETSTORE);
  m.restApis[0].methods[0].extensions = { agentDescription: "Returns up to 100 pets per page." };
  const md = buildAgentsMd(m);
  assert.match(md, /Returns up to 100 pets per page/);
});

test("buildAgentsMd: falls back to summary when no agentDescription", () => {
  const md = buildAgentsMd(manifestFromSpec(PETSTORE));
  assert.match(md, /List all pets in the store\./);
});

// --- skill.md -----------------------------------------------------

test("buildSkillMd: front-matter + tool list", () => {
  const md = buildSkillMd(manifestFromSpec(PETSTORE));
  assert.match(md, /^---\nname: petstore\n/);
  assert.match(md, /^description: ".+"\n/m);
  assert.match(md, /^- \*\*`petstore_list_pets`\*\*/m);
});

test("buildSkillMd: --name override is respected", () => {
  const md = buildSkillMd(manifestFromSpec(PETSTORE), { name: "my-skill" });
  assert.match(md, /^name: my-skill$/m);
});

// --- llms.txt -----------------------------------------------------

test("buildLlmsTxt: compact one-line-per-tool format", () => {
  const txt = buildLlmsTxt(manifestFromSpec(PETSTORE));
  assert.match(txt, /^# Petstore$/m);
  assert.match(txt, /^## Tools$/m);
  // One bullet line per operation.
  const bullets = txt.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 2);
  assert.match(bullets[0], /^- petstore_list_pets:/);
  assert.match(bullets[1], /^- petstore_get_pet:/);
});

// --- CLI integration ----------------------------------------------

test("CLI: emit-agents writes all three files into --out-dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-agents-"));
  const manifestPath = join(dir, "spec.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifestFromSpec(PETSTORE), null, 2));
  const outDir = join(dir, "out");

  const r = spawnSync("node", [CLI, "emit-agents", manifestPath, "--out-dir", outDir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  assert.ok(existsSync(join(outDir, "AGENTS.md")));
  assert.ok(existsSync(join(outDir, "skill.md")));
  assert.ok(existsSync(join(outDir, "llms.txt")));
  const agents = readFileSync(join(outDir, "AGENTS.md"), "utf8");
  assert.match(agents, /^# Petstore$/m);
});

test("CLI: --format llms emits only llms.txt", () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-agents-"));
  const manifestPath = join(dir, "spec.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifestFromSpec(PETSTORE), null, 2));
  const outDir = join(dir, "out");

  const r = spawnSync("node", [CLI, "emit-agents", manifestPath, "--out-dir", outDir, "--format", "llms"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  assert.ok(!existsSync(join(outDir, "AGENTS.md")));
  assert.ok(!existsSync(join(outDir, "skill.md")));
  assert.ok(existsSync(join(outDir, "llms.txt")));
});
