// Unified pipeline runner: manifest → adapt → lock → emit-capnp →
// emit-openapi → emit-agents in one pass.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runPipeline, loadConfig } from "../js/run_pipeline.mjs";

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
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
  },
  components: { schemas: { Pet: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } },
};

function setupSpec() {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-pipe-"));
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify(PETSTORE));
  return { dir, specPath };
}

// --- Programmatic API -------------------------------------------------

test("runPipeline: writes the default eight artifacts for an OpenAPI source", async () => {
  const { dir, specPath } = setupSpec();
  const out = join(dir, "out");
  const report = await runPipeline({ input: specPath, outputDir: out, log: () => {} });
  for (const f of [
    "spec.manifest.json", "spec.adapted.json", "capnwasm.lock",
    "spec.capnp", "spec.openapi.json",
    "AGENTS.md", "skill.md", "llms.txt",
  ]) {
    assert.ok(existsSync(join(out, f)), `expected ${f} in ${out}`);
  }
  assert.equal(report.artifacts.length, 8);
});

test("runPipeline: --no-<step> disables a step", async () => {
  const { dir, specPath } = setupSpec();
  const out = join(dir, "out");
  await runPipeline({
    input: specPath,
    outputDir: out,
    steps: { emitAgents: false, lock: false },
    log: () => {},
  });
  assert.ok(!existsSync(join(out, "AGENTS.md")));
  assert.ok(!existsSync(join(out, "capnwasm.lock")));
  assert.ok(existsSync(join(out, "spec.openapi.json")));
});

test("runPipeline: lockIn is honored (existing ordinals preserved)", async () => {
  const { dir, specPath } = setupSpec();

  const out1 = join(dir, "out1");
  await runPipeline({ input: specPath, outputDir: out1, log: () => {} });
  const lock1 = JSON.parse(readFileSync(join(out1, "capnwasm.lock"), "utf8"));

  const out2 = join(dir, "out2");
  await runPipeline({
    input: specPath,
    outputDir: out2,
    lockIn: join(out1, "capnwasm.lock"),
    log: () => {},
  });
  const lock2 = JSON.parse(readFileSync(join(out2, "capnwasm.lock"), "utf8"));
  assert.deepEqual(lock2.structs, lock1.structs);
});

test("runPipeline: emit-codec on an OpenAPI source compiles capnp internally and writes the codec", async () => {
  const { dir, specPath } = setupSpec();
  const out = join(dir, "out");
  await runPipeline({
    input: specPath,
    outputDir: out,
    steps: { emitCodec: true, emitAgents: false },
    log: () => {},
  });
  assert.ok(existsSync(join(out, "spec.codec.mjs")));
  const text = readFileSync(join(out, "spec.codec.mjs"), "utf8");
  assert.match(text, /export async function PetToCapnp/);
});

// --- loadConfig -------------------------------------------------------

test("loadConfig: file values + CLI overrides + step defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-cfg-"));
  const cfgPath = join(dir, "capnwasm.config.json");
  writeFileSync(cfgPath, JSON.stringify({
    input: "./from-file.json",
    outputDir: "./from-file-out",
    steps: { emitAgents: false },
  }));
  const cfg = await loadConfig({
    configPath: cfgPath,
    cli: { outputDir: "./cli-override" },
  });
  assert.equal(cfg.input, "./from-file.json");
  assert.equal(cfg.outputDir, "./cli-override");
  assert.equal(cfg.steps.emitAgents, false);
  assert.equal(cfg.steps.manifest, true);
  assert.equal(cfg.steps.emitCodec, false);
});

// --- CLI integration --------------------------------------------------

test("CLI: pipeline runs end-to-end from a config file", () => {
  const { dir, specPath } = setupSpec();
  const out = join(dir, "out");
  const cfgPath = join(dir, "capnwasm.config.json");
  writeFileSync(cfgPath, JSON.stringify({
    input: specPath,
    outputDir: out,
    steps: { emitCapnp: true, emitOpenapi: true, emitAgents: false, lock: false, adapt: false },
  }));
  const r = spawnSync("node", [CLI, "pipeline", "--config", cfgPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(out, "spec.capnp")));
  assert.ok(existsSync(join(out, "spec.openapi.json")));
  assert.ok(!existsSync(join(out, "AGENTS.md")));
  assert.match(r.stderr, /Pipeline finished/);
});

test("CLI: pipeline auto-loads capnwasm.config.json from cwd", () => {
  const { dir, specPath } = setupSpec();
  writeFileSync(join(dir, "capnwasm.config.json"), JSON.stringify({
    input: specPath,
    outputDir: join(dir, "out"),
    steps: { emitAgents: false, lock: false, adapt: false, emitCapnp: false, emitOpenapi: true },
  }));
  const r = spawnSync("node", [CLI, "pipeline"], { encoding: "utf8", cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "out", "spec.openapi.json")));
});
