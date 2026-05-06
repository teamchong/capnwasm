// Round-trip the public Cloudflare OpenAPI schema through the
// `npx capnwasm convert` CLI:
//
//   OpenAPI JSON  -> .capnp
//   .capnp        -> OpenAPI YAML
//   .capnp        -> OpenAPI JSON  (parity check with the YAML output)
//
// The 9.2 MB fixture is gitignored. Run this once to download it; the
// test skips with a hint when the fixture is missing:
//
//   curl -sL https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json \
//        -o test/_fixtures/cloudflare-openapi.json
//
// Validation criteria, ordered from "must hold" down to "informational":
//
//   * Every output (.capnp, .yaml, .json) is non-empty and parses cleanly.
//   * The reconstructed OpenAPI doc declares an OpenAPI 3.x version.
//   * Path count is preserved (1851 in / 1851 out).
//   * Every input path is present in the output.
//   * For each path, every input HTTP verb is preserved (extra verbs in
//     the output are tolerated; emit-capnp shouldn't introduce any).
//   * YAML and JSON outputs from the same .capnp share the same path set.
//
// Lossy bits (info.title reformatted, descriptions/format/pattern/etc.
// dropped at the .capnp boundary) are reported via t.diagnostic and not
// asserted, since the .capnp text format physically can't carry them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "yaml";

const REPO = resolve(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(REPO, "bin/capnwasm.mjs");
const FIXTURE = join(REPO, "test/_fixtures/cloudflare-openapi.json");

const FETCH_HINT = `Run this once to download the 9.2 MB schema:
  curl -sL https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json \\
       -o test/_fixtures/cloudflare-openapi.json`;

const HTTP_VERBS = ["get", "post", "put", "delete", "patch", "options", "head"];

function runCli(args) {
  // 4-minute ceiling so a stuck wasm load can't hang CI forever; the
  // .capnp -> YAML pass takes ~25s on the Cloudflare schema today.
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    timeout: 240_000,
  });
  if (r.status !== 0) {
    throw new Error(
      `capnwasm ${args.join(" ")} failed (exit=${r.status}, signal=${r.signal})\n` +
      `stderr:\n${r.stderr}\nstdout:\n${r.stdout}`,
    );
  }
  return r;
}

function pathVerbs(operationsObj) {
  return new Set(Object.keys(operationsObj ?? {}).filter((k) => HTTP_VERBS.includes(k)));
}

test("convert: Cloudflare OpenAPI round-trips through .capnp to YAML and JSON", { timeout: 5 * 60_000 }, async (t) => {
  if (!existsSync(FIXTURE)) {
    t.skip(`fixture not present: ${FIXTURE}\n${FETCH_HINT}`);
    return;
  }

  // ---- Read original ----------------------------------------------------
  const rawText = readFileSync(FIXTURE, "utf8");
  const inputJson = JSON.parse(rawText);
  const inputPaths = inputJson.paths ?? {};
  const inputPathCount = Object.keys(inputPaths).length;
  const inputVerbsByPath = new Map();
  let inputVerbCount = 0;
  for (const [p, ops] of Object.entries(inputPaths)) {
    const v = pathVerbs(ops);
    inputVerbsByPath.set(p, v);
    inputVerbCount += v.size;
  }
  const inputSchemaCount = Object.keys(inputJson.components?.schemas ?? {}).length;
  t.diagnostic(
    `input: ${(rawText.length / 1024 / 1024).toFixed(1)} MB, ` +
    `${inputPathCount} paths, ${inputVerbCount} (path,verb) pairs, ${inputSchemaCount} schemas`,
  );

  // ---- Phase 1: OpenAPI JSON -> .capnp ----------------------------------
  const dir = await mkdtemp(join(tmpdir(), "capnwasm-cf-"));
  const capnpPath = join(dir, "cloudflare.capnp");
  runCli(["convert", FIXTURE, "-o", capnpPath]);
  assert.ok(existsSync(capnpPath), ".capnp output exists");
  const capnpBytes = statSync(capnpPath).size;
  assert.ok(capnpBytes > 1024, `.capnp output is non-trivial (${capnpBytes} bytes)`);
  t.diagnostic(`emitted .capnp: ${(capnpBytes / 1024 / 1024).toFixed(1)} MB`);

  // ---- Phase 2: .capnp -> OpenAPI YAML ----------------------------------
  const yamlPath = join(dir, "cloudflare.yaml");
  runCli(["convert", capnpPath, "-o", yamlPath]);
  assert.ok(existsSync(yamlPath), "YAML output exists");
  const yamlText = await readFile(yamlPath, "utf8");
  let yamlDoc;
  try {
    yamlDoc = yaml.parse(yamlText);
  } catch (err) {
    throw new Error(`YAML output failed to parse: ${err.message}`);
  }
  assert.ok(typeof yamlDoc === "object" && yamlDoc !== null, "YAML output is an object");
  assert.ok(typeof yamlDoc.openapi === "string" && yamlDoc.openapi.startsWith("3."),
    `OpenAPI 3.x version present (got: ${JSON.stringify(yamlDoc.openapi)})`);
  assert.ok(typeof yamlDoc.paths === "object" && yamlDoc.paths !== null, "doc has paths object");

  const yamlPathCount = Object.keys(yamlDoc.paths).length;
  const yamlSchemaCount = Object.keys(yamlDoc.components?.schemas ?? {}).length;
  t.diagnostic(
    `yaml: ${(yamlText.length / 1024 / 1024).toFixed(1)} MB, ` +
    `${yamlPathCount} paths, ${yamlSchemaCount} schemas`,
  );

  // ---- Path-level fidelity ---------------------------------------------
  assert.equal(yamlPathCount, inputPathCount,
    `path count preserved (${inputPathCount} in, ${yamlPathCount} out)`);

  const yamlPaths = new Set(Object.keys(yamlDoc.paths));
  const missingPaths = [];
  for (const p of inputVerbsByPath.keys()) {
    if (!yamlPaths.has(p)) missingPaths.push(p);
  }
  assert.deepEqual(missingPaths, [],
    `every input path appears in YAML output (${missingPaths.length} missing; first few: ${missingPaths.slice(0, 5).join(", ")})`);

  // ---- Verb-level fidelity ---------------------------------------------
  const verbsMissing = [];
  for (const [p, inVerbs] of inputVerbsByPath) {
    const outVerbs = pathVerbs(yamlDoc.paths[p]);
    for (const v of inVerbs) {
      if (!outVerbs.has(v)) verbsMissing.push(`${v.toUpperCase()} ${p}`);
    }
  }
  if (verbsMissing.length > 0) {
    // Show up to 20 missing entries in the assertion message to make
    // diagnosis easier without flooding logs.
    const sample = verbsMissing.slice(0, 20).join("\n    ");
    assert.fail(
      `${verbsMissing.length} (path,verb) pair(s) missing in YAML output. First ${Math.min(20, verbsMissing.length)}:\n    ${sample}`,
    );
  }
  t.diagnostic(`all ${inputVerbCount} (path,verb) pairs preserved`);

  // ---- Phase 3: .capnp -> OpenAPI JSON ----------------------------------
  // Same .capnp source, JSON output. YAML and JSON should be the same
  // canonical doc serialized two ways.
  const jsonPath = join(dir, "cloudflare.json");
  runCli(["convert", capnpPath, "-o", jsonPath]);
  const jsonDoc = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(Object.keys(jsonDoc.paths).length, yamlPathCount,
    "JSON and YAML outputs have the same path count");
  assert.deepEqual(
    Object.keys(jsonDoc.paths).sort(),
    Object.keys(yamlDoc.paths).sort(),
    "JSON and YAML outputs have the same path set",
  );

  // ---- Lossy diagnostics (informational) -------------------------------
  if (yamlDoc.info?.title !== inputJson.info?.title) {
    t.diagnostic(
      `info.title reformatted at the .capnp boundary ` +
      `('${inputJson.info?.title}' -> '${yamlDoc.info?.title}'); ` +
      `capnp interface names can't have spaces.`,
    );
  }
  if (!yamlDoc.info?.version || yamlDoc.info.version !== inputJson.info?.version) {
    t.diagnostic(
      `info.version not preserved (input: '${inputJson.info?.version}', ` +
      `output: '${yamlDoc.info?.version}'); capnp text format can't carry it.`,
    );
  }
  // Schema count typically grows because emit-capnp materializes per-method
  // {Method}$Params and {Method}$Results structs that round-trip back as
  // standalone schemas. That's lossy in the direction "shapes", not in
  // "operations covered" — so report it without failing the test.
  if (yamlSchemaCount !== inputSchemaCount) {
    t.diagnostic(
      `components.schemas count differs (input: ${inputSchemaCount}, ` +
      `output: ${yamlSchemaCount}); emit-capnp materializes Params/Results ` +
      `as standalone structs.`,
    );
  }
});
