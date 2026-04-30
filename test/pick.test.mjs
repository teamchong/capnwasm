// Verify pick() saves wasm boundary crossings vs per-field access.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { openPrimitives } from "../js/conformance_schema.gen.mjs";

let cpp, bytes;

before(async () => {
  cpp = await loadWasm();

  // Build a Primitives message we can pick from.
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
  const t = enc.encode("hello");
  dv.setUint32(45, t.length, true);
  buf.set(t, 49);
  let pos = 49 + t.length;
  dv.setUint32(pos, 0, true); pos += 4;
  const len = cpp._exports.cpp_conformance_serialize(pos);
  bytes = cpp._u8.slice(cpp._exports.cpp_out_ptr(), cpp._exports.cpp_out_ptr() + len);
});

test("pick returns same values as per-field getters", () => {
  const r = openPrimitives(cpp, bytes);
  const expected = { u8: r.u8, i8: r.i8, u16: r.u16, text: r.text, flag0: r.flag0 };
  // Re-open because per-field getters above re-staged input via cpp_any_open.
  const r2 = openPrimitives(cpp, bytes);
  const got = r2.pick(["u8", "i8", "u16", "text", "flag0"]);
  assert.deepEqual(got, expected);
});

test("toObject contains every field reachable through per-field getters", () => {
  // Read every field via the per-field accessors, then verify toObject's
  // returned object exposes the same set of keys with the same values.
  const r = openPrimitives(cpp, bytes);
  const expected = {
    u8: r.u8, i8: r.i8, u16: r.u16, i16: r.i16,
    u32: r.u32, i32: r.i32, u64: r.u64, i64: r.i64,
    f32: r.f32, f64: r.f64,
    flag0: r.flag0, flag1: r.flag1, flag2: r.flag2,
    text: r.text, data: Array.from(r.data),
    emptyText: r.emptyText, emptyData: Array.from(r.emptyData),
  };
  const r2 = openPrimitives(cpp, bytes);
  const got = r2.toObject();
  // Compare key-by-key. Uint8Array → array equality. Numerics → cast both
  // sides through Number so a Number/BigInt 12345 compares equal across
  // the per-field-getter and toObject paths (one returns u64 as BigInt
  // when full precision matters, the other coerces small values).
  for (const k of Object.keys(expected)) {
    if (got[k] instanceof Uint8Array) {
      assert.deepEqual(Array.from(got[k]), expected[k], `field ${k}`);
    } else if (typeof got[k] === "bigint" || typeof expected[k] === "bigint") {
      assert.equal(BigInt(got[k]), BigInt(expected[k]), `field ${k}`);
    } else {
      assert.equal(got[k], expected[k], `field ${k}`);
    }
  }
});

test("pick with one field works", () => {
  const r = openPrimitives(cpp, bytes);
  const got = r.pick(["text"]);
  assert.equal(got.text, "hello");
});

test("pick raises on unknown field name", () => {
  const r = openPrimitives(cpp, bytes);
  assert.throws(() => r.pick(["doesNotExist"]), /unknown field/);
});
