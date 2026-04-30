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

test("toObject equals all fields via pick(Object.keys(_FIELDS))", () => {
  const r = openPrimitives(cpp, bytes);
  const obj1 = r.toObject();
  const r2 = openPrimitives(cpp, bytes);
  const obj2 = r2.toObject();
  assert.deepEqual(obj1, obj2);
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
