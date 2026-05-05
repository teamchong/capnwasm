// Interop coverage against upstream `capnp convert`. Exercises every
// primitive type, every primitive list type, text/data, an enum, a nested
// struct, and a List(Struct). We encode with the dynamic builder (which
// supports list/struct setters) and decode with both the upstream CLI and
// the capnwasm codegen reader.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  defineSchema,
  encodeDynamic,
  openDynamic,
} from "../js/dynamic.mjs";
import {
  AllTypesBuilder,
  buildAllTypes,
  buildInteropMessage,
  openAllTypes,
  openInteropMessage,
} from "./_fixtures/interop.gen.mjs";

const SCHEMA = "test/_fixtures/interop.capnp";

function haveCapnp() {
  const r = spawnSync("capnp", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

const skip = !haveCapnp();
if (skip) {
  test("interop AllTypes: skipped (capnp CLI not installed)", { skip: true }, () => {});
}

function capnpDecode(framed, structName) {
  const r = spawnSync(
    "capnp",
    ["convert", "binary:json", SCHEMA, structName],
    { input: framed, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (r.status !== 0) throw new Error(`capnp convert binary:json failed: ${r.stderr}`);
  return JSON.parse(r.stdout.toString());
}

function capnpEncode(jsonValue, structName) {
  const r = spawnSync(
    "capnp",
    ["convert", "json:binary", SCHEMA, structName],
    { input: JSON.stringify(jsonValue), stdio: ["pipe", "pipe", "pipe"] },
  );
  if (r.status !== 0) throw new Error(`capnp convert json:binary failed: ${r.stderr}`);
  return new Uint8Array(r.stdout);
}

const TAG = defineSchema({
  name:   { kind: "text",   slot: 0 },
  weight: { kind: "uint32", offset: 0 },
}, { dataWords: 1, ptrWords: 1 });

// AllTypes layout, derived from the .capnp wire layout. Confirmed via the
// generated `_FIELDS` table on AllTypesReader.
const ALL = defineSchema({
  boolField:    { kind: "bool",       bitOffset: 0 },
  int8Field:    { kind: "int8",       offset: 1 },
  int16Field:   { kind: "int16",      offset: 2 },
  int32Field:   { kind: "int32",      offset: 4 },
  int64Field:   { kind: "int64",      offset: 8 },
  uint8Field:   { kind: "uint8",      offset: 16 },
  uint16Field:  { kind: "uint16",     offset: 18 },
  uint32Field:  { kind: "uint32",     offset: 20 },
  uint64Field:  { kind: "uint64",     offset: 24 },
  float32Field: { kind: "float32",    offset: 32 },
  float64Field: { kind: "float64",    offset: 40 },
  textField:    { kind: "text",       slot: 0 },
  dataField:    { kind: "data",       slot: 1 },
  enumField:    { kind: "uint16",     offset: 36 },
  boolList:     { kind: "listBool",    slot: 2 },
  int32List:    { kind: "listInt32",   slot: 3 },
  uint64List:   { kind: "listUint64",  slot: 4 },
  float64List:  { kind: "listFloat64", slot: 5 },
  textList:     { kind: "listText",    slot: 6 },
  nested:       { kind: "struct",      slot: 7,  schema: TAG },
  tagList:      { kind: "listStruct",  slot: 8,  element: TAG },
}, { dataWords: 6, ptrWords: 9 });

const SAMPLE = {
  boolField: true,
  int8Field: -12,
  int16Field: -3456,
  int32Field: -78901234,
  int64Field: -56789012345n,
  uint8Field: 200,
  uint16Field: 50000,
  uint32Field: 0xfedcba98,
  uint64Field: 0x123456789abcdef0n,
  float32Field: 3.140625,
  float64Field: 2.718281828,
  textField: "round-trip 你好 🚀",
  dataField: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]),
  enumField: 2,
  boolList: [true, false, false, true, true, false, true],
  int32List: [-1, 0, 1, 2147483647, -2147483648],
  uint64List: [0n, 1n, 0xffffffffffffffffn],
  float64List: [0.0, 1.5, -1e100, 1e100, Number.EPSILON],
  textList: ["a", "", "γ", "👋"],
  nested: { name: "nested", weight: 7 },
  tagList: [
    { name: "alpha", weight: 1 },
    { name: "beta", weight: 22 },
    { name: "gamma", weight: 333 },
  ],
};

let cpp;
before(async () => { cpp = await loadWasm(); });

// uint64 round-trips through capnwasm as a possibly-signed BigInt because
// the reader uses the int64 wasm export. -1n ≡ 0xffffffffffffffff on the
// wire. Compare modulo 2^64.
const MASK64 = (1n << 64n) - 1n;
function eqU64(a, b) {
  return (BigInt(a) & MASK64) === (BigInt(b) & MASK64);
}

function expectAllTypes(reader) {
  assert.equal(reader.boolField, SAMPLE.boolField);
  assert.equal(reader.int8Field, SAMPLE.int8Field);
  assert.equal(reader.int16Field, SAMPLE.int16Field);
  assert.equal(reader.int32Field, SAMPLE.int32Field);
  assert.equal(BigInt(reader.int64Field), SAMPLE.int64Field);
  assert.equal(reader.uint8Field, SAMPLE.uint8Field);
  assert.equal(reader.uint16Field, SAMPLE.uint16Field);
  assert.equal(reader.uint32Field >>> 0, SAMPLE.uint32Field);
  assert.ok(eqU64(reader.uint64Field, SAMPLE.uint64Field));
  assert.ok(Math.abs(reader.float32Field - SAMPLE.float32Field) < 1e-6);
  assert.ok(Math.abs(reader.float64Field - SAMPLE.float64Field) < 1e-9);
  assert.equal(reader.textField, SAMPLE.textField);
  assert.deepEqual(Array.from(reader.dataField), Array.from(SAMPLE.dataField));
  assert.equal(reader.enumField, SAMPLE.enumField);
  assert.deepEqual([...reader.boolList], SAMPLE.boolList);
  assert.deepEqual([...reader.int32List], SAMPLE.int32List);
  const u64s = [...reader.uint64List];
  for (let i = 0; i < u64s.length; i++) assert.ok(eqU64(u64s[i], SAMPLE.uint64List[i]));
  assert.deepEqual([...reader.float64List], SAMPLE.float64List);
  assert.deepEqual([...reader.textList], SAMPLE.textList);
  assert.equal(reader.nested.name, SAMPLE.nested.name);
  assert.equal(reader.nested.weight, SAMPLE.nested.weight);
  assert.deepEqual(
    reader.draft((r) => r.tagList.map((t) => ({ name: t.name, weight: t.weight }))),
    SAMPLE.tagList,
  );
}

function asJsonValue(value) {
  // capnp convert json:binary expects:
  //  - 64-bit ints as JSON strings
  //  - Data as a number array
  //  - enums as the enumerant name (we use the numeric value, capnp also
  //    accepts that)
  return {
    boolField: value.boolField,
    int8Field: value.int8Field,
    int16Field: value.int16Field,
    int32Field: value.int32Field,
    int64Field: value.int64Field.toString(),
    uint8Field: value.uint8Field,
    uint16Field: value.uint16Field,
    uint32Field: value.uint32Field,
    uint64Field: value.uint64Field.toString(),
    float32Field: value.float32Field,
    float64Field: value.float64Field,
    textField: value.textField,
    dataField: Array.from(value.dataField),
    enumField: ["red", "green", "blue", "yellow"][value.enumField],
    boolList: value.boolList,
    int32List: value.int32List,
    uint64List: value.uint64List.map(String),
    float64List: value.float64List,
    textList: value.textList,
    nested: value.nested,
    tagList: value.tagList,
  };
}

test("interop AllTypes: capnwasm encodes → upstream capnp decodes", { skip }, () => {
  const bytes = encodeDynamic(cpp, ALL, SAMPLE);
  const decoded = capnpDecode(bytes, "AllTypes");
  assert.equal(decoded.boolField, SAMPLE.boolField);
  assert.equal(decoded.int8Field, SAMPLE.int8Field);
  assert.equal(decoded.int32Field, SAMPLE.int32Field);
  assert.equal(BigInt(decoded.int64Field), SAMPLE.int64Field);
  assert.equal(BigInt(decoded.uint64Field), SAMPLE.uint64Field);
  assert.equal(decoded.textField, SAMPLE.textField);
  assert.equal(decoded.enumField, "blue");
  assert.deepEqual(decoded.boolList, SAMPLE.boolList);
  assert.deepEqual(decoded.int32List, SAMPLE.int32List);
  assert.deepEqual(decoded.textList, SAMPLE.textList);
  assert.deepEqual(decoded.uint64List.map(BigInt), SAMPLE.uint64List);
  assert.equal(decoded.nested.name, SAMPLE.nested.name);
  assert.equal(decoded.nested.weight, SAMPLE.nested.weight);
  assert.equal(decoded.tagList.length, SAMPLE.tagList.length);
  for (let i = 0; i < SAMPLE.tagList.length; i++) {
    assert.equal(decoded.tagList[i].name, SAMPLE.tagList[i].name);
    assert.equal(decoded.tagList[i].weight, SAMPLE.tagList[i].weight);
  }
});

test("interop AllTypes: upstream capnp encodes → capnwasm codegen reader decodes", { skip }, () => {
  const bytes = capnpEncode(asJsonValue(SAMPLE), "AllTypes");
  const r = openAllTypes(cpp, bytes);
  expectAllTypes(r);
  r.dispose();
});

test("interop InteropMessage: nested AllTypes round-trip via upstream", { skip }, () => {
  const MSG = defineSchema({
    payload: { kind: "struct", slot: 0, schema: ALL },
    ordinal: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });

  const bytes = encodeDynamic(cpp, MSG, { payload: SAMPLE, ordinal: 17 });
  const decoded = capnpDecode(bytes, "InteropMessage");
  assert.equal(decoded.ordinal, 17);
  assert.equal(decoded.payload.textField, SAMPLE.textField);
  assert.equal(decoded.payload.tagList.length, SAMPLE.tagList.length);

  const upstreamBytes = capnpEncode({
    payload: asJsonValue(SAMPLE),
    ordinal: 42,
  }, "InteropMessage");
  const back = openInteropMessage(cpp, upstreamBytes);
  assert.equal(back.ordinal, 42);
  expectAllTypes(back.payload);
  back.dispose();
});

test("interop AllTypes: bit-stable cross-implementation round-trip", { skip }, () => {
  // capnwasm encode → upstream re-encode → capnwasm decode.
  const ours = encodeDynamic(cpp, ALL, SAMPLE);
  const json = capnpDecode(ours, "AllTypes");
  const reEncoded = capnpEncode(json, "AllTypes");
  const r = openAllTypes(cpp, reEncoded);
  expectAllTypes(r);
  r.dispose();
});

test("codegen Builder: full AllTypes shape via fromObject", { skip }, () => {
  const bytes = buildAllTypes(cpp).fromObject(SAMPLE).toBytes();
  const r = openAllTypes(cpp, bytes);
  expectAllTypes(r);
  r.dispose();
});

test("codegen Builder: capnwasm encodes (fromObject) → upstream capnp decodes", { skip }, () => {
  const bytes = buildAllTypes(cpp).fromObject(SAMPLE).toBytes();
  const decoded = capnpDecode(bytes, "AllTypes");
  assert.equal(decoded.textField, SAMPLE.textField);
  assert.equal(decoded.enumField, "blue");
  assert.deepEqual(decoded.boolList, SAMPLE.boolList);
  assert.deepEqual(decoded.int32List, SAMPLE.int32List);
  assert.deepEqual(decoded.textList, SAMPLE.textList);
  assert.equal(decoded.nested.name, SAMPLE.nested.name);
  assert.equal(decoded.nested.weight, SAMPLE.nested.weight);
  for (let i = 0; i < SAMPLE.tagList.length; i++) {
    assert.equal(decoded.tagList[i].name, SAMPLE.tagList[i].name);
    assert.equal(decoded.tagList[i].weight, SAMPLE.tagList[i].weight);
  }
});

test("codegen Builder: setters work field-by-field too", { skip }, () => {
  const b = new AllTypesBuilder(cpp);
  for (const k of Object.keys(SAMPLE)) b[k] = SAMPLE[k];
  const r = openAllTypes(cpp, b.toBytes());
  expectAllTypes(r);
  r.dispose();
});

test("codegen Builder: nested builder in InteropMessage", { skip }, () => {
  const b = buildInteropMessage(cpp);
  b.payload.fromObject(SAMPLE);
  b.ordinal = 99;
  const bytes = b.toBytes();
  const back = openInteropMessage(cpp, bytes);
  assert.equal(back.ordinal, 99);
  expectAllTypes(back.payload);
  back.dispose();
});
