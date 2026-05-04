// M1: Single-segment ABI surface validation.
//
// The capnwasm public reader ABI accepts only single-segment Cap'n Proto
// framed messages (see docs/capnp-in-wasm-memory.md). These tests cover:
//   - Valid single-segment input round-trips through openDynamic and
//     codegen openFoo on both safe and unsafe paths.
//   - Hand-crafted multi-segment input is rejected with
//     MultiSegmentMessageError on every public open path (managed,
//     unsafe scratch, dynamic safe, dynamic unsafe).
//   - Truncated framed headers and unaligned lengths are rejected with
//     the same typed error.
//   - validateSingleSegment is exported and usable standalone.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import {
  load as loadWasm,
  MultiSegmentMessageError,
  validateSingleSegment,
} from "../dist/inlined.mjs";
import { openPrimitives, openPrimitivesUnsafe } from "../js/conformance_schema.gen.mjs";
import {
  defineSchema,
  openDynamic,
  openDynamicUnsafe,
} from "../js/dynamic.mjs";

let cpp, validBytes;

// Build a real single-segment Primitives message via the conformance
// serializer so tests run against a known-good byte sequence.
before(async () => {
  cpp = await loadWasm();
  const u8 = cpp._u8;
  const inPtr = cpp._exports.cpp_in_ptr();
  const buf = u8.subarray(inPtr, inPtr + cpp._exports.cpp_in_capacity());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf[0] = 1;
  dv.setUint16(4, 2, true); dv.setInt16(6, -2, true);
  dv.setUint32(8, 3, true); dv.setInt32(12, -3, true);
  dv.setBigUint64(16, 4n, true); dv.setBigInt64(24, -4n, true);
  dv.setFloat32(32, 1.5, true); dv.setFloat64(36, 2.71828, true);
  buf[44] = 0;
  const enc = new TextEncoder();
  const t = enc.encode("hi");
  dv.setUint32(45, t.length, true);
  buf.set(t, 49);
  let pos = 49 + t.length;
  dv.setUint32(pos, 0, true); pos += 4;
  const len = cpp._exports.cpp_conformance_serialize(pos);
  // Re-fetch _u8 in case wasm memory grew during the serialize call.
  const u8After = cpp._u8;
  validBytes = u8After.slice(
    cpp._exports.cpp_out_ptr(),
    cpp._exports.cpp_out_ptr() + len,
  );
});

const PrimitivesSchema = defineSchema({
  u8:  { kind: "uint8",  offset: 0 },
  u16: { kind: "uint16", offset: 2 },
  u32: { kind: "uint32", offset: 4 },
  text: { kind: "text",  slot: 0 },
});

// ---- Valid single-segment ---------------------------------------------------

test("validateSingleSegment accepts a real Cap'n Proto framed message", () => {
  // Pure-JS validator on the canonical bytes the wasm just produced.
  // No throw means single-segment OK.
  validateSingleSegment(validBytes);
});

test("openDynamic round-trips a valid single-segment message", () => {
  const dyn = openDynamic(cpp, PrimitivesSchema, validBytes);
  assert.equal(dyn.get("u8"), 1);
  assert.equal(dyn.get("u16"), 2);
  assert.equal(dyn.get("u32"), 3);
  assert.equal(dyn.get("text"), "hi");
});

test("openDynamicUnsafe round-trips a valid single-segment message", () => {
  const dyn = openDynamicUnsafe(cpp, PrimitivesSchema, validBytes);
  assert.equal(dyn.get("u8"), 1);
  assert.equal(dyn.get("text"), "hi");
});

test("openPrimitives (codegen, safe) round-trips a valid message", () => {
  const r = openPrimitives(cpp, validBytes);
  assert.equal(r.u8, 1);
  assert.equal(r.text, "hi");
});

test("openPrimitivesUnsafe (codegen, unsafe) round-trips a valid message", () => {
  const r = openPrimitivesUnsafe(cpp, validBytes);
  assert.equal(r.u8, 1);
  assert.equal(r.text, "hi");
});

// ---- Multi-segment rejection ------------------------------------------------

// Build a hand-crafted two-segment framed message. Header layout per
// capnp serialize.h:
//   u32 segmentCount - 1
//   u32 segment0 size words
//   u32 segment1 size words
//   u32 padding (4 bytes to word-align the segment table when count is
//   even — count=2 gives table=12 bytes -> need 4 bytes of padding)
//   ...segment0 payload...
//   ...segment1 payload...
function buildTwoSegmentBytes() {
  // segment0: 1 word (the root pointer; we don't need real content for
  // validation; the bytes never reach a decoder)
  // segment1: 1 word (filler)
  const segWords = 1;
  const headerBytes = 16; // 4 (count) + 4*2 (sizes) + 4 (pad) = 16
  const payloadBytes = (segWords + segWords) * 8;
  const total = headerBytes + payloadBytes;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 1, true);   // segmentCount - 1 = 1 -> 2 segments
  dv.setUint32(4, segWords, true);  // segment 0 size
  dv.setUint32(8, segWords, true);  // segment 1 size
  // dv at 12 stays zero (padding)
  return out;
}

test("validateSingleSegment rejects a multi-segment message", () => {
  const bad = buildTwoSegmentBytes();
  assert.throws(
    () => validateSingleSegment(bad),
    (err) => err instanceof MultiSegmentMessageError && /multi-segment/i.test(err.message),
  );
});

test("openDynamic (safe) rejects multi-segment input", () => {
  const bad = buildTwoSegmentBytes();
  assert.throws(
    () => openDynamic(cpp, PrimitivesSchema, bad),
    MultiSegmentMessageError,
  );
});

test("openDynamicUnsafe also rejects multi-segment input", () => {
  // Unsafe refers to reader lifetime, not the input contract. Multi-segment
  // input would still corrupt JS pointer reads, so we reject early.
  const bad = buildTwoSegmentBytes();
  assert.throws(
    () => openDynamicUnsafe(cpp, PrimitivesSchema, bad),
    MultiSegmentMessageError,
  );
});

test("openPrimitives (codegen, safe) rejects multi-segment input", () => {
  const bad = buildTwoSegmentBytes();
  assert.throws(
    () => openPrimitives(cpp, bad),
    MultiSegmentMessageError,
  );
});

test("openPrimitivesUnsafe (codegen, unsafe) rejects multi-segment input", () => {
  const bad = buildTwoSegmentBytes();
  assert.throws(
    () => openPrimitivesUnsafe(cpp, bad),
    MultiSegmentMessageError,
  );
});

// ---- Malformed framed headers ----------------------------------------------

test("validateSingleSegment rejects buffers smaller than the framed header", () => {
  for (const len of [0, 1, 4, 7]) {
    const buf = new Uint8Array(len);
    assert.throws(
      () => validateSingleSegment(buf),
      (err) => err instanceof MultiSegmentMessageError && /too small/i.test(err.message),
      `len=${len}`,
    );
  }
});

test("validateSingleSegment rejects unaligned (non-multiple-of-8) lengths", () => {
  // 12-byte buffer: would-be header says 1 segment, 0 words; total 12 isn't
  // a valid framed length because (12 - 8) is not a multiple of 8.
  const buf = new Uint8Array(12);
  // segmentCount-1 = 0 (single segment), payload says 0 words.
  // Pure-JS validator catches this on the alignment check, before payload-
  // size mismatch.
  assert.throws(
    () => validateSingleSegment(buf),
    (err) => err instanceof MultiSegmentMessageError && /multiple of 8/i.test(err.message),
  );
});

test("validateSingleSegment rejects header/payload size mismatch", () => {
  // 16-byte buffer: header says single-segment with 2 words of payload,
  // but the buffer contains exactly 1 word of payload (16 - 8 = 8 bytes).
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0, true);  // single-segment
  dv.setUint32(4, 2, true);  // claim 2 words but we only have 1
  assert.throws(
    () => validateSingleSegment(buf),
    (err) =>
      err instanceof MultiSegmentMessageError &&
      /declares 2 segment words but payload contains 1/.test(err.message),
  );
});

test("validateSingleSegment accepts an empty single-segment message", () => {
  // segmentCount=1, 0 payload words. This is the degenerate but
  // structurally valid single-segment frame; reject the unaligned/size-
  // mismatch checks but accept the zero-payload case.
  const buf = new Uint8Array(8);
  // Both u32s already zero -> single segment, 0 words. Valid.
  validateSingleSegment(buf);
});

// ---- Error type identity ---------------------------------------------------

test("MultiSegmentMessageError is a real Error subclass", () => {
  const err = new MultiSegmentMessageError("test");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "MultiSegmentMessageError");
  assert.equal(err.message, "test");
});
