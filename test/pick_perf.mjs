// Microbench: pick() in a hot loop with the cached request bytes vs
// individual property reads. Same access pattern, run many iterations.

import { load as loadWasm } from "../dist/inlined.mjs";
import { openPrimitives } from "../js/conformance_schema.gen.mjs";

const cpp = await loadWasm();

// Build a test message once.
const u8 = cpp._u8;
const inPtr = cpp._exports.cpp_in_ptr();
const buf = u8.subarray(inPtr, inPtr + cpp._exports.cpp_in_capacity());
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
buf[0] = 42; buf[1] = (-7) & 0xff;
dv.setUint16(4, 1234, true); dv.setInt16(6, -1234, true);
dv.setUint32(8, 99999, true); dv.setInt32(12, -99999, true);
dv.setBigUint64(16, 12345n, true); dv.setBigInt64(24, -12345n, true);
dv.setFloat32(32, 1.5, true); dv.setFloat64(36, 2.71828, true);
buf[44] = 0b101;
const enc = new TextEncoder();
const t = enc.encode("hello world");
dv.setUint32(45, t.length, true);
buf.set(t, 49);
let pos = 49 + t.length;
dv.setUint32(pos, 0, true); pos += 4;
const len = cpp._exports.cpp_conformance_serialize(pos);
const bytes = cpp._u8.slice(cpp._exports.cpp_out_ptr(), cpp._exports.cpp_out_ptr() + len);

function timed(label, fn, budgetMs = 200) {
  // warm-up
  const warmEnd = performance.now() + 50;
  while (performance.now() < warmEnd) fn();
  let iters = 0;
  const start = performance.now();
  const deadline = start + budgetMs;
  while (performance.now() < deadline) { fn(); fn(); fn(); fn(); fn(); fn(); fn(); fn(); iters += 8; }
  const elapsed = performance.now() - start;
  const nsPerOp = (elapsed * 1e6) / iters;
  console.log(`  ${label.padEnd(38)} ${nsPerOp.toFixed(0).padStart(6)} ns/op   (${iters.toLocaleString()} iters)`);
}

const NAMES = ["u8", "i8", "u16", "u32", "i64", "text", "flag0"];

console.log("\nPicking 7 fields × 10000 messages (simulated hot loop):");
timed("per-field getters (7 wasm calls)", () => {
  const r = openPrimitives(cpp, bytes);
  return r.u8 + r.i8 + r.u16 + r.u32 + Number(r.i64) + r.text.length + (r.flag0 ? 1 : 0);
});
timed("pick(NAMES) (cached request, 1 wasm call)", () => {
  const r = openPrimitives(cpp, bytes);
  const o = r.pick(NAMES);
  return o.u8 + o.i8 + o.u16 + o.u32 + Number(o.i64) + o.text.length + (o.flag0 ? 1 : 0);
});
timed("toObject() (all 17 fields, 1 wasm call)", () => {
  const r = openPrimitives(cpp, bytes);
  const o = r.toObject();
  return o.u8 + o.i8 + o.u16 + o.u32 + Number(o.i64) + o.text.length + (o.flag0 ? 1 : 0);
});
