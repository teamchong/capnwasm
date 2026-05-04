// M5: Pure-JS Cap'n Proto pointer decoder.
//
// Pre-M5, every pointer-field access (Text, Data, primitive list
// elements) crossed into wasm via cpp_any_text_at / cpp_any_data_at /
// cpp_any_list_get_*. The C++ side decoded the pointer, walked the
// segment, and copied the bytes into cpp_out for JS to read.
//
// M5 implements pointer decoding in JS, reading directly from the
// message bytes inside WebAssembly.Memory. No boundary call, no copy,
// no scratch indirection. The wasm runtime is still required to
// (a) acquire / release reader slots (M3), (b) handle nested struct
// navigation (cpp_any_enter_struct), and (c) serve as a fallback for
// edge cases this decoder does not yet implement (FAR pointers,
// multi-segment messages -- M1 rejects those at open time so they
// only show up in unsafe-path messages, and List<Struct> beyond a
// shallow depth).
//
// Cap'n Proto wire format reference:
//   https://capnproto.org/encoding.html
//   cpp/vendor/capnp/layout.c++ (the upstream C++ implementation we
//   stay byte-for-byte compatible with)
//
// Pointer (8 bytes / 1 word):
//   word0 (bytes 0..3): (offset << 2) | kind
//     kind 0 = STRUCT, kind 1 = LIST, kind 2 = FAR, kind 3 = OTHER
//     offset is signed 30-bit, in words, from the *end* of this pointer
//   word1 (bytes 4..7): kind-specific
//     STRUCT: data_size_words : u16 | ptr_size_words : u16
//     LIST:   (element_count << 3) | element_size : 3 bits
//             element_size: 0=VOID, 1=BIT, 2=BYTE, 3=2B, 4=4B, 5=8B,
//                           6=POINTER, 7=INLINE_COMPOSITE
//
// Single-segment ABI (M1) means the pointer's offset always lands
// inside the same byte buffer; FAR pointers (kind 2) cannot validly
// appear in M1-validated input. This decoder rejects FAR with
// `undefined`, which the codegen-emitted getter treats as "fall back
// to C++". That keeps unsafe-path / pre-M1 / hand-built test bytes
// working through the C++ decoder.

const SHARED_DECODER = new TextDecoder();

// M7: Hardening notes.
//
// The wasm sandbox already prevents out-of-process memory corruption:
// any load outside [0, memory.size) traps. What it does NOT prevent
// is a hostile pointer that aims past msgEnd but still inside the
// wasm linear memory -- the load succeeds and returns unrelated bytes
// (another slot's buffer, the arena's stale data, etc.). That is an
// information-disclosure bug from the application's view, not a
// memory-safety one from wasm's view.
//
// The defenses live in the existing bounds checks on every decoder
// entry point: `target < msgStart || target + count > msgEnd` is
// what gates each pointer dereference. msgEnd is set per-slot from
// the message's byte length at acquire time, so it's bounded by the
// wasm-side allocation regardless of what a hostile pointer claims.
// JS Number arithmetic is exact below 2^53 so multiplications like
// `count * 8` do not silently wrap; if they exceed msgEnd, the check
// rejects them as undefined and codegen falls back to the C++
// FlatArrayMessageReader, which has its own KJ_REQUIRE bounds checks
// and surfaces failures as wasm traps the host can catch.
//
// We deliberately do NOT add separate MAX_LIST_ELEMENTS or
// MAX_PAYLOAD_BYTES caps in this module. They would be redundant
// with the bounds check (you can't claim more bytes than fit in the
// message) and add a paranoia surface that complicates conformance
// against upstream capnp. The M7 work that goes alongside this
// comment is a hostile-input test corpus that exercises every
// rejection path end-to-end (test/m7_hostile_input.test.mjs).

// Read a Text field from a struct's pointer section. Returns:
//   string  -- successful decode (UTF-8). Empty string if the text
//              pointer points at a 1-byte NUL.
//   null    -- the pointer is null (Cap'n Proto's "default" for Text
//              with no explicit default value).
//   undefined -- something this decoder does not handle (FAR, OTHER,
//                wrong list element size, out-of-bounds offset).
//                Caller should fall back to the C++ decoder.
//
// Args:
//   u8       Uint8Array view of WebAssembly.Memory.
//   dv       DataView over the same buffer (re-used per reader).
//   dataPtr  Byte address (in linear memory) of the *struct's data
//            section* -- not the message base. The pointer section
//            starts at dataPtr + dataWords*8.
//   dataWords  Static, from the struct's _DATA_WORDS.
//   ptrIndex   Pointer slot index (0-based).
//   msgStart   Byte address of the message's first segment payload
//              (8 bytes after the framed header). Used for bounds
//              checks: any decoded offset must land inside
//              [msgStart, msgEnd).
//   msgEnd     Byte address of the end of the message bytes.
export function readTextPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  const kind = word0 & 3;
  if (kind !== 1) return undefined; // not a list (Text is List(Byte))
  // word0 >> 2 with sign extension. Use Int32 view via shift trick:
  // Cap'n Proto offset is the high 30 bits of word0, signed.
  const offset = (dv.getInt32(ptrAddr, true) >> 2);
  const elemSize = word1 & 7;
  const count = word1 >>> 3;
  if (elemSize !== 2) return undefined; // not BYTE
  // count includes the trailing NUL. count == 0 is invalid for text
  // (capnp.org spec; the C++ FlatArrayMessageReader treats that as
  // an empty-text default pointer).
  if (count === 0) return undefined;
  // Target = (ptrAddr + 8) + offset*8.
  const target = ptrAddr + 8 + offset * 8;
  if (target < msgStart || target + count > msgEnd) return undefined;
  // Length excludes the NUL terminator.
  const len = count - 1;
  if (len === 0) return "";
  return SHARED_DECODER.decode(u8.subarray(target, target + len));
}

// Read a Data field. Same wire shape as Text but no NUL terminator
// rule -- the byte count is the data length verbatim.
//
// Returns:
//   Uint8Array -- a *copy* of the data bytes (slice). Cap'n Proto
//                 readers conventionally hand back independent buffers
//                 because the underlying wasm memory may move.
//   null       -- null pointer.
//   undefined  -- fallback case; same reasons as readTextPtr.
export function readDataPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  const kind = word0 & 3;
  if (kind !== 1) return undefined;
  const offset = (dv.getInt32(ptrAddr, true) >> 2);
  const elemSize = word1 & 7;
  const count = word1 >>> 3;
  if (elemSize !== 2) return undefined;
  const target = ptrAddr + 8 + offset * 8;
  if (target < msgStart || target + count > msgEnd) return undefined;
  // Independent copy via slice -- callers expect a stable buffer.
  return u8.slice(target, target + count);
}

// Read a primitive list pointer. Returns an object describing the
// list so the per-element accessors (readListUint32At, etc.) can read
// directly without re-decoding the pointer on every access. Returns
// null for null pointers, undefined for fallback.
//
// The returned descriptor:
//   { target, count, elemSize }
// where target is the first element's byte address, count is the
// element count, and elemSize is the Cap'n Proto ElementSize enum
// value (1=BIT, 2=BYTE, 3=2B, 4=4B, 5=8B). The caller checks
// elemSize matches the expected element width before reading.
export function readListPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  const kind = word0 & 3;
  if (kind !== 1) return undefined;
  const offset = (dv.getInt32(ptrAddr, true) >> 2);
  const elemSize = word1 & 7;
  const count = word1 >>> 3;
  // INLINE_COMPOSITE (7) has a different layout (tag word + struct
  // elements). Skip in M5; codegen falls back to C++ for List<Struct>.
  if (elemSize === 0 || elemSize === 6 || elemSize === 7) return undefined;
  const target = ptrAddr + 8 + offset * 8;
  // Width per element:
  //   1=BIT (count is bit count, byte size = ceil(count/8))
  //   2=BYTE -> 1 byte each
  //   3=TWO_BYTES -> 2
  //   4=FOUR_BYTES -> 4
  //   5=EIGHT_BYTES -> 8
  let byteLen;
  if (elemSize === 1) byteLen = (count + 7) >>> 3;
  else if (elemSize === 2) byteLen = count;
  else if (elemSize === 3) byteLen = count * 2;
  else if (elemSize === 4) byteLen = count * 4;
  else byteLen = count * 8;
  if (target < msgStart || target + byteLen > msgEnd) return undefined;
  return { target, count, elemSize };
}

// Per-element primitive list reads. Each takes a list descriptor
// from readListPtr plus an index. They assume the descriptor's
// elemSize is correct -- caller verifies before constructing the
// per-element loop.

export function readListUint8(dv, list, i) {
  return dv.getUint8(list.target + i);
}
export function readListUint16(dv, list, i) {
  return dv.getUint16(list.target + i * 2, true);
}
export function readListUint32(dv, list, i) {
  return dv.getUint32(list.target + i * 4, true);
}
export function readListUint64(dv, list, i) {
  return dv.getBigUint64(list.target + i * 8, true);
}
export function readListInt8(dv, list, i) {
  return dv.getInt8(list.target + i);
}
export function readListInt16(dv, list, i) {
  return dv.getInt16(list.target + i * 2, true);
}
export function readListInt32(dv, list, i) {
  return dv.getInt32(list.target + i * 4, true);
}
export function readListInt64(dv, list, i) {
  return dv.getBigInt64(list.target + i * 8, true);
}
export function readListFloat32(dv, list, i) {
  return dv.getFloat32(list.target + i * 4, true);
}
export function readListFloat64(dv, list, i) {
  return dv.getFloat64(list.target + i * 8, true);
}
export function readListBool(dv, list, i) {
  // BIT list: each element is one bit, lsb-first within each byte.
  const byte = dv.getUint8(list.target + (i >>> 3));
  return ((byte >> (i & 7)) & 1) === 1;
}

// M5.5: Read a List<Struct> pointer (INLINE_COMPOSITE element layout).
//
// The wire format is:
//   pointer word at ptrAddr:
//     kind = LIST (1)
//     elemSize = INLINE_COMPOSITE (7)
//     count = total *word* count of the element data (not element count)
//   target word (ptrAddr + 8 + offset*8): a "tag word" formatted as a
//     STRUCT WirePointer:
//       offsetAndKind: low 2 bits = 0 (STRUCT), high 30 bits = element count
//       word1 lo u16: dataWords per element
//       word1 hi u16: ptrWords per element
//   followed by `elementCount` elements, each (dataWords + ptrWords) * 8 bytes.
//
// Returns:
//   { elementsBase, count, dataWords, ptrWords } on success
//   null on null pointer
//   undefined on FAR / OTHER / wrong kind / out-of-bounds (caller falls
//   back to C++)
//
// The returned descriptor is enough for callers to compute the i-th
// element's data section pointer:
//     elementDataPtr(i) = elementsBase + i * (dataWords + ptrWords) * 8
// and read primitive fields from it directly. Pointer-section fields
// of an element use the same readTextPtr / readDataPtr / readListPtr
// machinery, with the element's dataPtr and the element's dataWords.
export function readListStructPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  const kind = word0 & 3;
  if (kind !== 1) return undefined;            // not a list
  const elemSize = word1 & 7;
  if (elemSize !== 7) return undefined;        // not INLINE_COMPOSITE
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  const wordCount = word1 >>> 3;               // total element-data word count
  const target = ptrAddr + 8 + offset * 8;
  if (target < msgStart || target + 8 > msgEnd) return undefined;
  // Tag word.
  const tag0 = dv.getUint32(target, true);
  if ((tag0 & 3) !== 0) return undefined;      // tag must encode STRUCT
  const elementCount = (tag0 >>> 2);
  const tagDataWords = dv.getUint16(target + 4, true);
  const tagPtrWords = dv.getUint16(target + 6, true);
  const wordsPerElement = tagDataWords + tagPtrWords;
  // Sanity check: pointer's wordCount must equal elementCount * wordsPerElement.
  // capnp encoders enforce this; rejection means corrupt or unsupported input.
  if (wordsPerElement * elementCount !== wordCount) return undefined;
  const elementsBase = target + 8;
  const totalBytes = elementCount * wordsPerElement * 8;
  if (elementsBase + totalBytes > msgEnd) return undefined;
  return {
    elementsBase,
    count: elementCount,
    dataWords: tagDataWords,
    ptrWords: tagPtrWords,
  };
}

// Compute the byte address of the i-th element's data section in a
// List<Struct>. Cheap; just an arithmetic step. Caller passes the
// descriptor from readListStructPtr.
export function listStructElementDataPtr(list, i) {
  return list.elementsBase + i * (list.dataWords + list.ptrWords) * 8;
}
