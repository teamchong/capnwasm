// capnwasm wire inspector. Standalone, dev-only, never bundled into the
// main capnwasm package. Hosted as a single concatenated file at
// `<docs site>/inspect.js`. The intended use is paste-into-DevTools:
//
//   const cw = await import("https://capnwasm.dev/inspect.js");
//   cw.inspect(fetch("/api/user.capnp"));
//
// `inspect()` accepts a Promise<Response>, Response, ArrayBuffer,
// Uint8Array, or DataView. Whatever you have, it'll figure out and walk
// the framed Cap'n Proto bytes, logging an expandable tree to the
// console and returning the decoded structure for chaining.
//
// Schemaless by default. Walks the wire format using nothing but the
// Cap'n Proto encoding rules, so you don't need the .capnp file or a
// generated reader to see what's in a message. Pass `{ reader: Foo }`
// to use a generated reader instead and get field names back.

const POINTER_STRUCT = 0;
const POINTER_LIST = 1;
const POINTER_FAR = 2;
const POINTER_OTHER = 3;

// Cap'n Proto list element-size enum (the 3-bit field in a list pointer):
//   0 void, 1 1bit, 2 1byte, 3 2byte, 4 4byte, 5 8byte data, 6 ptr, 7 composite
const LIST_KIND_NAMES = ["void", "bit", "u8", "u16", "u32", "u64/f64", "ptr", "composite"];

const SHARED_TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

/**
 * Coerce whatever was passed into a Uint8Array of the framed message bytes.
 * Promises are awaited, Responses are read as ArrayBuffer, ArrayBuffers
 * are wrapped, Uint8Arrays pass through. Anything else throws.
 */
async function coerce(input) {
  if (input == null) {
    throw new TypeError("inspect(): expected bytes / ArrayBuffer / Response / Promise of those, got " + String(input));
  }
  if (typeof input.then === "function") {
    return coerce(await input);
  }
  if (typeof Response !== "undefined" && input instanceof Response) {
    return new Uint8Array(await input.arrayBuffer());
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (input instanceof DataView) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  // Node Buffer (which is a Uint8Array but inheriting through different
  // path in some envs). Already covered by the Uint8Array branch.
  throw new TypeError("inspect(): unsupported input type " + Object.prototype.toString.call(input));
}

/**
 * Parse the framed-message header. Segment count + per-segment word sizes
 * + 8-byte alignment padding. Returns { segments: Uint8Array[], headerBytes }.
 */
function readFrame(bytes) {
  if (bytes.length < 4) {
    throw new Error("not a Cap'n Proto framed message: only " + bytes.length + " bytes");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const segCount = dv.getUint32(off, true) + 1;
  off += 4;
  if (segCount > 512) {
    // Sanity cap. Non-framed bytes will look like a huge segCount and
    // we'd happily try to read N MB of segment-size table.
    throw new Error("segment count " + segCount + " is implausibly large (input probably isn't a Cap'n Proto framed message)");
  }
  const segSizes = new Array(segCount);
  for (let i = 0; i < segCount; i++) {
    if (off + 4 > bytes.length) throw new Error("truncated segment table at segment " + i);
    segSizes[i] = dv.getUint32(off, true);
    off += 4;
  }
  // Pad header to 8-byte boundary. The segCount header word itself is 4B,
  // followed by segCount × 4B sizes; total = (1 + segCount) × 4B. If
  // (1 + segCount) is odd we need 4 bytes of padding to reach 8-byte
  // alignment.
  if ((1 + segCount) % 2 === 1) off += 4;

  const segments = new Array(segCount);
  for (let i = 0; i < segCount; i++) {
    const segBytes = segSizes[i] * 8;
    if (off + segBytes > bytes.length) {
      throw new Error("truncated segment " + i + ": needed " + segBytes + " bytes, only " + (bytes.length - off) + " available");
    }
    segments[i] = bytes.subarray(off, off + segBytes);
    off += segBytes;
  }
  return { segments, headerBytes: 4 + segCount * 4 + ((1 + segCount) % 2 === 1 ? 4 : 0) };
}

/**
 * Walk a pointer. Bottom-of-stack entry. `segIdx` and `wordOff` together
 * locate the 8-byte pointer in the segment array. Returns a JS-shaped
 * description tree.
 *
 * `depth` and `maxDepth` are a guardrail against pathological cycles.
 * Cap'n Proto is acyclic in well-formed messages but a malformed wire
 * blob could loop a far pointer back to itself.
 */
function walkPointer(segments, segIdx, wordOff, depth, maxDepth) {
  if (depth > maxDepth) {
    return { kind: "truncated", reason: "depth limit reached (" + maxDepth + ")" };
  }
  const seg = segments[segIdx];
  if (!seg) return { kind: "error", reason: "segment " + segIdx + " out of range" };
  const byteOff = wordOff * 8;
  if (byteOff + 8 > seg.length) {
    return { kind: "error", reason: "pointer at word " + wordOff + " in segment " + segIdx + " is past end" };
  }
  const dv = new DataView(seg.buffer, seg.byteOffset + byteOff, 8);
  const lo = dv.getUint32(0, true);
  const hi = dv.getUint32(4, true);

  if (lo === 0 && hi === 0) return null;

  const type = lo & 0x3;
  if (type === POINTER_STRUCT) {
    // Sign-extend the 30-bit signed offset.
    const rawOffset = lo >> 2;
    const offset = (rawOffset & 0x20000000) ? rawOffset - 0x40000000 : rawOffset;
    const dataWords = hi & 0xFFFF;
    const ptrWords = (hi >> 16) & 0xFFFF;
    const targetWord = wordOff + 1 + offset;
    return readStruct(segments, segIdx, targetWord, dataWords, ptrWords, depth, maxDepth);
  }
  if (type === POINTER_LIST) {
    const rawOffset = lo >> 2;
    const offset = (rawOffset & 0x20000000) ? rawOffset - 0x40000000 : rawOffset;
    const elementSize = hi & 0x7;
    const elementCount = hi >>> 3;
    const targetWord = wordOff + 1 + offset;
    return readList(segments, segIdx, targetWord, elementSize, elementCount, depth, maxDepth);
  }
  if (type === POINTER_FAR) {
    const padIsDouble = (lo >> 2) & 1;
    const targetWord = lo >>> 3;
    const targetSeg = hi;
    if (padIsDouble) {
      // Double-far pointer. The landing pad is two words: a far pointer
      // that points to the actual content, and a tag that describes the
      // content's structure. Rare; we just chase the inner pointer.
      return walkPointer(segments, targetSeg, targetWord, depth + 1, maxDepth);
    }
    return walkPointer(segments, targetSeg, targetWord, depth + 1, maxDepth);
  }
  // POINTER_OTHER: capabilities, etc.. Report as opaque.
  return { kind: "other", lo: lo.toString(16), hi: hi.toString(16) };
}

function readStruct(segments, segIdx, targetWord, dataWords, ptrWords, depth, maxDepth) {
  const seg = segments[segIdx];
  if (!seg) return { kind: "error", reason: "struct points to missing segment " + segIdx };
  const byteOff = targetWord * 8;
  const dataBytes = dataWords * 8;
  const dataEnd = byteOff + dataBytes;
  const ptrEnd = dataEnd + ptrWords * 8;
  if (ptrEnd > seg.length) {
    return { kind: "error", reason: "struct at word " + targetWord + " extends past segment end" };
  }

  // Show data section both as a hex preview and as parsed words.
  const data = new Uint8Array(seg.buffer, seg.byteOffset + byteOff, dataBytes);
  const dataPreview = previewHex(data);
  const dataWordValues = [];
  if (dataBytes > 0) {
    const dataDv = new DataView(seg.buffer, seg.byteOffset + byteOff, dataBytes);
    for (let i = 0; i < dataWords; i++) {
      const wlo = dataDv.getUint32(i * 8, true);
      const whi = dataDv.getUint32(i * 8 + 4, true);
      const asBigInt = (BigInt(whi) << 32n) | BigInt(wlo);
      dataWordValues.push({
        word: i,
        u64: asBigInt,
        u32lo: wlo,
        u32hi: whi,
      });
    }
  }

  const pointers = [];
  for (let i = 0; i < ptrWords; i++) {
    pointers.push(walkPointer(segments, segIdx, targetWord + dataWords + i, depth + 1, maxDepth));
  }

  return {
    kind: "struct",
    dataWords,
    ptrWords,
    data: dataPreview,
    dataDecoded: dataWordValues,
    pointers,
  };
}

function readList(segments, segIdx, targetWord, elementSize, elementCount, depth, maxDepth) {
  const seg = segments[segIdx];
  if (!seg) return { kind: "error", reason: "list points to missing segment " + segIdx };
  const kind = LIST_KIND_NAMES[elementSize] ?? ("size" + elementSize);

  // Element-size 7 (composite) puts a tag word at the start of the list
  // describing the element shape. The "elementCount" field actually
  // holds the total word count for the list contents (excluding tag).
  if (elementSize === 7) {
    const tagOff = targetWord * 8;
    if (tagOff + 8 > seg.length) {
      return { kind: "error", reason: "composite list tag past segment end" };
    }
    const tagDv = new DataView(seg.buffer, seg.byteOffset + tagOff, 8);
    const tlo = tagDv.getUint32(0, true);
    const thi = tagDv.getUint32(4, true);
    const count = tlo >>> 2;
    const elDataWords = thi & 0xFFFF;
    const elPtrWords = (thi >> 16) & 0xFFFF;
    const items = [];
    const previewLimit = 32;
    const showCount = Math.min(count, previewLimit);
    for (let i = 0; i < showCount; i++) {
      const elWord = targetWord + 1 + i * (elDataWords + elPtrWords);
      items.push(readStruct(segments, segIdx, elWord, elDataWords, elPtrWords, depth + 1, maxDepth));
    }
    return {
      kind: "list",
      elementKind: "struct",
      length: count,
      perElement: { dataWords: elDataWords, ptrWords: elPtrWords },
      items: count > previewLimit ? [...items, "(" + (count - previewLimit) + " more elided)"] : items,
    };
  }

  // Element-size 2 (1 byte) is overwhelmingly used for Text and Data. If
  // the bytes look like UTF-8 text, decode and show the string; otherwise
  // show as a Uint8Array preview.
  if (elementSize === 2) {
    const dataOff = targetWord * 8;
    if (dataOff + elementCount > seg.length) {
      return { kind: "error", reason: "byte list extends past segment end" };
    }
    const bytes = new Uint8Array(seg.buffer, seg.byteOffset + dataOff, elementCount);
    // Cap'n Proto Text has a trailing NUL in the wire size; trim it for
    // display so the string doesn't end with `\0`.
    const trimmed = bytes.length > 0 && bytes[bytes.length - 1] === 0 ? bytes.subarray(0, bytes.length - 1) : bytes;
    const looksLikeText = trimmed.length === 0 || trimmed.every((b) => b >= 0x20 && b < 0x7f) || isProbablyUtf8(trimmed);
    if (looksLikeText) {
      try {
        return {
          kind: "text",
          length: trimmed.length,
          value: SHARED_TEXT_DECODER.decode(trimmed),
        };
      } catch {
        // Fall through to bytes view.
      }
    }
    return {
      kind: "bytes",
      length: bytes.length,
      preview: previewHex(bytes),
    };
  }

  // Primitive lists 1/3/4/5: show preview values.
  const elementBits = [0, 1, 8, 16, 32, 64, 64, 0][elementSize];
  const totalBits = elementBits * elementCount;
  const totalBytes = (totalBits + 7) >>> 3;
  const dataOff = targetWord * 8;
  if (dataOff + totalBytes > seg.length) {
    return { kind: "error", reason: "primitive list extends past segment end" };
  }
  const previewLimit = 32;
  const showCount = Math.min(elementCount, previewLimit);
  const items = new Array(showCount);
  if (elementSize === 1) {
    for (let i = 0; i < showCount; i++) {
      items[i] = ((seg[dataOff + (i >>> 3)] >> (i & 7)) & 1) === 1;
    }
  } else if (elementSize === 3) {
    const dv = new DataView(seg.buffer, seg.byteOffset + dataOff, totalBytes);
    for (let i = 0; i < showCount; i++) items[i] = dv.getUint16(i * 2, true);
  } else if (elementSize === 4) {
    const dv = new DataView(seg.buffer, seg.byteOffset + dataOff, totalBytes);
    for (let i = 0; i < showCount; i++) items[i] = dv.getUint32(i * 4, true);
  } else if (elementSize === 5) {
    const dv = new DataView(seg.buffer, seg.byteOffset + dataOff, totalBytes);
    for (let i = 0; i < showCount; i++) {
      const lo = dv.getUint32(i * 8, true);
      const hi = dv.getUint32(i * 8 + 4, true);
      items[i] = (BigInt(hi) << 32n) | BigInt(lo);
    }
  } else if (elementSize === 6) {
    // pointer list
    for (let i = 0; i < showCount; i++) {
      items[i] = walkPointer(segments, segIdx, targetWord + i, depth + 1, maxDepth);
    }
  }
  return {
    kind: "list",
    elementKind: kind,
    length: elementCount,
    items: elementCount > previewLimit ? [...items, "(" + (elementCount - previewLimit) + " more elided)"] : items,
  };
}

/**
 * Lightweight UTF-8 validity check on the first 64 bytes. Misclassification
 * is acceptable: TextDecoder with `fatal: false` will never throw, so the
 * worst case is we hand a bytes view to a string field. Errs on the side
 * of "show as bytes" for anything ambiguous.
 */
function isProbablyUtf8(bytes) {
  const limit = Math.min(bytes.length, 64);
  let i = 0;
  while (i < limit) {
    const b = bytes[i];
    if (b < 0x80) { i++; continue; }
    if ((b & 0xE0) === 0xC0) {
      if (i + 1 >= bytes.length || (bytes[i + 1] & 0xC0) !== 0x80) return false;
      i += 2;
    } else if ((b & 0xF0) === 0xE0) {
      if (i + 2 >= bytes.length || (bytes[i + 1] & 0xC0) !== 0x80 || (bytes[i + 2] & 0xC0) !== 0x80) return false;
      i += 3;
    } else if ((b & 0xF8) === 0xF0) {
      if (i + 3 >= bytes.length || (bytes[i + 1] & 0xC0) !== 0x80 || (bytes[i + 2] & 0xC0) !== 0x80 || (bytes[i + 3] & 0xC0) !== 0x80) return false;
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

function previewHex(bytes) {
  const max = 32;
  const slice = bytes.length > max ? bytes.subarray(0, max) : bytes;
  let s = "";
  for (let i = 0; i < slice.length; i++) {
    s += slice[i].toString(16).padStart(2, "0") + (i + 1 < slice.length ? " " : "");
  }
  if (bytes.length > max) s += "  …(+" + (bytes.length - max) + " more)";
  return s;
}

/**
 * Inspect a Cap'n Proto framed message. Logs an expandable tree to the
 * console and returns the decoded structure for chaining.
 *
 * @param input Promise<Response> | Response | ArrayBuffer | Uint8Array | DataView
 * @param opts  { reader?: GeneratedReaderClass, cpp?: CapnCpp,
 *                label?: string, log?: boolean }
 *              reader: optional codegen-generated reader for schema-aware decode
 *              cpp:    a loaded CapnCpp instance. Required when `reader` is set,
 *                      since the schema-aware path goes through wasm
 *              label:  optional string shown in the console group header
 *              log:    set false to skip the console.group dump and only
 *                      return the decoded value. Defaults to true.
 */
export async function inspect(input, opts = {}) {
  const bytes = await coerce(input);
  const label = opts.label ?? "Cap'n Proto frame";
  const log = opts.log !== false;

  // Schema-aware path. Delegate to a generated reader. Requires a loaded
  // CapnCpp instance because the reader reads through wasm.
  if (opts.reader) {
    if (!opts.cpp) {
      throw new Error("inspect({ reader }) also needs `{ cpp }`. Pass the loaded CapnCpp instance so the reader can decode through wasm");
    }
    const reader = opts.reader;
    if (typeof reader._FIELDS !== "object") {
      throw new Error("inspect(): reader doesn't look like a capnwasm-codegen reader (no static _FIELDS)");
    }
    const cpp = opts.cpp;
    if (bytes.length > cpp._exports.cpp_in_capacity()) {
      throw new Error("inspect(): payload " + bytes.length + " B exceeds wasm scratch buffer");
    }
    const u8 = cpp._u8;
    u8.set(bytes, cpp._inPtr);
    // cpp_any_open returns the data section pointer (or 0 for empty).
    // Pass it through to the Reader for direct primitive reads.
    const dataPtr = cpp._exports.cpp_any_open(bytes.length);
    const r = new reader(cpp, dataPtr);
    const obj = {};
    for (const name of Object.keys(reader._FIELDS)) {
      try {
        obj[name] = r[name];
      } catch (err) {
        obj[name] = "<read error: " + err.message + ">";
      }
    }
    if (log) {
      console.group("%c" + label + " %c" + bytes.length + " bytes (schema)", "color:#4fc3f7;font-weight:600", "color:#888");
      console.log(obj);
      console.groupEnd();
    }
    return obj;
  }

  // Schemaless path. Walk the wire directly.
  let frame, root;
  try {
    frame = readFrame(bytes);
    root = walkPointer(frame.segments, 0, 0, 0, 16);
  } catch (err) {
    if (log) console.error("[capnwasm/inspect] " + err.message);
    throw err;
  }
  const decoded = {
    bytes: bytes.length,
    segments: frame.segments.map((s, i) => ({ index: i, words: s.length / 8, bytes: s.length })),
    root,
  };
  if (log) {
    console.group("%c" + label + " %c" + bytes.length + " bytes, " + frame.segments.length + " segment(s)", "color:#4fc3f7;font-weight:600", "color:#888");
    console.log(decoded);
    console.groupEnd();
  }
  return decoded;
}

// Convenience: decode a Response body directly. Same as inspect(response).
export async function inspectResponse(response, opts) {
  return inspect(response, opts);
}

// Convenience: decode a Promise<Response> from fetch. Same as inspect(fetchPromise).
export async function inspectFetch(fetchPromise, opts) {
  return inspect(fetchPromise, opts);
}

// ---- Copy-paste-from-DevTools entry points -----------------------------
//
// The Network panel's "Copy response" gives you a base64 string for
// binary bodies; the WebSocket Frames tab shows individual frames you
// can copy as hex. Both entry points decode whatever you pasted, then
// route into the standard inspect() pipeline.
//
// Workflow:
//   DevTools Network panel → right-click a capnp response → Copy response
//   → paste into console:
//     cw.inspectBase64("CAAAAAYAAAA...")
//
//   DevTools WS panel → right-click a frame → Copy
//   → paste into console:
//     cw.inspectHex("08 00 00 00 06 00 00 00 ...")

/**
 * Decode a base64-encoded capnp message and inspect. Whitespace and
 * newlines are tolerated (DevTools "Copy response" sometimes wraps).
 * Both standard and URL-safe base64 are accepted.
 */
export async function inspectBase64(b64, opts) {
  if (typeof b64 !== "string") {
    throw new TypeError("inspectBase64(): expected base64 string, got " + typeof b64);
  }
  const cleaned = b64.replace(/[\s\n\r]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  let bytes;
  try {
    if (typeof atob === "function") {
      const bin = atob(cleaned);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      // Node fallback. Browsers always have atob.
      bytes = new Uint8Array(Buffer.from(cleaned, "base64"));
    }
  } catch (err) {
    throw new Error(
      "inspectBase64(): failed to decode base64 (" + (err?.message ?? err) + "). " +
      "Make sure you copied the response body, not the response headers / cURL line."
    );
  }
  return inspect(bytes, opts);
}

/**
 * Decode a hex-encoded capnp message and inspect. Tolerates spaces,
 * commas, "0x" prefixes, and newlines, so you can paste DevTools'
 * various hex formats verbatim.
 */
export async function inspectHex(hex, opts) {
  if (typeof hex !== "string") {
    throw new TypeError("inspectHex(): expected hex string, got " + typeof hex);
  }
  const cleaned = hex.replace(/0x/gi, "").replace(/[\s,;:]+/g, "").toLowerCase();
  if (cleaned.length === 0) throw new Error("inspectHex(): empty input after cleaning");
  if (cleaned.length % 2 !== 0) {
    throw new Error("inspectHex(): odd number of hex digits (" + cleaned.length + "); did you copy a partial byte?");
  }
  if (!/^[0-9a-f]+$/.test(cleaned)) {
    throw new Error("inspectHex(): non-hex characters in input. Strip non-hex prefixes / suffixes before pasting.");
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return inspect(bytes, opts);
}
