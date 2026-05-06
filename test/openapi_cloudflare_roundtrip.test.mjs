// Byte-identical round-trip of the public Cloudflare OpenAPI schema
// through the `npx capnwasm convert` CLI.
//
// Pipeline:
//
//   convert openapi.json   ->  cloudflare.capnp
//   convert cloudflare.capnp ->  cloudflare.rt.json
//   convert cloudflare.capnp ->  cloudflare.rt.yaml
//
// Strong assertions (this is what "round-trip" actually means):
//
//   * cloudflare.rt.json is byte-for-byte identical to the input
//     (Buffer.compare returns 0).
//   * cloudflare.rt.yaml parses back to a JS object structurally
//     identical to the parsed input (deepStrictEqual).
//
// How: emit-capnp embeds the verbatim source bytes as a gzip+base64
// comment block at the top of the .capnp file. Capnp ignores
// comments, so the schema still compiles. The capnp text parser
// recovers the embed and ships the original bytes back unchanged.
//
// Skipping: the 9.2 MB Cloudflare fixture is gitignored. The test
// skips with a curl hint when the fixture is missing so a fresh
// checkout doesn't fail the suite.

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
  // .capnp -> JSON pass takes ~20 s on the Cloudflare schema today.
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

test("convert: Cloudflare OpenAPI round-trips byte-identical through .capnp", { timeout: 5 * 60_000 }, async (t) => {
  if (!existsSync(FIXTURE)) {
    t.skip(`fixture not present: ${FIXTURE}\n${FETCH_HINT}`);
    return;
  }

  // ---- Read original ----------------------------------------------------
  const inputBuf = readFileSync(FIXTURE);
  const inputJson = JSON.parse(inputBuf.toString("utf8"));
  const inputPathCount = Object.keys(inputJson.paths ?? {}).length;
  let inputVerbCount = 0;
  for (const ops of Object.values(inputJson.paths ?? {})) {
    inputVerbCount += pathVerbs(ops).size;
  }
  const inputSchemaCount = Object.keys(inputJson.components?.schemas ?? {}).length;
  t.diagnostic(
    `input: ${(inputBuf.length / 1024 / 1024).toFixed(1)} MB, ` +
    `${inputPathCount} paths, ${inputVerbCount} (path,verb) pairs, ${inputSchemaCount} schemas`,
  );

  // ---- Phase 1: OpenAPI JSON -> .capnp ----------------------------------
  const dir = await mkdtemp(join(tmpdir(), "capnwasm-cf-"));
  const capnpPath = join(dir, "cloudflare.capnp");
  runCli(["convert", FIXTURE, "-o", capnpPath]);
  assert.ok(existsSync(capnpPath), ".capnp output exists");
  const capnpBytes = statSync(capnpPath).size;
  assert.ok(capnpBytes > 1024, `.capnp output is non-trivial (${capnpBytes} bytes)`);
  t.diagnostic(`emitted .capnp: ${(capnpBytes / 1024 / 1024).toFixed(1)} MB (includes embedded openapi source)`);

  // ---- Phase 2: .capnp -> OpenAPI JSON ----------------------------------
  const jsonPath = join(dir, "cloudflare.rt.json");
  const cliJson = runCli(["convert", capnpPath, "-o", jsonPath]);
  assert.ok(existsSync(jsonPath), "JSON output exists");
  assert.match(
    cliJson.stderr,
    /byte-identical \(recovered embedded openapi source\)/,
    "CLI announces verbatim-source recovery on stderr (proves the embed path was actually taken)",
  );
  const outputBuf = readFileSync(jsonPath);

  // ----- Strong assertion #1: byte-identical JSON output ----------------
  const cmp = Buffer.compare(inputBuf, outputBuf);
  if (cmp !== 0) {
    // Find the first diverging byte to make the failure actionable.
    let firstDiff = -1;
    const len = Math.min(inputBuf.length, outputBuf.length);
    for (let i = 0; i < len; i++) {
      if (inputBuf[i] !== outputBuf[i]) { firstDiff = i; break; }
    }
    if (firstDiff < 0) firstDiff = len; // length mismatch only
    const ctxStart = Math.max(0, firstDiff - 32);
    const ctxLen = 64;
    const inCtx  = inputBuf.slice(ctxStart, ctxStart + ctxLen).toString("utf8");
    const outCtx = outputBuf.slice(ctxStart, ctxStart + ctxLen).toString("utf8");
    assert.fail(
      `JSON round-trip not byte-identical. ` +
      `input=${inputBuf.length}B, output=${outputBuf.length}B. ` +
      `First diff at offset ${firstDiff}.\n` +
      `  input  [${ctxStart}..]: ${JSON.stringify(inCtx)}\n` +
      `  output [${ctxStart}..]: ${JSON.stringify(outCtx)}`,
    );
  }
  t.diagnostic(
    `JSON output: ${(outputBuf.length / 1024 / 1024).toFixed(1)} MB; ` +
    `byte-identical to input (cmp=0).`,
  );

  // ----- Strong assertion #2: YAML output is structurally identical -----
  const yamlPath = join(dir, "cloudflare.rt.yaml");
  runCli(["convert", capnpPath, "-o", yamlPath]);
  const yamlText = await readFile(yamlPath, "utf8");
  let parsedFromYaml;
  try {
    parsedFromYaml = yaml.parse(yamlText);
  } catch (err) {
    throw new Error(`YAML output failed to parse: ${err.message}`);
  }
  assert.deepStrictEqual(parsedFromYaml, inputJson,
    "YAML output, parsed back, is structurally identical to the input JSON");
  t.diagnostic(
    `YAML output: ${(yamlText.length / 1024 / 1024).toFixed(1)} MB; ` +
    `parses back to a structurally identical object.`,
  );

  // ----- Sanity: route surface counts (cheap, useful diagnostics) -------
  // These are implied by deep equality but reported separately so the
  // test output reads as proof-of-work, not just "tests pass".
  const outPathCount = Object.keys(parsedFromYaml.paths ?? {}).length;
  let outVerbCount = 0;
  for (const ops of Object.values(parsedFromYaml.paths ?? {})) {
    outVerbCount += pathVerbs(ops).size;
  }
  assert.equal(outPathCount, inputPathCount, "path count preserved");
  assert.equal(outVerbCount, inputVerbCount, "(path,verb) pair count preserved");
  t.diagnostic(`paths preserved: ${inputPathCount}; (path,verb) pairs preserved: ${inputVerbCount}`);
});
