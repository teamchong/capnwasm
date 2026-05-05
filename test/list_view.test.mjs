// list.view(): zero-copy typed-array view over wasm.memory.buffer for
// primitive-element lists. Adds the "wire bytes ARE the runtime bytes"
// API surface for List(UInt8/Int8/UInt16/Int16/UInt32/Int32/UInt64/Int64/
// Float32/Float64). Bool is intentionally absent (bit-packed elements).
//
// We build wire payloads via buildDynamic (which has full primitive-list
// setter support) and read them via the codegen reader (where view() is
// emitted). This isolates the view() codegen from any builder-side
// changes.
//
// What this test asserts, in order of importance:
//   1. Element values match per-index at(i) reads (correctness).
//   2. The returned typed array has the right constructor for each type.
//   3. view().buffer === cpp.memory.buffer (genuine zero-copy, not a slice).
//   4. Mutating the view's bytes is visible to subsequent at(i) reads
//      (proves the alias is live and not a copy).
//   5. Empty lists return a length-0 typed array (not undefined).
//   6. unsafe / cursor-only readers throw a clear error from view().

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { load as loadWasm } from "../dist/inlined.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";

const SCHEMA_TEXT = `@0xb1b07a55b8a40880;

struct Probe {
  u8s @0 :List(UInt8);
  i16s @1 :List(Int16);
  u32s @2 :List(UInt32);
  f32s @3 :List(Float32);
  f64s @4 :List(Float64);
  i64s @5 :List(Int64);
  chunks @6 :List(Data);
}
`;

const TMP_BASE    = join(tmpdir(), `capnwasm_list_view_${process.pid}`);
const SCHEMA_PATH = `${TMP_BASE}.capnp`;
const GEN_PATH    = `${TMP_BASE}.gen.mjs`;
const DTS_PATH    = GEN_PATH.replace(/\.mjs$/, ".d.ts");

// Dynamic schema mirroring the codegen schema. Used to build wire bytes;
// the codegen reader opens those bytes and exercises view().
const PROBE = defineSchema({
  u8s:  { kind: "listUint8",   slot: 0 },
  i16s: { kind: "listInt16",   slot: 1 },
  u32s: { kind: "listUint32",  slot: 2 },
  f32s: { kind: "listFloat32", slot: 3 },
  f64s: { kind: "listFloat64", slot: 4 },
  i64s: { kind: "listInt64",   slot: 5 },
  chunks: { kind: "listData", slot: 6 },
}, { dataWords: 0, ptrWords: 7 });

let mod;
let cpp;

before(async () => {
  writeFileSync(SCHEMA_PATH, SCHEMA_TEXT);
  const r = spawnSync(process.execPath, ["bin/capnwasm.mjs", "gen", SCHEMA_PATH, "-o", GEN_PATH]);
  if (r.status !== 0) {
    throw new Error(`capnwasm gen failed: ${r.stderr.toString()}`);
  }
  mod = await import(GEN_PATH);
  cpp = await loadWasm();
});

after(() => {
  for (const p of [SCHEMA_PATH, GEN_PATH, DTS_PATH]) {
    try { unlinkSync(p); } catch (_) {}
  }
});

function buildBytes(setters) {
  const b = buildDynamic(cpp, PROBE);
  for (const [k, v] of Object.entries(setters)) b.set(k, v);
  return b.finalize();
}

test("view(): Float64 list values match at(i), buffer aliases wasm memory", () => {
  const N = 1000;
  const values = new Array(N);
  for (let i = 0; i < N; i++) values[i] = Math.sin(i) * 1e6 + i;

  const bytes = buildBytes({ f64s: values });
  const r = mod.openProbe(cpp, bytes);
  const list = r.f64s;
  assert.equal(list.length, N);

  // Per-element correctness via at(i) — the reference implementation.
  for (let i = 0; i < N; i++) assert.equal(list.at(i), values[i]);

  // view() returns a Float64Array with the same values.
  const view = list.view();
  assert.ok(view instanceof Float64Array, "view() returns Float64Array for List(Float64)");
  assert.equal(view.length, N);
  for (let i = 0; i < N; i++) assert.equal(view[i], values[i]);

  // The crucial claim: view().buffer IS the wasm.memory.buffer. Not a
  // slice, not a copy. This is the property that lets a downstream
  // consumer (WebGPU writeBuffer, postMessage transfer, Math.max, etc.)
  // operate on wire bytes directly with no allocation.
  assert.equal(view.buffer, cpp.memory.buffer, "view aliases wasm.memory.buffer");

  r.dispose();
});

test("view(): UInt8/Int16/UInt32 lists return correct typed-array types", () => {
  const u8  = [0, 1, 127, 128, 255];
  const i16 = [-32768, -1, 0, 1, 32767];
  const u32 = [0, 1, 0xFFFFFFFF, 12345, 67890];

  const bytes = buildBytes({ u8s: u8, i16s: i16, u32s: u32 });
  const r = mod.openProbe(cpp, bytes);
  const v8  = r.u8s.view();
  const v16 = r.i16s.view();
  const v32 = r.u32s.view();
  assert.ok(v8  instanceof Uint8Array,  "List(UInt8).view() returns Uint8Array");
  assert.ok(v16 instanceof Int16Array,  "List(Int16).view() returns Int16Array");
  assert.ok(v32 instanceof Uint32Array, "List(UInt32).view() returns Uint32Array");
  assert.deepEqual(Array.from(v8),  u8);
  assert.deepEqual(Array.from(v16), i16);
  assert.deepEqual(Array.from(v32), u32);

  // All three views share the same backing buffer (wasm memory).
  assert.equal(v8.buffer,  cpp.memory.buffer);
  assert.equal(v16.buffer, cpp.memory.buffer);
  assert.equal(v32.buffer, cpp.memory.buffer);

  r.dispose();
});

test("view(): empty list returns a length-0 typed array, not undefined", () => {
  const bytes = buildBytes({ f64s: [] });
  const r = mod.openProbe(cpp, bytes);
  const v = r.f64s.view();
  assert.ok(v instanceof Float64Array);
  assert.equal(v.length, 0);
  r.dispose();
});

test("view(): Float32 round-trips with the precision floor of single-precision", () => {
  // Float32 has 24 bits of mantissa; values that survive Float32 (powers
  // of 2, representable fractions) round-trip with exact equality.
  const values = [0, 1, -1, 0.5, -0.5, 0.25, 16777216 /* 2^24 */, -1.5];
  const bytes = buildBytes({ f32s: values });
  const r = mod.openProbe(cpp, bytes);
  const v = r.f32s.view();
  assert.ok(v instanceof Float32Array);
  assert.equal(v.length, values.length);
  for (let i = 0; i < values.length; i++) assert.equal(v[i], values[i]);
  r.dispose();
});

test("view(): mutating the view's bytes is visible to subsequent at(i) reads (alias proof)", () => {
  // Strongest "zero-copy" assertion: write into the view, read back via
  // at(i). If view() returned a copy, at(i) would still see the old
  // value. If view() aliases wasm memory, at(i) sees our overwrite.
  const bytes = buildBytes({ u32s: [10, 20, 30, 40] });
  const r = mod.openProbe(cpp, bytes);
  const v = r.u32s.view();
  assert.equal(r.u32s.at(2), 30);
  v[2] = 999;
  assert.equal(r.u32s.at(2), 999, "at(i) sees the view's overwrite");
  r.dispose();
});

test("view(): at(i) and view() refresh cached typed arrays after memory.grow", () => {
  const values = [10, 20, 30, 40];
  const bytes = buildBytes({ u32s: values });
  const r = mod.openProbe(cpp, bytes);
  const list = r.u32s;
  const oldBuffer = cpp.memory.buffer;

  cpp.memory.grow(1);
  assert.notEqual(cpp.memory.buffer, oldBuffer, "memory.grow detaches the old buffer");

  assert.equal(list.at(2), 30);
  const v = list.view();
  assert.equal(v.buffer, cpp.memory.buffer, "view() returns the refreshed wasm buffer");
  assert.deepEqual(Array.from(v), values);
  r.dispose();
});

test("view(): Int64 list returns BigInt64Array with BigInt elements", () => {
  const i64 = [0n, -1n, 1n, -(2n ** 50n), 2n ** 50n];
  const bytes = buildBytes({ i64s: i64 });
  const r = mod.openProbe(cpp, bytes);
  const v = r.i64s.view();
  assert.ok(v instanceof BigInt64Array, "List(Int64).view() returns BigInt64Array");
  assert.equal(v.length, i64.length);
  for (let i = 0; i < i64.length; i++) assert.equal(v[i], i64[i]);
  r.dispose();
});

test("List(Data): at(i) reads pointer-list elements without cursor growth", () => {
  const chunks = [];
  for (let i = 0; i < 512; i++) chunks.push(new Uint8Array([i & 0xff, (i * 3) & 0xff]));
  const bytes = buildBytes({ chunks });
  const r = mod.openProbe(cpp, bytes);
  const list = r.chunks;
  assert.equal(list.length, chunks.length);
  for (let i = 0; i < list.length; i++) {
    assert.deepEqual(Array.from(list.at(i)), Array.from(chunks[i]));
  }
  r.dispose();
});

test("view(): unsafe / cursor-only readers throw a clear error", () => {
  // openProbeUnsafe doesn't carry _msgEnd, so view() can't safely return
  // an aliased typed array — the cursor path doesn't expose stable bytes
  // for the lifetime view() promises. Throwing surfaces the misuse
  // immediately instead of returning a view that races with the next
  // open call.
  const bytes = buildBytes({ f64s: [1, 2, 3] });
  const r = mod.openProbeUnsafe(cpp, bytes);
  assert.throws(() => r.f64s.view(), /view\(\)/, "unsafe reader's view() throws");
});

test("view(): can be passed to typed-array consumers (Math.max, reduce) at native speed", () => {
  // Smoke test: prove the view actually works as a typed-array consumer
  // would expect. This is the user-facing payoff of the API: the view
  // can be handed to any function that takes a Float64Array / Uint32Array
  // and Just Works.
  const N = 512;
  const values = new Array(N);
  for (let i = 0; i < N; i++) values[i] = i * 1.5;
  const bytes = buildBytes({ f64s: values });
  const r = mod.openProbe(cpp, bytes);
  const v = r.f64s.view();
  // Sum via reduce — V8 sees a Float64Array, picks its native sum loop.
  const sum = v.reduce((a, b) => a + b, 0);
  // Math.max with a typed-array spread.
  const max = Math.max(...v);
  // Reference values computed from the source array.
  const expectedSum = values.reduce((a, b) => a + b, 0);
  const expectedMax = Math.max(...values);
  assert.equal(sum, expectedSum);
  assert.equal(max, expectedMax);
  r.dispose();
});
