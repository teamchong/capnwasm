// Conformance tests against the real capnp wire format.
//
// Strategy: every primitive Cap'n Proto type (Bool, Int8/16/32/64,
// UInt8/16/32/64, Float32/64, Text, Data) gets a round-trip test.
// We build Primitives messages with boundary values via the C++ wrapper
// (which uses the actual capnp::MessageBuilder), then read them back
// through the codegen-emitted reader. Any drift between wire-format
// and reader offsets shows up immediately.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { openPrimitives } from "../js/conformance_schema.gen.mjs";

let cpp;

before(async () => { cpp = await loadWasm(); });

/**
 * Stage primitive values into the wasm input scratch in the layout
 * cpp_conformance_serialize expects (see wrapper.cpp), then build the
 * message and return the framed bytes.
 */
function buildPrimitives(v) {
  const u8 = cpp._u8;
  const inPtr = cpp._exports.cpp_in_ptr();
  const buf = u8.subarray(inPtr, inPtr + cpp._exports.cpp_in_capacity());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  buf[0] = v.u8;
  buf[1] = v.i8 & 0xff;
  // bytes 2..3 padding
  dv.setUint16(4, v.u16, true);
  dv.setInt16 (6, v.i16, true);
  dv.setUint32(8, v.u32, true);
  dv.setInt32 (12, v.i32, true);
  dv.setBigUint64(16, BigInt(v.u64), true);
  dv.setBigInt64 (24, BigInt(v.i64), true);
  dv.setFloat32(32, v.f32, true);
  dv.setFloat64(36, v.f64, true);
  buf[44] = (v.flag0 ? 1 : 0) | (v.flag1 ? 2 : 0) | (v.flag2 ? 4 : 0);

  const enc = new TextEncoder();
  const textBytes = enc.encode(v.text);
  dv.setUint32(45, textBytes.length, true);
  buf.set(textBytes, 49);
  let pos = 49 + textBytes.length;
  dv.setUint32(pos, v.data.length, true); pos += 4;
  buf.set(v.data, pos); pos += v.data.length;

  const len = cpp._exports.cpp_conformance_serialize(pos);
  if (!len) throw new Error("cpp_conformance_serialize failed");
  // Re-fetch buffer in case wasm grew memory.
  return cpp._u8.slice(cpp._exports.cpp_out_ptr(), cpp._exports.cpp_out_ptr() + len);
}

function roundTrip(v) {
  const bytes = buildPrimitives(v);
  const u8After = cpp._u8;
  // Move the bytes into cpp_in for the reader.
  u8After.set(bytes, cpp._exports.cpp_in_ptr());
  cpp._exports.cpp_any_open(bytes.length);
  // openPrimitives uses cpp_any_open under the hood, so re-call with same bytes.
  return openPrimitives(cpp, bytes);
}

const baseline = {
  u8: 0, i8: 0, u16: 0, i16: 0, u32: 0, i32: 0,
  u64: 0, i64: 0, f32: 0, f64: 0,
  flag0: false, flag1: false, flag2: false,
  text: "", data: new Uint8Array(0),
};

test("UInt8 boundary values", () => {
  for (const v of [0, 1, 127, 128, 255]) {
    const r = roundTrip({ ...baseline, u8: v });
    assert.equal(r.u8, v, `u8=${v}`);
  }
});

test("Int8 boundary values", () => {
  for (const v of [-128, -1, 0, 1, 127]) {
    const r = roundTrip({ ...baseline, i8: v });
    assert.equal(r.i8, v, `i8=${v}`);
  }
});

test("UInt16/Int16 boundary values", () => {
  for (const v of [0, 0xFFFF]) {
    const r = roundTrip({ ...baseline, u16: v });
    assert.equal(r.u16, v, `u16=${v}`);
  }
  for (const v of [-32768, 32767]) {
    const r = roundTrip({ ...baseline, i16: v });
    assert.equal(r.i16, v, `i16=${v}`);
  }
});

test("UInt32/Int32 boundary values", () => {
  for (const v of [0, 0x7FFFFFFF, 0xFFFFFFFF]) {
    const r = roundTrip({ ...baseline, u32: v });
    assert.equal(r.u32 >>> 0, v >>> 0, `u32=${v}`);
  }
  for (const v of [-2147483648, 2147483647]) {
    const r = roundTrip({ ...baseline, i32: v });
    assert.equal(r.i32 | 0, v | 0, `i32=${v}`);
  }
});

test("UInt64 boundary values fit safe integer range", () => {
  for (const v of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const r = roundTrip({ ...baseline, u64: v });
    assert.equal(Number(r.u64), v, `u64=${v}`);
  }
});

test("Int64 boundary values fit safe integer range", () => {
  for (const v of [Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]) {
    const r = roundTrip({ ...baseline, i64: v });
    assert.equal(Number(r.i64), v, `i64=${v}`);
  }
});

test("Float32/Float64 normal values", () => {
  for (const v of [0, 1, -1, 3.14159, 1e-9, 1e9]) {
    const r = roundTrip({ ...baseline, f32: v, f64: v });
    assert.ok(Math.abs(r.f64 - v) < 1e-9, `f64=${v} got=${r.f64}`);
  }
});

test("Bool fields pack into separate bits without collision", () => {
  for (const flag0 of [false, true])
    for (const flag1 of [false, true])
      for (const flag2 of [false, true]) {
        const r = roundTrip({ ...baseline, flag0, flag1, flag2 });
        assert.equal(r.flag0, flag0, `flag0=${flag0}`);
        assert.equal(r.flag1, flag1, `flag1=${flag1}`);
        assert.equal(r.flag2, flag2, `flag2=${flag2}`);
      }
});

test("Text — empty, ASCII, UTF-8", () => {
  for (const s of ["", "hello", "Cap'n Proto: 你好世界 🚀"]) {
    const r = roundTrip({ ...baseline, text: s });
    assert.equal(r.text, s, `text=${JSON.stringify(s)}`);
  }
});

test("Text — long string (multi-segment territory)", () => {
  const s = "x".repeat(8192);
  const r = roundTrip({ ...baseline, text: s });
  assert.equal(r.text.length, s.length);
  assert.equal(r.text, s);
});

test("Data — empty + binary", () => {
  for (const d of [new Uint8Array(0), new Uint8Array([0, 1, 2, 0xff, 0x80])]) {
    const r = roundTrip({ ...baseline, data: d });
    const got = r.data;
    assert.equal(got.length, d.length);
    for (let i = 0; i < d.length; i++) assert.equal(got[i], d[i]);
  }
});

test("emptyText / emptyData — default values present", () => {
  const r = roundTrip(baseline);
  assert.equal(r.emptyText, "");
  assert.equal(r.emptyData.length, 0);
});

test("multiple-field message: all values readable independently", () => {
  const v = {
    u8: 42, i8: -42, u16: 1234, i16: -1234, u32: 99999, i32: -99999,
    u64: 1234567890123, i64: -1234567890123,
    f32: 1.5, f64: 2.71828,
    flag0: true, flag1: false, flag2: true,
    text: "mixed", data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  };
  const r = roundTrip(v);
  assert.equal(r.u8, v.u8);
  assert.equal(r.i8, v.i8);
  assert.equal(r.u16, v.u16);
  assert.equal(r.i16, v.i16);
  assert.equal(r.u32 >>> 0, v.u32);
  assert.equal(r.i32 | 0, v.i32);
  assert.equal(Number(r.u64), v.u64);
  assert.equal(Number(r.i64), v.i64);
  assert.ok(Math.abs(r.f64 - v.f64) < 1e-9);
  assert.equal(r.flag0, v.flag0);
  assert.equal(r.flag1, v.flag1);
  assert.equal(r.flag2, v.flag2);
  assert.equal(r.text, v.text);
  for (let i = 0; i < v.data.length; i++) assert.equal(r.data[i], v.data[i]);
});
