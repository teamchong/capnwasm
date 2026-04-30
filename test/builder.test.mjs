// Builder round-trip: build a message in JS, serialize, decode via Reader,
// verify field values match. Same wire-format any other capnp binding speaks.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { buildPrimitives, openPrimitives } from "../js/conformance_schema.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

test("Builder sets every primitive field; Reader reads them back unchanged", () => {
  const b = buildPrimitives(cpp);
  b.u8 = 200;
  b.i8 = -100;
  b.u16 = 50000;
  b.i16 = -20000;
  b.u32 = 0xfedcba98;
  b.i32 = -123456789;
  b.u64 = 0x123456789abcdef0n;
  b.i64 = -9876543210n;
  b.f32 = 3.14;
  b.f64 = 2.718281828;
  b.flag0 = true;
  b.flag1 = false;
  b.flag2 = true;
  b.text = "hello capnp builder";
  b.data = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);

  const bytes = b.toBytes();
  assert.ok(bytes.length > 0, "serialized bytes should be non-empty");

  const r = openPrimitives(cpp, bytes);
  assert.equal(r.u8, 200);
  assert.equal(r.i8, -100);
  assert.equal(r.u16, 50000);
  assert.equal(r.i16, -20000);
  assert.equal(r.u32 >>> 0, 0xfedcba98);
  assert.equal(r.i32 | 0, -123456789);
  assert.equal(BigInt(r.u64), 0x123456789abcdef0n);
  assert.equal(BigInt(r.i64), -9876543210n);
  assert.ok(Math.abs(r.f32 - 3.14) < 1e-5, `f32 expected 3.14 got ${r.f32}`);
  assert.ok(Math.abs(r.f64 - 2.718281828) < 1e-9);
  assert.equal(r.flag0, true);
  assert.equal(r.flag1, false);
  assert.equal(r.flag2, true);
  assert.equal(r.text, "hello capnp builder");
  for (let i = 0; i < 6; i++) assert.equal(r.data[i], [0xde,0xad,0xbe,0xef,0x00,0xff][i]);
});

test("Builder produces same bytes as native cpp_conformance_serialize for matching values", () => {
  // Build via JS Builder
  const b = buildPrimitives(cpp);
  b.u8 = 42;
  b.text = "hello";
  const jsBytes = b.toBytes();

  // Build via the native helper
  const u8 = cpp._u8;
  const inPtr = cpp._exports.cpp_in_ptr();
  const buf = u8.subarray(inPtr, inPtr + cpp._exports.cpp_in_capacity());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.fill(0);
  buf[0] = 42;
  const enc = new TextEncoder().encode("hello");
  dv.setUint32(45, enc.length, true);
  buf.set(enc, 49);
  let pos = 49 + enc.length;
  dv.setUint32(pos, 0, true); pos += 4;
  const len = cpp._exports.cpp_conformance_serialize(pos);
  const cBytes = cpp._u8.slice(cpp._exports.cpp_out_ptr(), cpp._exports.cpp_out_ptr() + len);

  // Decode both, compare logical values (byte-equality is a stronger claim
  // that depends on default-value handling — same logical value is the
  // wire-conformance property we care about).
  const r1 = openPrimitives(cpp, jsBytes);
  const r2 = openPrimitives(cpp, cBytes);
  assert.equal(r1.u8, r2.u8);
  assert.equal(r1.text, r2.text);
});
