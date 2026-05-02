// Round-trip a real Cap'n Proto message against both the codegen reader and
// the dynamic reader, and assert they produce identical values.
//
// The schema descriptor for the dynamic reader is hand-written from the same
// `Primitives` shape that conformance_schema.gen.mjs codegens. The dynamic
// API has no codegen step. Schema lives as plain data, the wasm runtime
// stays the same.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { openPrimitives, PrimitivesReader } from "../js/conformance_schema.gen.mjs";
import { defineSchema, openDynamic, DynamicReader, buildDynamic } from "../js/dynamic.mjs";

let cpp, bytes;

before(async () => {
  cpp = await loadWasm();

  // Build the same Primitives bytes the pick test uses, via the
  // conformance schema's bench-only serializer.
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

// Mirror PrimitivesReader._FIELDS in dynamic-friendly form. Built by hand to
// prove the dynamic API is usable without codegen. Every entry is what a
// schema-as-data consumer would write.
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
  flag1:     { kind: "bool",    bitOffset: 145 },
  flag2:     { kind: "bool",    bitOffset: 146 },
  text:      { kind: "text",    slot: 0     },
  data:      { kind: "data",    slot: 1     },
  emptyText: { kind: "text",    slot: 2     },
  emptyData: { kind: "data",    slot: 3     },
});

test("dynamic.toObject() matches codegen reader.toObject()", () => {
  const codegen = openPrimitives(cpp, bytes);
  const expected = codegen.toObject();
  // Re-open: the per-field getters above re-stage input via cpp_any_open.
  const dyn = openDynamic(cpp, PrimitivesSchema, bytes);
  const got = dyn.toObject();
  // Approximate-equality for floats; everything else is exact.
  for (const k of Object.keys(expected)) {
    if (k === "f32" || k === "f64") {
      assert.ok(Math.abs(expected[k] - got[k]) < 1e-6, `${k}: ${expected[k]} vs ${got[k]}`);
    } else if (expected[k] instanceof Uint8Array) {
      assert.deepEqual(got[k], expected[k], `${k} bytes mismatch`);
    } else {
      assert.equal(got[k], expected[k], `${k} mismatch`);
    }
  }
});

test("dynamic.pick subset matches codegen pick", () => {
  const codegen = openPrimitives(cpp, bytes);
  const expected = codegen.pick(["u32", "text", "flag0"]);
  const dyn = openDynamic(cpp, PrimitivesSchema, bytes);
  const got = dyn.pick(["u32", "text", "flag0"]);
  assert.deepEqual(got, expected);
});

test("dynamic single-field get() matches codegen field", () => {
  const codegen = openPrimitives(cpp, bytes);
  const text = codegen.text;
  // Re-open because text getter consumes the cursor.
  const dyn = openDynamic(cpp, PrimitivesSchema, bytes);
  assert.equal(dyn.get("text"), text);
});

test("dynamic Proxy access matches codegen field access", () => {
  const codegen = openPrimitives(cpp, bytes);
  const u32 = codegen.u32;
  const flag0 = codegen.flag0;
  const dyn = openDynamic(cpp, PrimitivesSchema, bytes);
  assert.equal(dyn.fields.u32, u32);
  assert.equal(dyn.fields.flag0, flag0);
});

test("defineSchema rejects unknown kinds", () => {
  assert.throws(() => defineSchema({ x: { kind: "uint128", offset: 0 } }), /unknown kind/);
});

test("defineSchema rejects missing offset", () => {
  assert.throws(() => defineSchema({ x: { kind: "uint32" } }), /invalid "offset"/);
  assert.throws(() => defineSchema({ x: { kind: "text" } }), /invalid "slot"/);
  assert.throws(() => defineSchema({ x: { kind: "bool" } }), /invalid "bitOffset"/);
});

test("dynamic.get returns undefined for unknown field", () => {
  const dyn = openDynamic(cpp, PrimitivesSchema, bytes);
  assert.equal(dyn.get("nonexistent"), undefined);
});

test("dynamic schema can be derived from the codegen _FIELDS shape", () => {
  // Prove forward-compat: the dynamic reader accepts the same internal
  // descriptor format codegen emits, so a build step that strips a class
  // down to its _FIELDS object can feed it directly to openDynamic.
  const fields = PrimitivesReader._FIELDS;
  const compat = { fields };  // shape matches defineSchema's return value
  const dyn = new DynamicReader(cpp, compat);
  // We need to call cpp_any_open ourselves since we bypassed openDynamic.
  cpp._u8.set(bytes, cpp._inPtr);
  cpp._exports.cpp_any_open(bytes.length);
  const got = dyn.pick(["u8", "u16", "text"]);
  assert.equal(got.u8, 42);
  assert.equal(got.u16, 1234);
  assert.equal(got.text, "hello");
});

// Hand-crafted Post message with scores=[10, 20, 30]. Same bytes
// list.test.mjs uses to verify codegen list reads. We use them here to
// verify the dynamic reader's list-of-primitive support produces the
// same array.
function buildPostWithScores() {
  const bytes = new Uint8Array(64);
  const dv = new DataView(bytes.buffer);
  // Root struct ptr at bytes 8-15: struct(0 data, 4 ptrs).
  dv.setUint32(8, 0, true);
  dv.setUint32(12, 4 << 16, true);
  // scores list ptr at byte 32 (pointer slot 2, 16-byte offset into ptr section).
  // Encoded list pointer: kind=1 list, B=1 word offset, elementSize=4 (4-byte), count=3.
  const B = 1;
  const lo = (B << 2) | 1;
  const elementSize = 4;
  const count = 3;
  const hi = (count << 3) | elementSize;
  dv.setUint32(32, lo, true);
  dv.setUint32(36, hi, true);
  // List data at byte 48: three u32s.
  dv.setUint32(48, 10, true);
  dv.setUint32(52, 20, true);
  dv.setUint32(56, 30, true);
  // Frame header: segCount-1=0, segSize=7 words.
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 7, true);
  return bytes;
}

const PostSchema = defineSchema({
  title:   { kind: "text",       slot: 0 },
  scores:  { kind: "listUint32", slot: 2 },
});

test("dynamic.list: list-of-uint32 materializes as a JS array", () => {
  const bytes = buildPostWithScores();
  const r = openDynamic(cpp, PostSchema, bytes);
  assert.deepEqual(r.get("scores"), [10, 20, 30]);
});

test("dynamic.list: pick falls back to per-field reads when a list is included", () => {
  const bytes = buildPostWithScores();
  const r = openDynamic(cpp, PostSchema, bytes);
  const got = r.pick(["title", "scores"]);
  assert.equal(got.title, "");          // null pointer → default "" via codegen semantics
  assert.deepEqual(got.scores, [10, 20, 30]);
});

test("dynamic.list: empty list returns empty array", () => {
  // Frame with null root pointer → all fields default. List defaults to [].
  const empty = new Uint8Array(16);
  new DataView(empty.buffer).setUint32(0, 0, true);
  new DataView(empty.buffer).setUint32(4, 1, true);
  const r = openDynamic(cpp, PostSchema, empty);
  assert.deepEqual(r.get("scores"), []);
});

test("dynamic.list: Proxy access for list fields", () => {
  const bytes = buildPostWithScores();
  const r = openDynamic(cpp, PostSchema, bytes);
  assert.deepEqual(r.fields.scores, [10, 20, 30]);
});

test("defineSchema: listUint32 requires slot, not offset", () => {
  assert.throws(() => defineSchema({ x: { kind: "listUint32", offset: 0 } }), /invalid "slot"/);
});

// Hand-crafted Outer { inner :Inner } where Inner { value :UInt32 } = 42.
function buildOuterWithInner() {
  const bytes = new Uint8Array(32);
  const dv = new DataView(bytes.buffer);
  // Frame header: segCount-1=0, segSize=3 words (bytes 8..31).
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 3, true);
  // Word 0 (bytes 8-15): root struct ptr → Outer { dataWords=0, ptrWords=1 }
  // at word 1 (offset B=0). lo: kind=0,B=0; hi: dataWords=0,ptrWords=1<<16.
  dv.setUint32(8, 0, true);
  dv.setUint32(12, 1 << 16, true);
  // Word 1 (bytes 16-23): Outer's inner ptr → Inner { dataWords=1, ptrWords=0 }
  // at word 2 (offset B=0). lo: kind=0,B=0; hi: dataWords=1,ptrWords=0.
  dv.setUint32(16, 0, true);
  dv.setUint32(20, 1, true);
  // Word 2 (bytes 24-31): Inner's data section, uint32 value at offset 0.
  dv.setUint32(24, 42, true);
  return bytes;
}

const InnerSchema = defineSchema({
  value: { kind: "uint32", offset: 0 },
});
const OuterSchema = defineSchema({
  inner: { kind: "struct", slot: 0, schema: InnerSchema },
});

test("dynamic.struct: nested struct materializes as a plain object", () => {
  const r = openDynamic(cpp, OuterSchema, buildOuterWithInner());
  assert.deepEqual(r.get("inner"), { value: 42 });
});

test("dynamic.struct: missing nested struct returns default-valued fields", () => {
  // Outer with a null pointer slot. Cap'n Proto's wire-format convention
  // treats a null pointer as the default-initialized struct, so each
  // field comes back at its type's default (zero / "" / etc.). Matches
  // the codegen reader's behavior for nullable nested fields.
  const empty = new Uint8Array(24);
  const dv = new DataView(empty.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, 0, true);
  dv.setUint32(12, 1 << 16, true);
  const r = openDynamic(cpp, OuterSchema, empty);
  assert.deepEqual(r.get("inner"), { value: 0 });
});

test("defineSchema: nested struct requires a schema", () => {
  assert.throws(
    () => defineSchema({ x: { kind: "struct", slot: 0 } }),
    /missing "schema"/,
  );
});

test("defineSchema: nested struct requires a slot", () => {
  assert.throws(
    () => defineSchema({ x: { kind: "struct", schema: InnerSchema } }),
    /missing or invalid "slot"/,
  );
});

test("dynamic.struct: pick falls back to per-field reads when nested struct is present", () => {
  const r = openDynamic(cpp, OuterSchema, buildOuterWithInner());
  const got = r.pick(["inner"]);
  assert.deepEqual(got.inner, { value: 42 });
});

// Hand-crafted struct ItemList { items :List(Item) } with two Items.
// Item { id :UInt32; }. items = [ {id:1}, {id:2} ].
// Composite-list wire format: items ptr → list ptr with elementSize=7,
// followed by a tag word describing element layout, followed by the
// elements' data.
function buildItemList() {
  const bytes = new Uint8Array(56);
  const dv = new DataView(bytes.buffer);
  // Frame: segCount-1 = 0, segSize = 5 words.
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 5, true);
  // Word 0 (bytes 8-15): root ptr → ItemList { dataWords=0, ptrWords=1 } at word 1.
  dv.setUint32(8, 0, true);
  dv.setUint32(12, 1 << 16, true);
  // Word 1 (bytes 16-23): items list ptr.
  // Composite list: kind=1 (list), B=0 (data starts immediately after this ptr),
  // elementSize=7 (composite), totalWords = 2 (2 elements * 1 word, EXCLUDING tag).
  const lo = (0 << 2) | 1;          // kind=1 list
  const elementSize = 7;             // composite
  const totalWords = 2;              // 2 elements × 1 word each, NOT counting tag
  const hi = (totalWords << 3) | elementSize;
  dv.setUint32(16, lo, true);
  dv.setUint32(20, hi, true);
  // Word 2 (bytes 24-31): tag word for composite list.
  // Format = struct ptr with B=element count. dataWords=1, ptrWords=0.
  dv.setUint32(24, 2 << 2, true);   // B = count = 2 (two elements)
  dv.setUint32(28, 1, true);         // dataWords=1, ptrWords=0
  // Word 3 (bytes 32-39): element 0 data. Uint32 id = 1.
  dv.setUint32(32, 1, true);
  // Word 4 (bytes 40-47): element 1 data. Uint32 id = 2.
  dv.setUint32(40, 2, true);
  return bytes.subarray(0, 48);  // segSize 5 = bytes 8..47, frame 0..47
}

const ItemSchema = defineSchema({
  id: { kind: "uint32", offset: 0 },
});
const ItemListSchema = defineSchema({
  items: { kind: "listStruct", slot: 0, element: ItemSchema },
});

test("dynamic.listStruct: walks each element and returns array of plain objects", () => {
  const r = openDynamic(cpp, ItemListSchema, buildItemList());
  assert.deepEqual(r.get("items"), [{ id: 1 }, { id: 2 }]);
});

test("dynamic.listStruct: empty list returns []", () => {
  const empty = new Uint8Array(16);
  new DataView(empty.buffer).setUint32(0, 0, true);
  new DataView(empty.buffer).setUint32(4, 1, true);
  const r = openDynamic(cpp, ItemListSchema, empty);
  assert.deepEqual(r.get("items"), []);
});

test("defineSchema: listStruct requires element schema", () => {
  assert.throws(
    () => defineSchema({ x: { kind: "listStruct", slot: 0 } }),
    /missing "element"/,
  );
});

test("defineSchema: listStruct requires slot", () => {
  assert.throws(
    () => defineSchema({ x: { kind: "listStruct", element: ItemSchema } }),
    /missing or invalid "slot"/,
  );
});

// Schema with dimensions for the builder. Match the shape of the codegen
// User struct: id (UInt64) + active (Bool) in 2 data words; name (Text)
// in 1 ptr word.
const UserSchemaWithDims = defineSchema({
  id:     { kind: "uint64", offset: 0 },
  active: { kind: "bool",   bitOffset: 64 },
  name:   { kind: "text",   slot: 0 },
}, { dataWords: 2, ptrWords: 1 });

test("buildDynamic: round-trips through openDynamic with the same schema", () => {
  const b = buildDynamic(cpp, UserSchemaWithDims);
  b.set("id", 42);
  b.set("active", true);
  b.set("name", "Alice");
  const bytes = b.finalize();

  const r = openDynamic(cpp, UserSchemaWithDims, bytes);
  assert.equal(r.get("id"), 42);
  assert.equal(r.get("active"), true);
  assert.equal(r.get("name"), "Alice");
});

test("buildDynamic: bool false zeroes the bit", () => {
  const b = buildDynamic(cpp, UserSchemaWithDims);
  b.set("active", true);
  b.set("active", false);
  b.set("name", "");
  const bytes = b.finalize();
  const r = openDynamic(cpp, UserSchemaWithDims, bytes);
  assert.equal(r.get("active"), false);
});

test("buildDynamic: BigInt id round-trips through int64", () => {
  const b = buildDynamic(cpp, UserSchemaWithDims);
  b.set("id", 9007199254740993n);   // outside safe-integer range → needs BigInt
  b.set("active", false);
  b.set("name", "");
  const bytes = b.finalize();
  const r = openDynamic(cpp, UserSchemaWithDims, bytes);
  assert.equal(r.get("id"), 9007199254740993n);
});

test("buildDynamic: rejects schemas without dataWords/ptrWords", () => {
  const readOnly = defineSchema({ x: { kind: "uint8", offset: 0 } });
  assert.throws(() => buildDynamic(cpp, readOnly), /needs dataWords/);
});

test("buildDynamic: rejects unknown field", () => {
  const b = buildDynamic(cpp, UserSchemaWithDims);
  assert.throws(() => b.set("nonexistent", 1), /unknown field/);
});

test("buildDynamic: data fields take Uint8Array, reject other types", () => {
  const ImageSchema = defineSchema({
    body: { kind: "data", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const b = buildDynamic(cpp, ImageSchema);
  assert.throws(() => b.set("body", "not bytes"), /Uint8Array/);
  // Round-trip a small Uint8Array.
  const b2 = buildDynamic(cpp, ImageSchema);
  b2.set("body", new Uint8Array([1, 2, 3, 4]));
  const bytes = b2.finalize();
  const r = openDynamic(cpp, ImageSchema, bytes);
  assert.deepEqual(Array.from(r.get("body")), [1, 2, 3, 4]);
});

test("buildDynamic: finalize is one-shot. Second call throws", () => {
  const b = buildDynamic(cpp, UserSchemaWithDims);
  b.set("active", false);
  b.set("name", "");
  b.finalize();
  assert.throws(() => b.finalize(), /already finalized/);
  assert.throws(() => b.set("name", "x"), /finalized/);
});
