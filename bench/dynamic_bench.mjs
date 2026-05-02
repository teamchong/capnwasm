// Quantify the dispatch cost of capnwasm/dynamic vs codegen-emitted readers/builders.
//
// What we're measuring: same wire bytes, same wasm runtime, two access paths.
// The dynamic path looks up each field in a JS Map, dispatches by type
// string, and does the same wasm-boundary call codegen would. The codegen
// path has the field offsets baked in as integer literals at the call site.
// V8 JITs the codegen accessors aggressively because their hidden classes
// are stable; the dynamic path goes through one more layer of indirection.

import { load as loadWasm } from "../dist/inlined.mjs";
import { openPrimitives, PrimitivesBuilder } from "../js/conformance_schema.gen.mjs";
import { defineSchema, openDynamic, buildDynamic } from "../js/dynamic.mjs";

const cpp = await loadWasm();

// Schema mirroring conformance_schema.capnp's Primitives, with dimensions
// for the builder side. _DATA_WORDS=6, _PTR_WORDS=4 from PrimitivesBuilder.
const PrimitivesSchema = defineSchema({
  u8:        { kind: "uint8",   offset: 0   },
  i8:        { kind: "int8",    offset: 1   },
  u16:       { kind: "uint16",  offset: 2   },
  i16:       { kind: "int16",   offset: 16  },
  u32:       { kind: "uint32",  offset: 4   },
  i32:       { kind: "int32",   offset: 20  },
  u64:       { kind: "uint64",  offset: 8   },
  i64:       { kind: "int64",   offset: 24  },
  f32:       { kind: "float32", offset: 32  },
  f64:       { kind: "float64", offset: 40  },
  flag0:     { kind: "bool",    bitOffset: 144 },
  text:      { kind: "text",    slot: 0     },
  data:      { kind: "data",    slot: 1     },
}, { dataWords: 6, ptrWords: 4 });

// Build a fixture once so the read benches start from the same bytes.
const FIXTURE = (() => {
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
  return cpp._u8.slice(cpp._exports.cpp_out_ptr(), cpp._exports.cpp_out_ptr() + len);
})();

function timeIt(label, iters, fn) {
  // Warm V8.
  for (let i = 0; i < 200; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  const totalNs = Number(t1 - t0);
  const perCallNs = totalNs / iters;
  console.log(`  ${label.padEnd(48)}  ${perCallNs.toFixed(0).padStart(6)} ns/call  (${iters} iters)`);
  return perCallNs;
}

console.log("\n=== Read path (open + read all 13 fields) ===");
const N_READ = 50_000;
const codegenAll = timeIt("codegen openPrimitives + read 13 fields", N_READ, () => {
  const r = openPrimitives(cpp, FIXTURE);
  void r.u8; void r.i8; void r.u16; void r.i16;
  void r.u32; void r.i32; void r.u64; void r.i64;
  void r.f32; void r.f64; void r.flag0;
  void r.text; void r.data;
});
const dynamicAll = timeIt("dynamic openDynamic + read 13 fields", N_READ, () => {
  const r = openDynamic(cpp, PrimitivesSchema, FIXTURE);
  for (const k of ["u8","i8","u16","i16","u32","i32","u64","i64","f32","f64","flag0","text","data"]) {
    void r.get(k);
  }
});
const dynamicPick = timeIt("dynamic pick(13 names). Batched", N_READ, () => {
  const r = openDynamic(cpp, PrimitivesSchema, FIXTURE);
  r.pick(["u8","i8","u16","i16","u32","i32","u64","i64","f32","f64","flag0","text","data"]);
});

console.log("\n=== Read path (open + read 3 fields. Sparse access) ===");
const N_PICK = 100_000;
const codegen3 = timeIt("codegen pick(['u32','flag0','text'])", N_PICK, () => {
  const r = openPrimitives(cpp, FIXTURE);
  r.pick(["u32", "flag0", "text"]);
});
const dynamic3 = timeIt("dynamic pick(['u32','flag0','text'])", N_PICK, () => {
  const r = openDynamic(cpp, PrimitivesSchema, FIXTURE);
  r.pick(["u32", "flag0", "text"]);
});

console.log("\n=== Write path (build with 13 fields) ===");
const N_WRITE = 50_000;
const helloBytes = new TextEncoder().encode("hello world");
const codegenBuild = timeIt("codegen PrimitivesBuilder + 13 sets + finalize", N_WRITE, () => {
  const b = new PrimitivesBuilder(cpp);
  b.u8 = 42; b.i8 = -7; b.u16 = 1234; b.i16 = -1234;
  b.u32 = 99999; b.i32 = -99999; b.u64 = 12345n; b.i64 = -12345n;
  b.f32 = 1.5; b.f64 = 2.71828; b.flag0 = true;
  b.text = "hello world";
  b.data = helloBytes;
  b.toBytes();
});
const dynamicBuild = timeIt("buildDynamic + 13 sets + finalize", N_WRITE, () => {
  const b = buildDynamic(cpp, PrimitivesSchema);
  b.set("u8", 42); b.set("i8", -7); b.set("u16", 1234); b.set("i16", -1234);
  b.set("u32", 99999); b.set("i32", -99999); b.set("u64", 12345n); b.set("i64", -12345n);
  b.set("f32", 1.5); b.set("f64", 2.71828); b.set("flag0", true);
  b.set("text", "hello world");
  b.set("data", helloBytes);
  b.finalize();
});

console.log("\n=== Summary ===");
console.log(`  Read all 13 fields:    dynamic ${(dynamicAll / codegenAll).toFixed(2)}× codegen`);
console.log(`  Pick 3 fields:         dynamic ${(dynamic3 / codegen3).toFixed(2)}× codegen`);
console.log(`  Build with 13 fields:  dynamic ${(dynamicBuild / codegenBuild).toFixed(2)}× codegen`);
console.log(`  pick(13) (batched):    ${(dynamicPick / codegenAll).toFixed(2)}× codegen-all-individually`);
console.log(`                         (one wasm boundary call vs 13)`);
