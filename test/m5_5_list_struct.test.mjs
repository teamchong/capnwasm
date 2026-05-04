// M5.5: Pure-JS Cap'n Proto List<Struct> (INLINE_COMPOSITE) decoder.
//
// Pre-M5.5, every List<Struct> at(i) crossed into wasm via
// cpp_any_open_list + cpp_any_enter_list_at to position the C++
// any_stack cursor on the i-th element. That meant element readers
// shared one cursor and could not coexist (calling at(j) invalidated
// the previous at(i) reader's view).
//
// M5.5 decodes the INLINE_COMPOSITE pointer in JS, computes each
// element's data section pointer arithmetically, and constructs an
// independent typed Reader per element. Element readers do not share
// a cursor, so multiple at(i) calls return readers that all stay
// valid in parallel. The C++ path is still kept as a fallback for
// unsafe-path readers and for aggregate methods (draft / toObject /
// pick) which still go through cpp_any_batch_read.
//
// These tests exercise the wire shape directly and verify the JS
// path stays coherent under conditions that pre-M5.5 had to defend
// against (parallel element readers, deep iteration, mixing field
// reads with aggregate calls).

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

test("List<Struct> at(i) returns correct field values via the JS path", () => {
  const bytes = build("codegen", 5);
  const r = openPost(cpp, bytes);
  const tags = r.tags;
  assert.equal(tags.length, 5);
  for (let i = 0; i < 5; i++) {
    const t = tags.at(i);
    assert.equal(t.name, `tag${i}`, `tag[${i}].name`);
    assert.equal(t.weight, i * 10, `tag[${i}].weight`);
  }
  r.dispose();
});

test("M5.5: parallel element readers (the architectural win)", () => {
  // Pre-M5.5, calling tags.at(j) invalidated the cursor on tags.at(i)
  // because both shared the C++ any_stack[top]. M5.5 element readers
  // own independent _dataPtr values, so multiple at() returns can
  // coexist freely.
  const bytes = build("parallel", 5);
  const r = openPost(cpp, bytes);
  const tags = r.tags;
  // Hold all five element readers simultaneously.
  const t0 = tags.at(0);
  const t1 = tags.at(1);
  const t2 = tags.at(2);
  const t3 = tags.at(3);
  const t4 = tags.at(4);
  // Read them out of order. Pre-M5.5, only the last-fetched would
  // return correct data; earlier ones would be stale.
  assert.equal(t4.name, "tag4");
  assert.equal(t0.name, "tag0");
  assert.equal(t2.weight, 20);
  assert.equal(t1.name, "tag1");
  assert.equal(t3.weight, 30);
  assert.equal(t0.weight, 0);
  r.dispose();
});

test("Iteration via Symbol.iterator yields correct rows in order", () => {
  const bytes = build("iter", 4);
  const r = openPost(cpp, bytes);
  const collected = [];
  for (const tag of r.tags) {
    collected.push({ name: tag.name, weight: tag.weight });
  }
  assert.deepEqual(collected, [
    { name: "tag0", weight: 0 },
    { name: "tag1", weight: 10 },
    { name: "tag2", weight: 20 },
    { name: "tag3", weight: 30 },
  ]);
  r.dispose();
});

test("Empty List<Struct> reports length 0 and at(0) === undefined", () => {
  const b = buildDynamic(cpp, POST);
  b.set("title", "empty");
  b.set("author", "alice");
  b.set("tags", []);
  const bytes = b.finalize();
  const r = openPost(cpp, bytes);
  assert.equal(r.tags.length, 0);
  assert.equal(r.tags.at(0), undefined);
  assert.equal(r.tags.at(-1), undefined);
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
  // Codegen path: iterate via the M5.5 JS list view.
  const r = openPost(cpp, bytes);
  const jsOut = [];
  for (let i = 0; i < r.tags.length; i++) {
    const t = r.tags.at(i);
    jsOut.push({ name: t.name, weight: t.weight });
  }
  r.dispose();
  assert.deepEqual(jsOut, ref, "M5.5 codegen path must match standalone decoder");
});

// ---- Aggregate methods still work via C++ rebind ------------------------

test("element reader.draft() works (uses C++ batch read via _rebind)", () => {
  const bytes = build("draft", 3);
  const r = openPost(cpp, bytes);
  const tag = r.tags.at(1);
  // draft() on an element reader reads via cpp_any_batch_read; M5.5
  // explicitly fires the rebind closure before the C++ call so the
  // batch reads from the right element.
  const got = tag.draft((t) => ({ name: t.name, weight: t.weight }));
  assert.deepEqual(got, { name: "tag1", weight: 10 });
  r.dispose();
});

test("element reader.toObject() works (uses C++ batch read via _rebind)", () => {
  const bytes = build("toObj", 3);
  const r = openPost(cpp, bytes);
  const tag = r.tags.at(2);
  const got = tag.toObject();
  assert.equal(got.name, "tag2");
  assert.equal(got.weight, 20);
  r.dispose();
});

// ---- Confirm zero wasm boundary calls on the JS hot path ----------------

test("M5.5 JS path keeps generation/active-slot stable through the hot loop", () => {
  // Indirect "no boundary call" check. Wasm exports are sealed
  // (configurable=false, writable=false) so we cannot wrap them with
  // throwing sentinels in strict-mode test files. Instead we observe
  // the side effects: any call into cpp_any_open_list /
  // enter_list_at / cpp_any_*_at would advance cpp._generation (via
  // _bumpGeneration in our codegen). The M5.5 JS hot loop reads only
  // through DataView / Uint8Array views, so generation must stay
  // constant across the inner for-loop.
  const bytes = build("sentinel", 4);
  const r = openPost(cpp, bytes);
  // Force one initial _useSlot/rebind so we are at a stable baseline.
  const tags = r.tags;
  const gen0 = cpp._generation;
  const slot0 = cpp._activeSlot;
  for (let i = 0; i < tags.length; i++) {
    const t = tags.at(i);
    assert.equal(t.name, `tag${i}`);
    assert.equal(t.weight, i * 10);
  }
  assert.equal(cpp._generation, gen0, "JS hot loop must not bump generation");
  assert.equal(cpp._activeSlot, slot0, "JS hot loop must not switch active slot");
  r.dispose();
});
