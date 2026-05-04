// M5: Pure-JS Cap'n Proto pointer decoder conformance + behavior.
//
// The decoder is inlined into every codegen file so generated readers
// can decode Text and Data fields without crossing the wasm boundary.
// These tests prove byte-for-byte equality with the C++ path and
// exercise the edge cases (null pointers, empty strings, multi-byte
// UTF-8, large blobs, fallback behavior on unsafe-path readers).
//
// They also call the pure-JS decoder via its standalone module so a
// foreign wasm module hosting capnwasm bytes -- e.g. Rust on Workers
// -- can run the same code path without the C++ runtime.
//
// Reference: docs/capnp-in-wasm-memory.md "Step 1.8" + the pointer
// encoding section.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  defineSchema,
  buildDynamic,
} from "../js/dynamic.mjs";
import {
  readTextPtr,
  readDataPtr,
  readListPtr,
  readListUint32,
  readListInt64,
  readListBool,
} from "../js/pointer_decoder.mjs";
import { openPost, openPostUnsafe } from "./_fixtures/nested.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

const POST = defineSchema({
  title:  { kind: "text",   slot: 0 },
  author: { kind: "text",   slot: 1 },
}, { dataWords: 0, ptrWords: 5 });

function buildBytes(title, author) {
  const b = buildDynamic(cpp, POST);
  if (title !== undefined) b.set("title", title);
  if (author !== undefined) b.set("author", author);
  return b.finalize();
}

// ---- Pure-JS module: standalone decode (no codegen wrapper) ----------------

test("readTextPtr decodes UTF-8 text from raw bytes", () => {
  const bytes = buildBytes("hello", "alice");
  // Stage the bytes into a fresh ArrayBuffer that mimics the wasm
  // memory layout we use at runtime: the framed message (8-byte
  // header + payload) sits inside a backing buffer; msgStart is the
  // first byte after the header, msgEnd is one past the last byte.
  const u8 = new Uint8Array(bytes.length);
  u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const msgStart = 8;
  const msgEnd = bytes.length;
  // Root struct: capnp framed format puts the root pointer at offset
  // 8 (the start of the first segment payload), pointing at the data.
  // POST has 0 data words + 5 ptr words, so dataPtr = root struct's
  // data section. Decode the root pointer manually to find dataPtr.
  const rootWord0 = dv.getUint32(msgStart, true);
  const offset = (dv.getInt32(msgStart, true) >> 2);
  // root pointer's target = (msgStart + 8) + offset*8
  const dataPtr = msgStart + 8 + offset * 8;
  // Title is pointer slot 0 of the root struct.
  const title = readTextPtr(u8, dv, dataPtr, 0, 0, msgStart, msgEnd);
  const author = readTextPtr(u8, dv, dataPtr, 0, 1, msgStart, msgEnd);
  assert.equal(title, "hello");
  assert.equal(author, "alice");
});

test("readTextPtr returns null for null pointer", () => {
  // Build a Post with no title set. Pointer slot is null.
  const bytes = buildBytes(undefined, "alice");
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = (dv.getInt32(8, true) >> 2);
  const dataPtr = 16 + offset * 8;
  const title = readTextPtr(u8, dv, dataPtr, 0, 0, 8, bytes.length);
  assert.equal(title, null);
});

test("readDataPtr returns a Uint8Array slice", () => {
  // Build via dynamic since codegen for nested doesn't expose Data
  // setters; encode raw bytes through the conformance schema instead.
  // Use a minimal schema with a single Data field.
  const SCHEMA = defineSchema({
    blob: { kind: "data", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const b = buildDynamic(cpp, SCHEMA);
  b.set("blob", new Uint8Array([1, 2, 3, 254, 255]));
  const bytes = b.finalize();
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = (dv.getInt32(8, true) >> 2);
  const dataPtr = 16 + offset * 8;
  const blob = readDataPtr(u8, dv, dataPtr, 0, 0, 8, bytes.length);
  assert.ok(blob instanceof Uint8Array);
  assert.deepEqual(Array.from(blob), [1, 2, 3, 254, 255]);
});

test("readListPtr returns descriptor for primitive list", () => {
  const SCHEMA = defineSchema({
    nums: { kind: "listUint32", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const b = buildDynamic(cpp, SCHEMA);
  b.set("nums", [10, 20, 30, 40]);
  const bytes = b.finalize();
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = (dv.getInt32(8, true) >> 2);
  const dataPtr = 16 + offset * 8;
  const list = readListPtr(u8, dv, dataPtr, 0, 0, 8, bytes.length);
  assert.ok(list);
  assert.equal(list.count, 4);
  assert.equal(list.elemSize, 4);  // FOUR_BYTES
  assert.equal(readListUint32(dv, list, 0), 10);
  assert.equal(readListUint32(dv, list, 1), 20);
  assert.equal(readListUint32(dv, list, 2), 30);
  assert.equal(readListUint32(dv, list, 3), 40);
});

test("readListBool decodes BIT-packed list elements", () => {
  const SCHEMA = defineSchema({
    flags: { kind: "listBool", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const b = buildDynamic(cpp, SCHEMA);
  b.set("flags", [true, false, true, true, false, false, true, false, true]);
  const bytes = b.finalize();
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = (dv.getInt32(8, true) >> 2);
  const dataPtr = 16 + offset * 8;
  const list = readListPtr(u8, dv, dataPtr, 0, 0, 8, bytes.length);
  assert.ok(list);
  assert.equal(list.count, 9);
  assert.equal(list.elemSize, 1);  // BIT
  const expected = [true, false, true, true, false, false, true, false, true];
  for (let i = 0; i < 9; i++) {
    assert.equal(readListBool(dv, list, i), expected[i], `bit ${i}`);
  }
});

test("readListInt64 decodes EIGHT_BYTES list elements", () => {
  const SCHEMA = defineSchema({
    big: { kind: "listInt64", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const b = buildDynamic(cpp, SCHEMA);
  b.set("big", [0n, 1n, -1n, 9007199254740991n, -9007199254740991n]);
  const bytes = b.finalize();
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = (dv.getInt32(8, true) >> 2);
  const dataPtr = 16 + offset * 8;
  const list = readListPtr(u8, dv, dataPtr, 0, 0, 8, bytes.length);
  assert.ok(list);
  assert.equal(list.count, 5);
  assert.equal(list.elemSize, 5);  // EIGHT_BYTES
  assert.equal(readListInt64(dv, list, 0), 0n);
  assert.equal(readListInt64(dv, list, 1), 1n);
  assert.equal(readListInt64(dv, list, 2), -1n);
  assert.equal(readListInt64(dv, list, 3), 9007199254740991n);
  assert.equal(readListInt64(dv, list, 4), -9007199254740991n);
});

test("readListPtr returns undefined for List<Struct> (INLINE_COMPOSITE; falls back to C++)", () => {
  const TAG = defineSchema({
    name:   { kind: "text",   slot: 0 },
    weight: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });
  const SCHEMA = defineSchema({
    tags: { kind: "listStruct", slot: 0, element: TAG },
  }, { dataWords: 0, ptrWords: 1 });
  const b = buildDynamic(cpp, SCHEMA);
  b.set("tags", [{ name: "alpha", weight: 1 }, { name: "beta", weight: 2 }]);
  const bytes = b.finalize();
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = (dv.getInt32(8, true) >> 2);
  const dataPtr = 16 + offset * 8;
  const list = readListPtr(u8, dv, dataPtr, 0, 0, 8, bytes.length);
  // INLINE_COMPOSITE (elemSize=7) is not handled in M5; decoder
  // returns undefined so codegen falls back to C++.
  assert.equal(list, undefined);
});

// ---- Codegen integration: JS path is exercised + agrees with C++ ----------

test("codegen Text getter returns the right string via the JS path", () => {
  // The JS decoder path runs for any reader that has _msgEnd set
  // (slot-pool path). We confirmed in M5 dev that this path doesn't
  // cross the wasm boundary; here we verify correctness across a
  // matrix of inputs.
  const cases = [
    { title: "", author: "" },
    { title: "x", author: "y" },
    { title: "Cap'n Proto", author: "alice" },
    { title: "你好世界", author: "🚀 hello" },
    { title: "x".repeat(127), author: "y".repeat(254) },  // boundary lengths
    { title: "line1\nline2\tend", author: "with \"quotes\" and 'apostrophes'" },
  ];
  for (const c of cases) {
    const bytes = buildBytes(c.title, c.author);
    const r = openPost(cpp, bytes);
    assert.equal(r.title, c.title, `title mismatch for ${JSON.stringify(c.title)}`);
    assert.equal(r.author, c.author, `author mismatch for ${JSON.stringify(c.author)}`);
    r.dispose();
  }
});

test("JS path returns same bytes as C++ path (parallel readers, same input)", () => {
  // Open the same bytes twice. The slot-pool reader uses JS; force a
  // second reader through the unsafe path which uses the C++ decoder
  // (cpp_any_text_at). Both must return identical strings for every
  // test case. This is the byte-for-byte conformance guarantee.
  const cases = [
    "hello",
    "",
    "你好世界",
    "x".repeat(8000),  // long but still single-segment with default builder
  ];
  for (const t of cases) {
    const bytes = buildBytes(t, "alice");
    // Capture the C++ result first; openPostUnsafe shares the legacy
    // slot 0 with subsequent unsafe activity. Capture as a string
    // value (not a reader reference) before opening any other reader.
    const rCpp = openPostUnsafe(cpp, bytes);
    const cppTitle = rCpp.title;
    const rJs = openPost(cpp, bytes);
    assert.equal(
      rJs.title,
      cppTitle,
      `JS != C++ for title ${JSON.stringify(t.slice(0, 30))}${t.length > 30 ? "..." : ""}`,
    );
    rJs.dispose();
  }
});

// ---- Empty string / boundary cases -----------------------------------------

test("Text empty string returns '' (count=1, just the NUL)", () => {
  const bytes = buildBytes("", "alice");
  const r = openPost(cpp, bytes);
  assert.equal(r.title, "");
  assert.equal(r.author, "alice");
  r.dispose();
});

test("Text not-set returns null-equivalent (the codegen normalizes to '')", () => {
  // capnwasm's Text getter contract: when the pointer is null, return
  // "" rather than null/undefined, matching the upstream Cap'n Proto
  // C++ binding's "default = empty string" rule. The pure-JS decoder
  // returns null; the codegen wrapper normalizes (v ?? "").
  const bytes = buildBytes(undefined, "alice");
  const r = openPost(cpp, bytes);
  assert.equal(r.title, "");
  assert.equal(r.author, "alice");
  r.dispose();
});

// ---- Survives memory growth (decoder refreshes views) ----------------------

test("JS decoder refreshes _u8 / _dv after wasm memory growth", () => {
  // Build a large message that, when set into the wasm scratch via a
  // builder, can grow wasm memory. After growth our reader's cached
  // _u8 / _dv would be stale. The M5 _ensureCapnwasmReader fast path
  // detects a buffer mismatch and refreshes before the JS read.
  const bigText = "x".repeat(50_000);
  const bytes = buildBytes(bigText, "alice");
  const r = openPost(cpp, bytes);
  assert.equal(r.title, bigText);
  // Now grow memory by encoding *another* big message via builder.
  // The reader's stored _u8 buffer may detach.
  for (let i = 0; i < 5; i++) {
    const b = buildDynamic(cpp, POST);
    b.set("title", "y".repeat(60_000));
    b.finalize();
  }
  // Read again. _ensureCapnwasmReader's buffer-mismatch refresh
  // should kick in.
  assert.equal(r.title, bigText, "reader survived memory growth");
  r.dispose();
});
