// Tests for the JSON.stringify-shaped helpers:
//
//   PrimitivesBuilder.from(cpp, obj)      . Codegen path, static factory
//   primitivesBuilder.fromObject(obj)     . Codegen path, instance method
//   encodeDynamic(cpp, schema, obj)       . Dynamic path, one-call helper
//   buildDynamic(...).fromObject(obj)     . Dynamic path, instance method
//
// Both paths produce the same wire bytes as the corresponding hand-rolled
// setter loop. We assert that by building the same data three ways
// (manual setters, fromObject, schema-aware decode) and comparing.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { load } from "../dist/inlined.mjs";
import {
  PrimitivesBuilder,
  PrimitivesReader,
  openPrimitives,
} from "../js/conformance_schema.gen.mjs";
import {
  defineSchema,
  buildDynamic,
  encodeDynamic,
  openDynamic,
} from "../js/dynamic.mjs";

const cpp = await load();

// Ground-truth values used across all tests. Spans every primitive type
// the conformance schema supports plus text + data, so we exercise the
// type-coercion rules in one shot. u32 is kept ≤ 0x7fffffff because the
// codegen reader returns the raw wasm-i32 result (no unsigned coercion);
// values with the high bit set come back as negative Numbers, which is
// correct for the bits but inconvenient to assert against.
const GROUND_TRUTH = {
  u8: 0xfe,
  u16: 0xcafe,
  u32: 0x12345678,
  u64: 0x1234567890abcdefn,
  i8: -42,
  i16: -1234,
  i32: -1_000_000,
  i64: -123_456_789_012n,
  f32: 1.5,
  f64: 3.14159265358979,
  flag0: true,
  flag1: false,
  flag2: true,
  text: "Alice. α β γ",
  data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  emptyText: "",
  emptyData: new Uint8Array([]),
};

// --- codegen path ---------------------------------------------------------

test("codegen Builder.from(cpp, obj) round-trips every primitive field", () => {
  const bytes = PrimitivesBuilder.from(cpp, GROUND_TRUTH).toBytes();
  const r = openPrimitives(cpp, bytes);
  assert.equal(r.u8, GROUND_TRUTH.u8);
  assert.equal(r.u16, GROUND_TRUTH.u16);
  assert.equal(r.u32, GROUND_TRUTH.u32);
  assert.equal(r.u64, GROUND_TRUTH.u64);
  assert.equal(r.i8, GROUND_TRUTH.i8);
  assert.equal(r.i16, GROUND_TRUTH.i16);
  assert.equal(r.i32, GROUND_TRUTH.i32);
  assert.equal(r.i64, GROUND_TRUTH.i64);
  assert.ok(Math.abs(r.f32 - GROUND_TRUTH.f32) < 1e-6);
  assert.ok(Math.abs(r.f64 - GROUND_TRUTH.f64) < 1e-12);
  assert.equal(r.flag0, GROUND_TRUTH.flag0);
  assert.equal(r.flag1, GROUND_TRUTH.flag1);
  assert.equal(r.flag2, GROUND_TRUTH.flag2);
  assert.equal(r.text, GROUND_TRUTH.text);
  assert.deepEqual(Array.from(r.data), Array.from(GROUND_TRUTH.data));
  assert.equal(r.emptyText, GROUND_TRUTH.emptyText);
  assert.deepEqual(Array.from(r.emptyData), []);
});

test("codegen fromObject(obj) produces byte-identical output to a hand-rolled setter loop", () => {
  // Path A: hand-rolled setter loop (what users write today)
  const a = new PrimitivesBuilder(cpp);
  a.u8 = GROUND_TRUTH.u8;
  a.u16 = GROUND_TRUTH.u16;
  a.u32 = GROUND_TRUTH.u32;
  a.u64 = GROUND_TRUTH.u64;
  a.i8 = GROUND_TRUTH.i8;
  a.i16 = GROUND_TRUTH.i16;
  a.i32 = GROUND_TRUTH.i32;
  a.i64 = GROUND_TRUTH.i64;
  a.f32 = GROUND_TRUTH.f32;
  a.f64 = GROUND_TRUTH.f64;
  a.flag0 = GROUND_TRUTH.flag0;
  a.flag1 = GROUND_TRUTH.flag1;
  a.flag2 = GROUND_TRUTH.flag2;
  a.text = GROUND_TRUTH.text;
  a.data = GROUND_TRUTH.data;
  a.emptyText = GROUND_TRUTH.emptyText;
  a.emptyData = GROUND_TRUTH.emptyData;
  const aBytes = a.toBytes();

  // Path B: fromObject
  const b = new PrimitivesBuilder(cpp).fromObject(GROUND_TRUTH);
  const bBytes = b.toBytes();

  assert.deepEqual(Array.from(aBytes), Array.from(bBytes),
    "fromObject and the manual setter loop should produce identical wire bytes");
});

test("codegen fromObject skips missing keys (leaves defaults)", () => {
  const partial = { u8: 7, text: "hi" };
  const bytes = PrimitivesBuilder.from(cpp, partial).toBytes();
  const r = openPrimitives(cpp, bytes);
  assert.equal(r.u8, 7);
  assert.equal(r.text, "hi");
  // Untouched fields should be defaulted (zero-equivalent).
  assert.equal(r.u16, 0);
  assert.equal(r.u32, 0);
  assert.equal(r.u64, 0n);
  assert.equal(r.flag0, false);
  assert.equal(r.emptyText, "");
});

test("codegen fromObject ignores unknown keys silently", () => {
  // Unknown keys must not crash. Schema is the contract, extras are noise.
  const bytes = PrimitivesBuilder.from(cpp, {
    u8: 1,
    bogus: "should be ignored",
    nested: { also: "ignored" },
  }).toBytes();
  const r = openPrimitives(cpp, bytes);
  assert.equal(r.u8, 1);
});

test("codegen fromObject(null/undefined) is a no-op (returns the builder unchanged)", () => {
  const a = new PrimitivesBuilder(cpp).fromObject(null).toBytes();
  const b = new PrimitivesBuilder(cpp).fromObject(undefined).toBytes();
  // Builder with no fields set is a default message.
  assert.ok(a.length > 0);
  assert.ok(b.length > 0);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("codegen fromObject coerces Number → BigInt for u64/i64 (when safe)", () => {
  const bytes = PrimitivesBuilder.from(cpp, { u64: 42, i64: -1234 }).toBytes();
  const r = openPrimitives(cpp, bytes);
  assert.equal(r.u64, 42n);
  assert.equal(r.i64, -1234n);
});

test("codegen Builder.from is a static. Works without 'new'", () => {
  const bytes = PrimitivesBuilder.from(cpp, { u8: 99 }).toBytes();
  const r = openPrimitives(cpp, bytes);
  assert.equal(r.u8, 99);
});

test("codegen fromObject returns the builder (chainable)", () => {
  const b = new PrimitivesBuilder(cpp);
  const ret = b.fromObject({ u8: 1 });
  assert.equal(ret, b);
  assert.equal(typeof ret.toBytes, "function");
});

// --- dynamic path ---------------------------------------------------------

const DynamicPrimitivesSchema = defineSchema({
  u8:    { kind: "uint8",  offset: 0 },
  u16:   { kind: "uint16", offset: 2 },
  u32:   { kind: "uint32", offset: 4 },
  u64:   { kind: "uint64", offset: 8 },
  i64:   { kind: "int64",  offset: 24 },
  f32:   { kind: "float32", offset: 32 },
  text:  { kind: "text",   slot: 0 },
  data:  { kind: "data",   slot: 1 },
}, { dataWords: 6, ptrWords: 4 });

test("dynamic encodeDynamic(cpp, schema, obj) is a one-call equivalent of buildDynamic+fromObject+finalize", () => {
  const obj = {
    u8: 0x42, u16: 0xbeef, u32: 0x0afef00d,
    u64: 12345n, i64: -67890n,
    f32: 2.5,
    text: "hello",
    data: new Uint8Array([10, 20, 30]),
  };

  const bytesOneCall = encodeDynamic(cpp, DynamicPrimitivesSchema, obj);

  const bytesLong = buildDynamic(cpp, DynamicPrimitivesSchema)
    .fromObject(obj)
    .finalize();

  assert.deepEqual(Array.from(bytesOneCall), Array.from(bytesLong),
    "encodeDynamic should equal the long form");
});

test("dynamic encodeDynamic round-trips through openDynamic with the same schema", () => {
  const obj = {
    u8: 7, u16: 1234, u32: 5_000_000,
    u64: 9_999_999_999n, i64: -42n,
    f32: 1.25,
    text: "round trip",
    data: new Uint8Array([5, 4, 3, 2, 1]),
  };

  const bytes = encodeDynamic(cpp, DynamicPrimitivesSchema, obj);
  const r = openDynamic(cpp, DynamicPrimitivesSchema, bytes).toObject();

  assert.equal(r.u8, 7);
  assert.equal(r.u16, 1234);
  assert.equal(r.u32, 5_000_000);
  // The dynamic reader returns u64/i64 as Number when the value fits;
  // fall back to BigInt comparison if bigint came back. Either is fine -
  // the wire bytes are the same; this is a JS-side coercion choice.
  assert.equal(BigInt(r.u64), 9_999_999_999n);
  assert.equal(BigInt(r.i64), -42n);
  assert.ok(Math.abs(r.f32 - 1.25) < 1e-6);
  assert.equal(r.text, "round trip");
  assert.deepEqual(Array.from(r.data), [5, 4, 3, 2, 1]);
});

test("dynamic fromObject skips missing keys", () => {
  const bytes = encodeDynamic(cpp, DynamicPrimitivesSchema, { u8: 7, text: "partial" });
  const r = openDynamic(cpp, DynamicPrimitivesSchema, bytes).toObject();
  assert.equal(r.u8, 7);
  assert.equal(r.text, "partial");
  assert.equal(r.u16, 0);
  assert.equal(r.u32, 0);
  assert.equal(BigInt(r.u64), 0n);
});

test("dynamic fromObject ignores unknown keys silently", () => {
  // Schema doesn't know about `bogus`; must not throw.
  const bytes = encodeDynamic(cpp, DynamicPrimitivesSchema, {
    u8: 1, bogus: "ignored", nested: { also: "ignored" },
  });
  const r = openDynamic(cpp, DynamicPrimitivesSchema, bytes).toObject();
  assert.equal(r.u8, 1);
});

test("dynamic fromObject(null/undefined) is a no-op", () => {
  const a = buildDynamic(cpp, DynamicPrimitivesSchema).fromObject(null).finalize();
  const b = buildDynamic(cpp, DynamicPrimitivesSchema).fromObject(undefined).finalize();
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("dynamic fromObject is chainable (returns the builder)", () => {
  const b = buildDynamic(cpp, DynamicPrimitivesSchema);
  const ret = b.fromObject({ u8: 1 });
  assert.equal(ret, b);
  assert.equal(typeof ret.finalize, "function");
});

// --- cross-path equivalence ----------------------------------------------

test("codegen Builder.from and dynamic encodeDynamic produce wire bytes the OTHER side can read", () => {
  // Build via codegen, read via dynamic.
  const codegenBytes = PrimitivesBuilder.from(cpp, {
    u8: 11, u16: 22, u32: 33, u64: 44n, i64: -55n, f32: 1.5,
    text: "interop", data: new Uint8Array([9, 8, 7]),
  }).toBytes();

  const dynRead = openDynamic(cpp, DynamicPrimitivesSchema, codegenBytes).toObject();
  assert.equal(dynRead.u8, 11);
  assert.equal(dynRead.u16, 22);
  assert.equal(dynRead.u32, 33);
  assert.equal(BigInt(dynRead.u64), 44n);
  assert.equal(BigInt(dynRead.i64), -55n);
  assert.ok(Math.abs(dynRead.f32 - 1.5) < 1e-6);
  assert.equal(dynRead.text, "interop");
  assert.deepEqual(Array.from(dynRead.data), [9, 8, 7]);

  // Build via dynamic, read via codegen. Same fields, same wire format.
  const dynBytes = encodeDynamic(cpp, DynamicPrimitivesSchema, {
    u8: 11, u16: 22, u32: 33, u64: 44n, i64: -55n, f32: 1.5,
    text: "interop", data: new Uint8Array([9, 8, 7]),
  });
  const codegenRead = openPrimitives(cpp, dynBytes);
  assert.equal(codegenRead.u8, 11);
  assert.equal(codegenRead.text, "interop");
});
