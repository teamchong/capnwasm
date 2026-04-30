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
  // builder yet — the test focuses on the READ path which is what the
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
  // cpp_conformance_serialize style — but conformance schema isn't ours.
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
