// Re-runs the dynamic-vs-codegen bench in fresh Node subprocesses, one
// per test. Each test gets its own V8 heap, JIT state, and inline-cache
// history — so the order in which we run them doesn't bias the result.
//
// Also forces the read values into a black-hole sink (XOR-summed, printed
// as a string at the end) so V8 can't eliminate the field accesses as dead
// code. Without that, `void r.field` is technically discardable by an
// aggressive optimizer; the side-effect of the wasm boundary call usually
// keeps it, but the result-conversion (BigInt → Number, decode of text)
// is a separate question.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Each test is identified by a tag the worker recognizes. Worker prints
// one line: ok|fail label ns/call iters sink.
const TESTS = [
  { tag: "codegen-read-all",   label: "codegen read 13 fields  " },
  { tag: "dynamic-read-all",   label: "dynamic read 13 fields  " },
  { tag: "dynamic-pick-all",   label: "dynamic pick(13 names)  " },
  { tag: "codegen-pick-3",     label: "codegen pick(['u32','flag0','text'])" },
  { tag: "dynamic-pick-3",     label: "dynamic pick(['u32','flag0','text'])" },
  { tag: "codegen-build",      label: "codegen build 13 fields " },
  { tag: "dynamic-build",      label: "dynamic build 13 fields " },
];

const RUNS = 5;  // average over N independent processes per test
const results = new Map();

const workerPath = resolve(HERE, "dynamic_bench_worker.mjs");

console.log(`\nRunning ${TESTS.length} tests × ${RUNS} subprocess runs each…\n`);
for (const { tag, label } of TESTS) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = spawnSync("node", [workerPath, tag], { encoding: "utf8" });
    if (r.status !== 0) {
      console.log(`  ${label}  FAILED (run ${i + 1}): ${r.stderr.trim()}`);
      runs.push(NaN);
      continue;
    }
    const m = /ns=(\d+(?:\.\d+)?)/.exec(r.stdout);
    if (!m) { runs.push(NaN); continue; }
    runs.push(parseFloat(m[1]));
  }
  // Trim outliers: drop the slowest run (usually the first, system noise).
  const sorted = [...runs].filter(n => !isNaN(n)).sort((a, b) => a - b);
  const trimmed = sorted.slice(0, Math.max(1, sorted.length - 1));
  const median = trimmed[Math.floor(trimmed.length / 2)];
  const min = trimmed[0];
  const max = trimmed[trimmed.length - 1];
  results.set(tag, { median, min, max, runs });
  console.log(`  ${label.padEnd(40)}  ${median.toFixed(0).padStart(6)} ns/call  (min ${min.toFixed(0)}, max ${max.toFixed(0)}, n=${trimmed.length})`);
}

console.log("\n=== Headline ratios (median) ===");
const codegenAll = results.get("codegen-read-all").median;
const dynamicAll = results.get("dynamic-read-all").median;
const dynamicPickAll = results.get("dynamic-pick-all").median;
const codegen3 = results.get("codegen-pick-3").median;
const dynamic3 = results.get("dynamic-pick-3").median;
const codegenBuild = results.get("codegen-build").median;
const dynamicBuild = results.get("dynamic-build").median;

console.log(`  Read all 13 fields:    dynamic ${(dynamicAll / codegenAll).toFixed(2)}× codegen`);
console.log(`  Pick 3 fields:         dynamic ${(dynamic3 / codegen3).toFixed(2)}× codegen`);
console.log(`  Build with 13 fields:  dynamic ${(dynamicBuild / codegenBuild).toFixed(2)}× codegen`);
console.log(`  Dynamic pick(13):      ${(dynamicPickAll / codegenAll).toFixed(2)}× codegen-all-getters`);
