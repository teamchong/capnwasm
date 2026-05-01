// Tests for the dynamic-builder list + nested-struct write paths.
// Round-trips through encodeDynamic → openDynamic to verify wire bytes
// are valid Cap'n Proto.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { defineSchema, encodeDynamic, openDynamic } from "../js/dynamic.mjs";

const cpp = await loadWasm();

/* -------------------- Lists of primitives -------------------- */

test("dynamic builder: listUint32 round-trips through openDynamic", () => {
  const Schema = defineSchema({
    nums: { kind: "listUint32", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });

  const bytes = encodeDynamic(cpp, Schema, { nums: [1, 2, 3, 1000000, 4294967290] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("nums"), [1, 2, 3, 1000000, 4294967290]);
});

test("dynamic builder: listInt32 handles negatives", () => {
  const Schema = defineSchema({
    n: { kind: "listInt32", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { n: [-1, -2147483648, 0, 2147483647] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("n"), [-1, -2147483648, 0, 2147483647]);
});

test("dynamic builder: listUint8 round-trips", () => {
  const Schema = defineSchema({
    b: { kind: "listUint8", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { b: [0, 127, 200, 255] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("b"), [0, 127, 200, 255]);
});

test("dynamic builder: listUint64 accepts mix of bigint and number, returns numbers when safe", () => {
  const Schema = defineSchema({
    v: { kind: "listUint64", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { v: [1n, 2, 9007199254740992n, 999n] });
  const r = openDynamic(cpp, Schema, bytes);
  const got = r.get("v");
  assert.equal(got.length, 4);
  assert.equal(BigInt(got[0]), 1n);
  assert.equal(BigInt(got[1]), 2n);
  assert.equal(BigInt(got[2]), 9007199254740992n);
  assert.equal(BigInt(got[3]), 999n);
});

test("dynamic builder: listFloat64 round-trips with bit-equality", () => {
  const Schema = defineSchema({
    f: { kind: "listFloat64", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { f: [0.0, 3.14, -1.5e10, Infinity] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("f"), [0.0, 3.14, -1.5e10, Infinity]);
});

test("dynamic builder: listBool packs as bits and round-trips", () => {
  const Schema = defineSchema({
    b: { kind: "listBool", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { b: [true, false, true, true, false, true, false, false, true] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("b"), [true, false, true, true, false, true, false, false, true]);
});

test("dynamic builder: listText round-trips", () => {
  const Schema = defineSchema({
    s: { kind: "listText", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { s: ["alpha", "beta", "γ-emoji-😀"] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("s"), ["alpha", "beta", "γ-emoji-😀"]);
});

test("dynamic builder: listData round-trips raw bytes", () => {
  const Schema = defineSchema({
    d: { kind: "listData", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const a = new Uint8Array([0, 1, 2, 255]);
  const b = new Uint8Array([10, 20, 30]);
  const bytes = encodeDynamic(cpp, Schema, { d: [a, b] });
  const r = openDynamic(cpp, Schema, bytes);
  const got = r.get("d");
  assert.equal(got.length, 2);
  assert.deepEqual(Array.from(got[0]), [0, 1, 2, 255]);
  assert.deepEqual(Array.from(got[1]), [10, 20, 30]);
});

test("dynamic builder: empty list works", () => {
  const Schema = defineSchema({
    n: { kind: "listUint32", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = encodeDynamic(cpp, Schema, { n: [] });
  const r = openDynamic(cpp, Schema, bytes);
  assert.deepEqual(r.get("n"), []);
});

/* -------------------- Nested struct -------------------- */

test("dynamic builder: nested struct round-trips through reader", () => {
  const Inner = defineSchema({
    name:  { kind: "text",   slot: 0 },
    score: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });

  const Outer = defineSchema({
    title: { kind: "text",   slot: 0 },
    inner: { kind: "struct", slot: 1, schema: Inner },
  }, { dataWords: 0, ptrWords: 2 });

  const bytes = encodeDynamic(cpp, Outer, {
    title: "outer",
    inner: { name: "alice", score: 42 },
  });
  const r = openDynamic(cpp, Outer, bytes);
  assert.equal(r.get("title"), "outer");
  assert.deepEqual(r.get("inner"), { name: "alice", score: 42 });
});

test("dynamic builder: nested struct with all primitive types", () => {
  const Inner = defineSchema({
    u8:  { kind: "uint8",   offset: 0 },
    u32: { kind: "uint32",  offset: 4 },
    b:   { kind: "bool",    bitOffset: 64 },
    s:   { kind: "text",    slot: 0 },
    d:   { kind: "data",    slot: 1 },
  }, { dataWords: 2, ptrWords: 2 });

  const Outer = defineSchema({
    inner: { kind: "struct", slot: 0, schema: Inner },
  }, { dataWords: 0, ptrWords: 1 });

  const bytes = encodeDynamic(cpp, Outer, {
    inner: { u8: 200, u32: 0x12345678, b: true, s: "hello", d: new Uint8Array([1, 2, 3]) },
  });
  const r = openDynamic(cpp, Outer, bytes);
  const inner = r.get("inner");
  assert.equal(inner.u8, 200);
  assert.equal(inner.u32 >>> 0, 0x12345678);
  assert.equal(inner.b, true);
  assert.equal(inner.s, "hello");
  assert.deepEqual(Array.from(inner.d), [1, 2, 3]);
});

test("dynamic builder: nested struct with null value leaves the slot at default", () => {
  const Inner = defineSchema({
    name: { kind: "text", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const Outer = defineSchema({
    a:     { kind: "text",   slot: 0 },
    inner: { kind: "struct", slot: 1, schema: Inner },
  }, { dataWords: 0, ptrWords: 2 });

  const bytes = encodeDynamic(cpp, Outer, { a: "set", inner: null });
  const r = openDynamic(cpp, Outer, bytes);
  assert.equal(r.get("a"), "set");
  // Null pointer → reader returns the default-initialized object.
  assert.deepEqual(r.get("inner"), { name: "" });
});

test("dynamic builder: deeply nested structs (3 levels)", () => {
  const L3 = defineSchema({ v: { kind: "uint32", offset: 0 } }, { dataWords: 1, ptrWords: 0 });
  const L2 = defineSchema({ inner: { kind: "struct", slot: 0, schema: L3 } }, { dataWords: 0, ptrWords: 1 });
  const L1 = defineSchema({ inner: { kind: "struct", slot: 0, schema: L2 } }, { dataWords: 0, ptrWords: 1 });

  const bytes = encodeDynamic(cpp, L1, { inner: { inner: { v: 99 } } });
  const r = openDynamic(cpp, L1, bytes);
  assert.deepEqual(r.get("inner"), { inner: { v: 99 } });
});

/* -------------------- listStruct (write + read round-trip) -------------------- */

test("dynamic builder: listStruct round-trips with primitive-only elements", () => {
  const Item = defineSchema({
    v: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 0 });
  const Outer = defineSchema({
    items: { kind: "listStruct", slot: 0, element: Item },
  }, { dataWords: 0, ptrWords: 1 });

  const bytes = encodeDynamic(cpp, Outer, {
    items: [{ v: 10 }, { v: 20 }, { v: 4294967290 }],
  });
  const r = openDynamic(cpp, Outer, bytes);
  assert.deepEqual(r.get("items"), [{ v: 10 }, { v: 20 }, { v: 4294967290 }]);
});

test("dynamic builder: listStruct with text-bearing elements", () => {
  const Comment = defineSchema({
    body:   { kind: "text", slot: 0 },
    author: { kind: "text", slot: 1 },
  }, { dataWords: 0, ptrWords: 2 });
  const Post = defineSchema({
    title:    { kind: "text",       slot: 0 },
    comments: { kind: "listStruct", slot: 1, element: Comment },
  }, { dataWords: 0, ptrWords: 2 });

  const bytes = encodeDynamic(cpp, Post, {
    title: "hi",
    comments: [
      { body: "first",  author: "alice" },
      { body: "second", author: "bob"   },
    ],
  });
  const r = openDynamic(cpp, Post, bytes);
  assert.equal(r.get("title"), "hi");
  assert.deepEqual(r.get("comments"), [
    { body: "first",  author: "alice" },
    { body: "second", author: "bob"   },
  ]);
});

test("dynamic builder: empty listStruct round-trips", () => {
  const Item = defineSchema({ v: { kind: "uint32", offset: 0 } }, { dataWords: 1, ptrWords: 0 });
  const Outer = defineSchema({
    items: { kind: "listStruct", slot: 0, element: Item },
  }, { dataWords: 0, ptrWords: 1 });

  const bytes = encodeDynamic(cpp, Outer, { items: [] });
  const r = openDynamic(cpp, Outer, bytes);
  assert.deepEqual(r.get("items"), []);
});
