// Microbench: sum a 10,000-element Float64 list, three ways.
//
//   1. capnwasm view()  — typed-array view over wasm.memory.buffer,
//      iterate with a native for loop. Zero copy on entry, V8 sees
//      a Float64Array and uses its tight C++ sum loop.
//   2. capnwasm at(i)   — per-element accessor through the slot pool.
//      Each at(i) calls cpp_any_list_get_float64_bits + a bit
//      reinterpret. One wasm boundary per element + per-call setup.
//   3. JSON.parse + iter — parse the JSON-encoded array into a JS
//      Array<number>, iterate. The all-in baseline if you weren't
//      using capnwasm.
//
// Result interpretation:
//   - view() wins by far. Wire bytes are *already* the typed-array bytes;
//     iteration is V8-native typed-array reads.
//   - at(i) is the previous capnwasm story: correct, but pays a wasm
//     call per element.
//   - JSON.parse is the baseline. The whole-array parse cost dominates.

import { load as loadWasm } from "../dist/inlined.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cpp = await loadWasm();

const SCHEMA_PATH = join(tmpdir(), `bench_list_view_${process.pid}.capnp`);
const GEN_PATH    = join(tmpdir(), `bench_list_view_${process.pid}.gen.mjs`);
writeFileSync(SCHEMA_PATH, `@0xb1b07a55b8a40881; struct V { values @0 :List(Float64); }\n`);
const r = spawnSync(process.execPath, ["bin/capnwasm.mjs", "gen", SCHEMA_PATH, "-o", GEN_PATH]);
if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1); }
const { openV } = await import(GEN_PATH);

const SCHEMA = defineSchema({
  values: { kind: "listFloat64", slot: 0 },
}, { dataWords: 0, ptrWords: 1 });

// 8000 elements × 8 bytes = 64 KB, the M1 single-segment ceiling. Both
// at(i) and view() share the same JS pointer-decode + typed-array
// reads after the Trap 9 fix; bench at the largest payload that fits a
// single segment so the comparison reflects the realistic upper bound.
const N = 8000;
const values = new Array(N);
for (let i = 0; i < N; i++) values[i] = Math.sin(i) * 1000 + i * 0.5;

const b = buildDynamic(cpp, SCHEMA);
b.set("values", values);
const capnBytes = b.finalize();
const jsonBytes = new TextEncoder().encode(JSON.stringify({ values }));

function timed(fn, { warmMs = 200, budgetMs = 150, trials = 5 } = {}) {
  let warmEnd = performance.now() + warmMs;
  while (performance.now() < warmEnd) fn();
  const results = [];
  for (let t = 0; t < trials; t++) {
    let iters = 0;
    const t0 = performance.now();
    const end = t0 + budgetMs;
    while (performance.now() < end) { fn(); iters++; }
    const elapsed = performance.now() - t0;
    results.push((elapsed * 1e6) / iters);
  }
  results.sort((a, b) => a - b);
  return results[Math.floor(results.length / 2)];
}

function fmt(ns) {
  if (ns < 1000) return `${ns.toFixed(0)} ns`;
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`;
  return `${(ns / 1e6).toFixed(2)} ms`;
}

const viewMedian = timed(() => {
  const r = openV(cpp, capnBytes);
  const v = r.values.view();
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  r.dispose();
  return sum;
});

const atMedian = timed(() => {
  const r = openV(cpp, capnBytes);
  const list = r.values;
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list.at(i);
  r.dispose();
  return sum;
});

const jsonMedian = timed(() => {
  const o = JSON.parse(new TextDecoder().decode(jsonBytes));
  let sum = 0;
  for (let i = 0; i < o.values.length; i++) sum += o.values[i];
  return sum;
});

console.log(`Sum of ${N.toLocaleString()} Float64s. Median ns/op (5 trials × 150 ms after 200 ms warmup):`);
console.log("");
console.log(`  capnwasm view()  : ${fmt(viewMedian).padStart(10)}    (${capnBytes.length} bytes wire)`);
console.log(`  capnwasm at(i)   : ${fmt(atMedian).padStart(10)}    (${capnBytes.length} bytes wire)`);
console.log(`  JSON.parse + sum : ${fmt(jsonMedian).padStart(10)}    (${jsonBytes.length} bytes wire)`);
console.log("");
console.log(`  view() vs at(i)  : ${(atMedian / viewMedian).toFixed(1)}x faster`);
console.log(`  view() vs JSON   : ${(jsonMedian / viewMedian).toFixed(1)}x faster`);
console.log(`  Wire size        : capnwasm ${(capnBytes.length / jsonBytes.length * 100).toFixed(0)}% of JSON`);

// Cleanup tmp.
try { unlinkSync(SCHEMA_PATH); } catch (_) {}
try { unlinkSync(GEN_PATH); } catch (_) {}
try { unlinkSync(GEN_PATH.replace(/\.mjs$/, ".d.ts")); } catch (_) {}
