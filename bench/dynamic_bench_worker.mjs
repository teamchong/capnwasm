// One-shot bench worker. Runs exactly one tagged test, prints
// `ns=<perCallNs> sink=<sink>` and exits. The orchestrator
// (dynamic_bench_isolated.mjs) spawns this in a fresh Node process per run.

import { load as loadWasm } from "../dist/inlined.mjs";
import { openPrimitives, PrimitivesBuilder } from "../js/conformance_schema.gen.mjs";
import { defineSchema, openDynamic, buildDynamic } from "../js/dynamic.mjs";

const TAG = process.argv[2];
if (!TAG) { console.error("usage: dynamic_bench_worker.mjs <tag>"); process.exit(1); }

const cpp = await loadWasm();

const Primitives = defineSchema({
  u8:    { kind: "uint8",   offset: 0   },
  i8:    { kind: "int8",    offset: 1   },
  u16:   { kind: "uint16",  offset: 2   },
  i16:   { kind: "int16",   offset: 16  },
  u32:   { kind: "uint32",  offset: 4   },
  i32:   { kind: "int32",   offset: 20  },
  u64:   { kind: "uint64",  offset: 8   },
  i64:   { kind: "int64",   offset: 24  },
  f32:   { kind: "float32", offset: 32  },
  f64:   { kind: "float64", offset: 40  },
  flag0: { kind: "bool",    bitOffset: 144 },
  text:  { kind: "text",    slot: 0     },
  data:  { kind: "data",    slot: 1     },
}, { dataWords: 6, ptrWords: 4 });

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

const helloBytes = new TextEncoder().encode("hello world");

// Sink reduces every read result into a single number that gets printed at
// the end. V8 can't eliminate field accesses whose results contribute to
// observable output, so this rules out dead-code elimination as a reason
// for one path looking faster.
let sink = 0;
function consume(v) {
  if (typeof v === "string") sink ^= v.length;
  else if (typeof v === "boolean") sink ^= v ? 1 : 0;
  else if (typeof v === "bigint") sink ^= Number(v & 0xffn);
  else if (v instanceof Uint8Array) sink ^= v.length;
  else if (Array.isArray(v)) sink ^= v.length;
  else if (typeof v === "number") sink ^= v | 0;
}

function bench(fn) {
  // Warm V8: stabilize hidden classes, trigger tier-up, settle ICs.
  for (let i = 0; i < 1000; i++) fn();
  const ITERS = 100_000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < ITERS; i++) fn();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0) / ITERS;
  process.stdout.write(`ns=${ns} sink=${sink}\n`);
}

const ALL_FIELDS = ["u8","i8","u16","i16","u32","i32","u64","i64","f32","f64","flag0","text","data"];

switch (TAG) {
  case "codegen-read-all":
    bench(() => {
      const r = openPrimitives(cpp, FIXTURE);
      consume(r.u8);  consume(r.i8);  consume(r.u16); consume(r.i16);
      consume(r.u32); consume(r.i32); consume(r.u64); consume(r.i64);
      consume(r.f32); consume(r.f64); consume(r.flag0);
      consume(r.text); consume(r.data);
    });
    break;

  case "dynamic-read-all":
    bench(() => {
      const r = openDynamic(cpp, Primitives, FIXTURE);
      for (const k of ALL_FIELDS) consume(r.get(k));
    });
    break;

  case "dynamic-pick-all":
    bench(() => {
      const r = openDynamic(cpp, Primitives, FIXTURE);
      const obj = r.pick(ALL_FIELDS);
      for (const k of ALL_FIELDS) consume(obj[k]);
    });
    break;

  case "codegen-draft-3":
    {
      // Hoist the projection callback so draft() can reuse the precompiled
      // plan from its WeakMap cache across iterations. A fresh inline
      // arrow per iteration would force re-planning on every call.
      const PROJECT_3 = (p) => ({ u32: p.u32, flag0: p.flag0, text: p.text });
      bench(() => {
        const r = openPrimitives(cpp, FIXTURE);
        const obj = r.draft(PROJECT_3);
        consume(obj.u32); consume(obj.flag0); consume(obj.text);
      });
    }
    break;

  case "dynamic-pick-3":
    bench(() => {
      const r = openDynamic(cpp, Primitives, FIXTURE);
      const obj = r.pick(["u32", "flag0", "text"]);
      consume(obj.u32); consume(obj.flag0); consume(obj.text);
    });
    break;

  case "codegen-build":
    bench(() => {
      const b = new PrimitivesBuilder(cpp);
      b.u8 = 42; b.i8 = -7; b.u16 = 1234; b.i16 = -1234;
      b.u32 = 99999; b.i32 = -99999; b.u64 = 12345n; b.i64 = -12345n;
      b.f32 = 1.5; b.f64 = 2.71828; b.flag0 = true;
      b.text = "hello world";
      b.data = helloBytes;
      sink ^= b.toBytes().length;
    });
    break;

  case "dynamic-build":
    bench(() => {
      const b = buildDynamic(cpp, Primitives);
      b.set("u8", 42); b.set("i8", -7); b.set("u16", 1234); b.set("i16", -1234);
      b.set("u32", 99999); b.set("i32", -99999); b.set("u64", 12345n); b.set("i64", -12345n);
      b.set("f32", 1.5); b.set("f64", 2.71828); b.set("flag0", true);
      b.set("text", "hello world");
      b.set("data", helloBytes);
      sink ^= b.finalize().length;
    });
    break;

  default:
    console.error(`unknown tag: ${TAG}`);
    process.exit(2);
}
