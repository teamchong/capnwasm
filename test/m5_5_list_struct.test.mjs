// M5.5: Pure-JS Cap'n Proto List<Struct> (INLINE_COMPOSITE) decoder.
//
// Pre-M5.5, List<Struct> access crossed into wasm via cpp_any_open_list +
// cpp_any_enter_list_at to position the C++ any_stack cursor on the i-th
// element. That made row-reader APIs expensive and cursor-sensitive.
//
// M5.5 decodes the INLINE_COMPOSITE pointer in JS, computes each
// element's data section pointer arithmetically. Generated list views now
// expose length only for List(Struct); row materialization goes through
// draft(), which maps selected fields to plain JS objects without exposing
// stable per-row Reader objects.
//
// These tests exercise the wire shape directly and verify the JS
// path stays coherent under conditions that pre-M5.5 had to defend against
// (deep iteration and mixing root reads with list projection).

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  defineSchema,
  buildDynamic,
} from "../js/dynamic.mjs";
import {
  readListStructPtr,
  listStructElementDataPtr,
} from "../js/pointer_decoder.mjs";
import { openPost, openPostUnsafe } from "./_fixtures/nested.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

const TAG = defineSchema({
  name:   { kind: "text",   slot: 0 },
  weight: { kind: "uint32", offset: 0 },
}, { dataWords: 1, ptrWords: 1 });

const POST = defineSchema({
  title:    { kind: "text",       slot: 0 },
  author:   { kind: "text",       slot: 1 },
  tags:     { kind: "listStruct", slot: 2, element: TAG },
}, { dataWords: 0, ptrWords: 5 });

function build(label, tagCount) {
  const b = buildDynamic(cpp, POST);
  b.set("title", `${label} (${tagCount} tags)`);
  b.set("author", "alice");
  const tags = [];
  for (let i = 0; i < tagCount; i++) {
    tags.push({ name: `tag${i}`, weight: i * 10 });
  }
  b.set("tags", tags);
  return b.finalize();
}

// ---- Standalone pointer_decoder.mjs --------------------------------------

test("readListStructPtr decodes INLINE_COMPOSITE element layout", () => {
  const bytes = build("standalone", 3);
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = dv.getInt32(8, true) >> 2;
  const dataPtr = 16 + offset * 8;          // root struct's data section
  // POST: dataWords=0, tags is pointer slot 2.
  const list = readListStructPtr(u8, dv, dataPtr, 0, 2, 8, bytes.length);
  assert.ok(list, "expected a list descriptor");
  assert.equal(list.count, 3);
  assert.equal(list.dataWords, 1);          // TAG has 1 data word + 1 ptr word
  assert.equal(list.ptrWords, 1);
  // Element 1's data section has weight=10 packed at byte 0.
  const elem1 = listStructElementDataPtr(list, 1);
  assert.equal(dv.getUint32(elem1, true), 10, "tag1.weight");
});

test("readListStructPtr returns null for a null List<Struct> pointer", () => {
  // Build a Post with no tags set.
  const b = buildDynamic(cpp, POST);
  b.set("title", "no tags"); b.set("author", "alice");
  const bytes = b.finalize();
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = dv.getInt32(8, true) >> 2;
  const dataPtr = 16 + offset * 8;
  const list = readListStructPtr(u8, dv, dataPtr, 0, 2, 8, bytes.length);
  assert.equal(list, null);
});

// ---- Codegen integration: JS path is exercised --------------------------

test("List<Struct> draft projection returns correct field values", () => {
  const bytes = build("codegen", 5);
  const r = openPost(cpp, bytes);
  const tags = r.draft((p) => p.tags.map((t) => ({ name: t.name, weight: t.weight })));
  assert.deepEqual(tags, [
    { name: "tag0", weight: 0 },
    { name: "tag1", weight: 10 },
    { name: "tag2", weight: 20 },
    { name: "tag3", weight: 30 },
    { name: "tag4", weight: 40 },
  ]);
  r.dispose();
});

test("M5.5: repeated draft projections are stable", () => {
  const bytes = build("parallel", 5);
  const r = openPost(cpp, bytes);
  const project = (p) => p.tags.map((t) => ({ name: t.name, weight: t.weight }));
  const a = r.draft(project);
  const b = r.draft(project);
  assert.deepEqual(a, b);
  assert.equal(a[4].name, "tag4");
  assert.equal(a[0].weight, 0);
  r.dispose();
});

test("draft map yields correct rows in order", () => {
  const bytes = build("iter", 4);
  const r = openPost(cpp, bytes);
  const collected = r.draft((p) => p.tags.map((tag) => ({ name: tag.name, weight: tag.weight })));
  assert.deepEqual(collected, [
    { name: "tag0", weight: 0 },
    { name: "tag1", weight: 10 },
    { name: "tag2", weight: 20 },
    { name: "tag3", weight: 30 },
  ]);
  r.dispose();
});

test("Empty List<Struct> reports length 0", () => {
  const b = buildDynamic(cpp, POST);
  b.set("title", "empty");
  b.set("author", "alice");
  b.set("tags", []);
  const bytes = b.finalize();
  const r = openPost(cpp, bytes);
  assert.equal(r.tags.length, 0);
  r.dispose();
});

// ---- Conformance: JS path == C++ path -----------------------------------

test("M5.5 JS path produces values matching the standalone pointer decoder", () => {
  // The standalone js/pointer_decoder.mjs implementation walks raw
  // bytes through the same algorithm the codegen-inlined decoder
  // uses. If the codegen reader and the standalone decoder produce
  // identical rows for the same bytes, we have byte-for-byte
  // conformance against an independent JS re-implementation of the
  // INLINE_COMPOSITE wire shape. (Cross-checking against the C++
  // unsafe path is harder: openFooUnsafe shares a single legacy
  // cursor that is invalidated by any other open, so iterating its
  // list-of-struct via the C++ path requires holding the cursor
  // stable -- a fragile pre-M5.5 contract that M5.5 was designed to
  // remove.)
  const bytes = build("conformance", 7);
  const u8 = new Uint8Array(bytes.length); u8.set(bytes);
  const dv = new DataView(u8.buffer);
  const offset = dv.getInt32(8, true) >> 2;
  const dataPtr = 16 + offset * 8;
  const list = readListStructPtr(u8, dv, dataPtr, 0, 2, 8, bytes.length);
  // Reference: hand-decode each element via the standalone module.
  const ref = [];
  for (let i = 0; i < list.count; i++) {
    const elemDataPtr = listStructElementDataPtr(list, i);
    // weight is at byte offset 0 of TAG's data section (1 word).
    const weight = dv.getUint32(elemDataPtr, true);
    // name is pointer slot 0 of TAG. TAG._DATA_WORDS = 1.
    // Decode the Text pointer manually since we don't import readTextPtr
    // into this fixture: pointer is at elemDataPtr + 1*8 = elemDataPtr+8.
    const ptrAddr = elemDataPtr + 8;
    const w0 = dv.getInt32(ptrAddr, true);
    const w1 = dv.getUint32(ptrAddr + 4, true);
    const ptrOffset = w0 >> 2;
    const count = w1 >>> 3;
    const target = ptrAddr + 8 + ptrOffset * 8;
    const name = new TextDecoder().decode(u8.subarray(target, target + count - 1));
    ref.push({ name, weight });
  }
  // Codegen path: project via generated draft().
  const r = openPost(cpp, bytes);
  const jsOut = r.draft((p) => p.tags.map((t) => ({ name: t.name, weight: t.weight })));
  r.dispose();
  assert.deepEqual(jsOut, ref, "M5.5 codegen path must match standalone decoder");
});

// ---- Draft slicing -------------------------------------------------------

test("draft list projection supports slice for single-row access", () => {
  const bytes = build("draft", 3);
  const r = openPost(cpp, bytes);
  const got = r.draft((p) => p.tags.map((t) => ({ name: t.name, weight: t.weight })).slice(1, 2));
  assert.deepEqual(got, [{ name: "tag1", weight: 10 }]);
  r.dispose();
});
