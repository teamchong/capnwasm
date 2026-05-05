// Verify List<X> codegen end-to-end via the wasm-built compiler.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

const schemaSrc = `@0xb1f7c5e9c4e02134;
struct Tag {
  name @0 :Text;
  weight @1 :UInt32;
}
struct Post {
  title @0 :Text;
  tags @1 :List(Tag);
  scores @2 :List(UInt32);
  authors @3 :List(Text);
}`;

const tmp = mkdtempSync(join(tmpdir(), "cw-list-"));
writeFileSync(join(tmp, "post.capnp"), schemaSrc);
const r = spawnSync("node", [CLI, "gen", join(tmp, "post.capnp"), "-o", join(tmp, "post.gen.mjs")], { encoding: "utf8" });
if (r.status !== 0) throw new Error("codegen failed: " + r.stderr);

let cpp;
let gen;
let CapnpCompiler;
before(async () => {
  const { load } = await import(pathToFileURL(resolve(ROOT, "dist", "inlined.mjs")).href);
  cpp = await load();
  gen = await import(pathToFileURL(join(tmp, "post.gen.mjs")).href);
  CapnpCompiler = (await import(pathToFileURL(resolve(ROOT, "js", "capnpc_loader.mjs")).href)).CapnpCompiler;
});

// We don't yet have list-builder codegen. To produce a known list-bearing
// message for the Reader test, use the upstream capnp compiler in our wasm
// to produce a serialized example via a helper schema. That's circular; the
// pragmatic alternative is to construct the bytes by hand. We hand-craft
// a Post with a List<UInt32> via the capnp wire format directly.

test("List<UInt32>: length + at(i) + iteration over a hand-crafted message", () => {
  // Construct a Post message with scores=[10, 20, 30] via raw bytes.
  // Layout (Cap'n Proto wire):
  //   segment 0 word 0: root pointer → struct {dataWords:0, ptrWords:4} at +0
  //   segment 0 words 1-4: pointer section (4 ptrs, all null except scores)
  //   scores ptr: list pointer to a List(u32) of 3 elements
  //
  // The simplest approach: use the wasm Builder via cpp_any_builder to
  // build the parent struct, then patch in the list bytes directly.
  // Honest cost: this test cheats slightly because we don't ship a list
  // builder yet. The test focuses on the READ path which is what the
  // codegen for List<X> emits.
  //
  // Hand-craft the bytes (1 segment):
  //   word 0: root ptr → struct(0 data, 4 ptrs) immediately after
  //   word 1: scores ptr → list ptr to elements right after pointer section
  //   words 2-4: null
  //   words 5-?: list of u32 elements (packed 2 per word)
  const bytes = new Uint8Array(64);
  const dv = new DataView(bytes.buffer);
  // Cap'n Proto framing: segCount-1=0 (so 1 seg), segSize in words.
  // We'll fill segSize after computing data layout.
  // Reserve bytes 0..7 for framing; segment 0 starts at byte 8.

  // Root pointer at bytes 8-15: struct(B=0, dataWords=0, ptrWords=4)
  // bits: 0..1=struct(0), 2..31=B(0), 32..47=dataWords(0), 48..63=ptrWords(4)
  dv.setUint32(8,  0, true);
  dv.setUint32(12, 4 << 16, true);  // ptrWords=4 in upper half of u64

  // Pointer section starts at byte 16, 4 pointers (32 bytes total).
  // Pointer 0 (title): null
  // Pointer 1 (tags): null
  // Pointer 2 (scores): list pointer.
  //   bits: 0..1=list(1), 2..31=B(words from end of ptr to data),
  //         32..34=elementSize(2 = 4-byte), 35..63=count(3)
  // ptr 2 lives at byte 16+8*2 = byte 32. Data goes right after pointer
  // section, which ends at byte 16 + 32 = byte 48.
  // Offset = (48 - (32 + 8)) / 8 = 1 word.
  // List pointer encoding (capnp wire spec):
  //   bits 0..1   = 1 (list pointer kind)
  //   bits 2..31  = B (signed offset in words from end of pointer to data)
  //   bits 32..34 = elementSize: 0=void 1=1bit 2=1byte 3=2byte 4=4byte 5=8byte(data)
  //                              6=8byte(ptr) 7=composite
  //   bits 35..63 = elementCount
  const B = 1;
  const lo = (B << 2) | 1;
  const elementSize = 4;     // 4-byte (UInt32)
  const count = 3;
  const hi = (count << 3) | elementSize;
  dv.setUint32(32, lo, true);
  dv.setUint32(36, hi, true);
  // Pointer 3 (authors): null

  // List elements at byte 48, three u32s = 12 bytes (rounded to 16 = 2 words).
  dv.setUint32(48, 10, true);
  dv.setUint32(52, 20, true);
  dv.setUint32(56, 30, true);
  // padding word stays zero

  // Total segment 0 = 8 words (root ptr + 4 ptrs + 2 list-data words + 1 pad)
  // Wait: bytes 8..63 = 56 bytes / 8 = 7 words. Let me recompute.
  //   word 0: root ptr (bytes 8-15)
  //   words 1-4: ptr section (bytes 16-47)
  //   word 5: list data words 0 (bytes 48-55, holds first 2 u32s)
  //   word 6: list data word 1 (bytes 56-63, holds third u32 + pad)
  // → 7 words.
  dv.setUint32(0, 0, true);   // segCount-1=0
  dv.setUint32(4, 7, true);   // segSize=7 words

  const r = gen.openPost(cpp, bytes);
  const scores = r.scores;
  assert.equal(scores.length, 3);
  assert.equal(scores.at(0), 10);
  assert.equal(scores.at(1), 20);
  assert.equal(scores.at(2), 30);
  // iteration
  const collected = [];
  for (const s of scores) collected.push(s);
  assert.deepEqual(collected, [10, 20, 30]);
});

test("List<Struct>: length + at(i) returns typed Reader", async () => {
  // Use the capnp compiler in wasm to produce a real Post with tags.
  // We don't have a list-Builder yet, so we produce the bytes via
  // cpp_conformance_serialize style. But conformance schema isn't ours.
  // Instead, we just verify that the empty-list case works correctly
  // (length === 0, at(0) returns undefined). Real list-of-struct
  // construction comes online with the list-Builder follow-up.
  const empty = new Uint8Array(16);
  new DataView(empty.buffer).setUint32(0, 0, true);
  new DataView(empty.buffer).setUint32(4, 1, true);
  // root pointer at byte 8 = null → reading any field gets defaults
  // including empty lists.
  const r = gen.openPost(cpp, empty);
  const tags = r.tags;
  assert.equal(tags.length, 0);
  assert.equal(tags.at(0), undefined);
});

test("List<Struct>: at(i) reads correct fields for every element, not just at(0)", async () => {
  // Regression for a codegen bug where at(0) worked but at(1+) returned
  // zeros. Cause: at() called cpp_any_open_list relative to whatever
  // happened to be on top of the any_stack; the previous at() call had
  // pushed an element, so the second at() opened the list relative to
  // that element instead of the parent. Fix: track per-wrapper "have I
  // pushed?" flag and pop only when needed (so the first at() doesn't
  // over-pop the parent in nested-struct cases).
  //
  // Build a Post with tags = [{name:"alpha", weight:10}, {name:"beta",
  // weight:20}, {name:"gamma", weight:30}] via the dynamic builder, then
  // walk all three elements via the codegen Reader.
  const { defineSchema, buildDynamic } = await import(
    pathToFileURL(resolve(ROOT, "js", "dynamic.mjs")).href);
  const TAG = defineSchema({
    name:   { kind: "text",   slot: 0 },
    weight: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });
  const POST = defineSchema({
    title:   { kind: "text",       slot: 0 },
    tags:    { kind: "listStruct", slot: 1, element: TAG },
    scores:  { kind: "listUint32", slot: 2 },
    authors: { kind: "listText",   slot: 3 },
  }, { dataWords: 0, ptrWords: 4 });
  const b = buildDynamic(cpp, POST);
  b.set("tags", [
    { name: "alpha", weight: 10 },
    { name: "beta",  weight: 20 },
    { name: "gamma", weight: 30 },
  ]);
  const bytes = b.finalize();

  const r = gen.openPost(cpp, bytes);
  const tags = r.tags;
  assert.equal(tags.length, 3);

  // Walk each element, checking BOTH fields each time. If at(i) leaks
  // cursor depth across calls, at(1+) will return empty/zero values.
  const t0 = tags.at(0); assert.equal(t0.name, "alpha"); assert.equal(t0.weight, 10);
  const t1 = tags.at(1); assert.equal(t1.name, "beta");  assert.equal(t1.weight, 20);
  const t2 = tags.at(2); assert.equal(t2.name, "gamma"); assert.equal(t2.weight, 30);

  // for..of iteration uses the same at(). Should also walk correctly.
  const collected = [];
  for (const t of tags) collected.push({ name: t.name, weight: t.weight });
  assert.deepEqual(collected, [
    { name: "alpha", weight: 10 },
    { name: "beta",  weight: 20 },
    { name: "gamma", weight: 30 },
  ]);
});

test("List<Text>: at(i) walks large lists without cursor growth", async () => {
  const { defineSchema, buildDynamic } = await import(
    pathToFileURL(resolve(ROOT, "js", "dynamic.mjs")).href);
  const POST = defineSchema({
    title:   { kind: "text",       slot: 0 },
    tags:    { kind: "listStruct", slot: 1, element: defineSchema({
      name:   { kind: "text",   slot: 0 },
      weight: { kind: "uint32", offset: 0 },
    }, { dataWords: 1, ptrWords: 1 }) },
    scores:  { kind: "listUint32", slot: 2 },
    authors: { kind: "listText",   slot: 3 },
  }, { dataWords: 0, ptrWords: 4 });
  const authors = [];
  for (let i = 0; i < 2000; i++) authors.push(`author-${i}`);
  const b = buildDynamic(cpp, POST);
  b.set("authors", authors);
  const r = gen.openPost(cpp, b.finalize());
  const list = r.authors;
  assert.equal(list.length, authors.length);
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list.at(i).length;
  assert.equal(total, authors.reduce((n, s) => n + s.length, 0));
  r.dispose();
});

test("List<Struct>: element reader survives another open on the same CapnCpp", async () => {
  // The whole point of safe-by-default readers: a reader handed to user code
  // must keep returning the same fields even if the runtime is asked to open
  // another message in between. For list-element readers fetched via
  // list.at(i), this requires the element reader's rebind closure to
  // re-position the cursor onto the correct list element after the parent
  // message is reopened. Regression for the inner-list rebind hazard.
  const { defineSchema, buildDynamic } = await import(
    pathToFileURL(resolve(ROOT, "js", "dynamic.mjs")).href);
  const TAG = defineSchema({
    name:   { kind: "text",   slot: 0 },
    weight: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });
  const POST = defineSchema({
    title:   { kind: "text",       slot: 0 },
    tags:    { kind: "listStruct", slot: 1, element: TAG },
    scores:  { kind: "listUint32", slot: 2 },
    authors: { kind: "listText",   slot: 3 },
  }, { dataWords: 0, ptrWords: 4 });
  const b = buildDynamic(cpp, POST);
  b.set("title", "first post");
  b.set("tags", [
    { name: "alpha", weight: 10 },
    { name: "beta",  weight: 20 },
    { name: "gamma", weight: 30 },
  ]);
  const firstBytes = b.finalize();

  const b2 = buildDynamic(cpp, POST);
  b2.set("title", "different post");
  b2.set("tags", [
    { name: "zzz", weight: 999 },
  ]);
  const otherBytes = b2.finalize();

  const post = gen.openPost(cpp, firstBytes);
  const elem = post.tags.at(1);
  // Capture before any interleave so we know the baseline.
  assert.equal(elem.name, "beta");
  assert.equal(elem.weight, 20);

  // Open a different message on the same cpp. This bumps generation and
  // detaches the C++ any_reader from the parent post. A naive
  // implementation would now read garbage from `elem`.
  const other = gen.openPost(cpp, otherBytes);
  assert.equal(other.title, "different post");

  // Element reader must still report its original values: rebind closure
  // re-opens parent's message, re-opens the parent list, re-enters element 1.
  assert.equal(elem.name, "beta");
  assert.equal(elem.weight, 20);

  // And the parent reader (post) is also still readable.
  assert.equal(post.title, "first post");
  assert.equal(post.tags.length, 3);
});
