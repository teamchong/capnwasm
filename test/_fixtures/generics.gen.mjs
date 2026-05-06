// Generated from generics.capnp by capnwasm-gen. Do not edit by hand.

const SHARED_TEXT_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();
function decodeAscii(bytes) {
  return SHARED_TEXT_DECODER.decode(bytes);
}

function _jsReadTextPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  return _jsReadTextPtrAt(u8, dv, ptrAddr, msgStart, msgEnd);
}

function _jsReadDataPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  return _jsReadDataPtrAt(u8, dv, ptrAddr, msgStart, msgEnd);
}

function _jsReadListPointerPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return { elementsBase: 0, count: 0 };
  if ((word0 & 3) !== 1) return undefined;
  if ((word1 & 7) !== 6) return undefined;
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  const count = word1 >>> 3;
  const elementsBase = ptrAddr + 8 + offset * 8;
  if (elementsBase < msgStart || elementsBase + count * 8 > msgEnd) return undefined;
  return { elementsBase, count };
}

function _jsReadTextPtrAt(u8, dv, ptrAddr, msgStart, msgEnd) {
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  if ((word0 & 3) !== 1) return undefined;
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  if ((word1 & 7) !== 2) return undefined;
  const count = word1 >>> 3;
  if (count === 0) return undefined;
  const target = ptrAddr + 8 + offset * 8;
  if (target < msgStart || target + count > msgEnd) return undefined;
  const len = count - 1;
  if (len === 0) return "";
  return SHARED_TEXT_DECODER.decode(u8.subarray(target, target + len));
}

function _jsReadDataPtrAt(u8, dv, ptrAddr, msgStart, msgEnd) {
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  if ((word0 & 3) !== 1) return undefined;
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  if ((word1 & 7) !== 2) return undefined;
  const count = word1 >>> 3;
  const target = ptrAddr + 8 + offset * 8;
  if (target < msgStart || target + count > msgEnd) return undefined;
  return u8.slice(target, target + count);
}

const _ELEM_BYTES_TO_SIZE_CODE = { 1: 2, 2: 3, 4: 4, 8: 5 };
function _jsReadListPrimPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd, elemBytes) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return { elementsBase: 0, count: 0 };
  if ((word0 & 3) !== 1) return undefined;
  const elemSizeCode = word1 & 7;
  const expectedCode = _ELEM_BYTES_TO_SIZE_CODE[elemBytes];
  if (elemSizeCode !== expectedCode) return undefined;
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  const elementCount = word1 >>> 3;
  const elementsBase = ptrAddr + 8 + offset * 8;
  if (elementsBase + elementCount * elemBytes > msgEnd) return undefined;
  if (elementsBase < msgStart) return undefined;
  return { elementsBase, count: elementCount };
}

function _jsReadStructPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  if ((word0 & 3) !== 0) return undefined;
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  const dWords = word1 & 0xffff;
  const pWords = (word1 >>> 16) & 0xffff;
  const target = ptrAddr + 8 + offset * 8;
  const totalBytes = (dWords + pWords) * 8;
  if (target < msgStart || target + totalBytes > msgEnd) return undefined;
  return { dataPtr: target, dataWords: dWords, ptrWords: pWords };
}

function _jsReadListStructPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  const word0 = dv.getUint32(ptrAddr, true);
  const word1 = dv.getUint32(ptrAddr + 4, true);
  if (word0 === 0 && word1 === 0) return null;
  if ((word0 & 3) !== 1) return undefined;
  if ((word1 & 7) !== 7) return undefined;
  const offset = dv.getInt32(ptrAddr, true) >> 2;
  const wordCount = word1 >>> 3;
  const target = ptrAddr + 8 + offset * 8;
  if (target < msgStart || target + 8 > msgEnd) return undefined;
  const tag0 = dv.getUint32(target, true);
  if ((tag0 & 3) !== 0) return undefined;
  const elementCount = tag0 >>> 2;
  const tagDataWords = dv.getUint16(target + 4, true);
  const tagPtrWords = dv.getUint16(target + 6, true);
  const wordsPerElement = tagDataWords + tagPtrWords;
  if (wordsPerElement * elementCount !== wordCount) return undefined;
  const elementsBase = target + 8;
  if (elementsBase + elementCount * wordsPerElement * 8 > msgEnd) return undefined;
  return { elementsBase, count: elementCount, dataWords: tagDataWords, ptrWords: tagPtrWords };
}

class _AnyPointerReadHandle {
  constructor(parent, parentDataWords, ptrIndex) {
    this._parent = parent;
    this._parentDataWords = parentDataWords;
    this._ptrIndex = ptrIndex;
  }
  /** Returns the AnyPointer slot interpreted as Text, or null when the slot is null. */
  asText() {
    _ensureCapnwasmReader(this._parent);
    const p = this._parent;
    const v = _jsReadTextPtr(p._u8, p._dv, p._dataPtr, this._parentDataWords, this._ptrIndex, p._msgStart, p._msgEnd);
    if (v !== undefined) return v ?? "";
    const len = p._cpp._exports.cpp_any_text_at(this._ptrIndex);
    if (len === 0) return "";
    const out = p._cpp._outPtr;
    return decodeAscii(p._cpp._u8.subarray(out, out + len));
  }
  /** Returns the AnyPointer slot as a Uint8Array (Data), or an empty array. */
  asData() {
    _ensureCapnwasmReader(this._parent);
    const p = this._parent;
    const v = _jsReadDataPtr(p._u8, p._dv, p._dataPtr, this._parentDataWords, this._ptrIndex, p._msgStart, p._msgEnd);
    if (v !== undefined) return v ?? new Uint8Array(0);
    const len = p._cpp._exports.cpp_any_data_at(this._ptrIndex);
    const out = p._cpp._outPtr;
    return p._cpp._u8.slice(out, out + len);
  }
  /** Decode the slot as a struct of the given Reader class. Pass the codegen reader class. */
  asStruct(ReaderClass) {
    _ensureCapnwasmReader(this._parent);
    const p = this._parent;
    const cpp = p._cpp;
    const _msgStart = p._msgStart, _msgEnd = p._msgEnd;
    const rebind = () => {
      _ensureCapnwasmReader(p);
      cpp._exports.cpp_any_slot_reset_root?.();
      cpp._exports.cpp_any_enter_struct(this._ptrIndex);
      cpp._bumpGeneration();
    };
    if (_msgEnd) {
      const desc = _jsReadStructPtr(p._u8, p._dv, p._dataPtr, this._parentDataWords, this._ptrIndex, _msgStart, _msgEnd);
      if (desc !== undefined) {
        const dp = desc === null ? 0 : desc.dataPtr;
        return new ReaderClass(cpp, dp, {
          slotIdx: p._slotIdx,
          msgStart: _msgStart,
          msgEnd: _msgEnd,
          gen: -1,
          parent: p,
          rebind,
        });
      }
    }
    rebind();
    return new ReaderClass(cpp, 0, {
      msg: p._msg,
      slotIdx: p._slotIdx,
      gen: cpp._generation ?? 0,
      rebind,
    });
  }
}

const _F32_VIEW_BUF = new ArrayBuffer(4);
const _F32_VIEW_U32 = new Uint32Array(_F32_VIEW_BUF);
const _F32_VIEW_F32 = new Float32Array(_F32_VIEW_BUF);
const _F64_VIEW_BUF = new ArrayBuffer(8);
const _F64_VIEW_U32 = new Uint32Array(_F64_VIEW_BUF);
const _F64_VIEW_F64 = new Float64Array(_F64_VIEW_BUF);

const _LIST_HELPERS = {
  TD: SHARED_TEXT_DECODER,
  F32U: _F32_VIEW_U32, F32F: _F32_VIEW_F32,
  F64U: _F64_VIEW_U32, F64F: _F64_VIEW_F64,
};

// Per-(class, field-list) cache of pre-encoded request bytes. Compiling the
// request is a tight loop but it's still wasted work in a hot pick loop.
// We key on a frozen Uint8Array of the descriptor bytes so identical field
// sets (the common case in batch processing) hit the cache.
const _PICK_REQ_CACHE = new WeakMap();  // fields -> Map<namesKey, Uint8Array>
const _DRAFT_PLAN_CACHE = new WeakMap(); // fields -> WeakMap<fn, plan>

function _getPickRequest(fields, names) {
  let perFields = _PICK_REQ_CACHE.get(fields);
  if (!perFields) { perFields = new Map(); _PICK_REQ_CACHE.set(fields, perFields); }
  const key = names.join("\0");
  let entry = perFields.get(key);
  if (entry) return entry;
  const buf = new Uint8Array(4 + names.length * 5);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, names.length, true);
  // Precompute the field-descriptor array alongside the request bytes. Both
  // are pure functions of (fields, names); caching them together means the
  // hot pick path skips a names.length-iteration property-lookup loop on
  // every call. The cached entry shape is { req, descs, listDecoder } where
  // listDecoder is lazily compiled the first time a List(Struct) projection
  // hits this field-set (most Pick callers never trigger it).
  const descs = new Array(names.length);
  let pos = 4;
  for (let i = 0; i < names.length; i++) {
    const d = fields[names[i]];
    if (!d) throw new Error("unknown field: " + names[i]);
    descs[i] = d;
    buf[pos] = d.kind; pos += 1;
    dv.setUint32(pos, d.off, true); pos += 4;
  }
  entry = { req: buf, descs, listDecoder: null };
  perFields.set(key, entry);
  return entry;
}

// Build a specialized JS function that decodes a row-tape produced by
// cpp_any_list_project into an Array of plain row objects, with the
// per-cell switch dispatch fully unrolled.
//
// The unrolled body lets V8 emit a single inline-cache chain per row, gives
// the row a stable hidden class via an object literal with all fields named
// in declaration order, and removes the per-cell descs[]/names[] indexing.
//
// Compiled once per (fields, names) pair, then cached on the same entry
// the request bytes live on. Roughly halves JS materialization cost vs the
// generic switch loop on the list-1000 user-row workload.
function _compileListDecoder(descs, names, applyMapFn, filter) {
  const cols = descs.length;
  const rowStride = cols * 4;
  // Validate filter: predicate field must be in projected names AND of a type
  // we know how to fast-check from a single header. For now we only support
  // boolean fields (cell is 0 or 1). If unsupported, drop filter — decoder
  // becomes the no-filter variant and the caller's outer fn re-runs filter
  // in JS. Correctness preserved.
  let filterColIdx = -1;
  if (filter) {
    filterColIdx = names.indexOf(filter.field);
    if (filterColIdx < 0 || (descs[filterColIdx] && descs[filterColIdx].type !== "bool")) {
      filter = null;
      filterColIdx = -1;
    }
  }
  // Identify runs of consecutive text fields (>=2) that share a contiguous
  // payload region — i.e. no payload-emitting field appears between them.
  // For such runs we emit ONE TextDecoder.decode call per row covering the
  // entire payload, then substring() per field. V8's substring on a freshly
  // decoded string is cheap, while each TextDecoder.decode has setup cost.
  // Measured on the 4-field user-row workload: this halves text-decode time
  // and shaves ~30% off list-1000 materialization.
  const PAYLOAD_BREAK = new Set(["uint64", "int64", "float64", "data"]);
  const isTextRunMember = (i) => descs[i] && descs[i].type === "text";
  const sharedTextEligible = descs.some((d) => d && d.type === "text") &&
    descs.every((d) => d && !PAYLOAD_BREAK.has(d.type));
  const textBatch = new Array(cols).fill(null);
  for (let i = 0; i < cols; i++) {
    if (!isTextRunMember(i) || textBatch[i] !== null) continue;
    let j = i + 1;
    while (j < cols) {
      if (isTextRunMember(j)) { j++; continue; }
      if (PAYLOAD_BREAK.has(descs[j] && descs[j].type)) break;
      j++;
    }
    // j is one past the last index that belongs to this run, considering
    // non-payload-emitting fields between text fields (small scalars / bool).
    // Filter run members back to actual text indices for emission.
    const members = [];
    for (let k = i; k < j; k++) if (isTextRunMember(k)) members.push(k);
    if (members.length >= 2) {
      // Tag each member with a shared run id and its position in the run.
      const runId = i;
      for (let p = 0; p < members.length; p++) {
        textBatch[members[p]] = { runId, pos: p, total: members.length, members };
      }
    }
  }
  const out = [];
  out.push(`const TD = H.TD;`);
  out.push(`const F32U = H.F32U, F32F = H.F32F, F64U = H.F64U, F64F = H.F64F;`);
  out.push(`if (start === undefined) start = 0;`);
  out.push(`if (limit === undefined) limit = rows;`);
  out.push(`if (limit > rows) limit = rows;`);
  out.push(`if (start > limit) start = limit;`);
  out.push(`const arr = new Array(limit - start);`);
  if (filter) out.push(`let arrIdx = 0;`);
  out.push(`let readPos = 8 + rows * ${rowStride};`);
  if (sharedTextEligible) {
    // If this projection's payload section contains only text bytes (no data
    // blobs or 64-bit scalar payloads) and those bytes are ASCII, decode the
    // whole payload once and slice substrings by byte offset. For non-ASCII,
    // fall back to the existing per-field decode so UTF-8 byte offsets never
    // get mistaken for JS string indices.
    out.push(`const _payloadStart = readPos;`);
    out.push(`let _sharedText = null;`);
    out.push(`{`);
    out.push(`  const _payloadEnd = dv.byteLength;`);
    out.push(`  let _ascii = true;`);
    out.push(`  for (let _p = _payloadStart; _p < _payloadEnd; _p++) {`);
    out.push(`    if (u8[out + _p] & 0x80) { _ascii = false; break; }`);
    out.push(`  }`);
    out.push(`  if (_ascii) _sharedText = TD.decode(u8.subarray(out + _payloadStart, out + _payloadEnd));`);
    out.push(`}`);
  }
  // Skip phase: when start > 0 we walk rows [0, start) advancing readPos by
  // the payload size of each row but never materializing. Each text/data
  // field contributes its header value (or 0 for missing); each
  // u64/i64/f64 contributes 8; smaller scalars and booleans contribute 0.
  // Specialized at codegen time so V8 sees a straight-line skip body.
  out.push(`for (let row = 0; row < start; row++) {`);
  out.push(`  const cellBase = 8 + row * ${rowStride};`);
  for (let col = 0; col < cols; col++) {
    const d = descs[col];
    const headerOff = `cellBase + ${col * 4}`;
    if (d.type === "text" || d.type === "data") {
      out.push(`  { const _h = dv.getUint32(${headerOff}, true); if (_h !== 0xFFFFFFFF) readPos += _h; }`);
    } else if (d.type === "uint64" || d.type === "int64" || d.type === "float64") {
      out.push(`  readPos += 8;`);
    }
  }
  out.push(`}`);
  out.push(`for (let row = start; row < limit; row++) {`);
  out.push(`  const cellBase = 8 + row * ${rowStride};`);
  if (filter) {
    // Predicate check: a single u32 read at the predicate field's cell
    // header. For boolean fields the C++ projector writes 0 or 1.
    const predRead = `dv.getUint32(cellBase + ${filterColIdx * 4}, true)`;
    const predCmp = filter.kind === "truthy" ? "=== 0" : "!== 0";
    out.push(`  if (${predRead} ${predCmp}) {`);
    // Same skip body as the slice-skip phase: walk every payload-emitting
    // field and advance readPos by its byte size.
    for (let col = 0; col < cols; col++) {
      const d = descs[col];
      if (d.type === "text" || d.type === "data") {
        out.push(`    { const _h = dv.getUint32(cellBase + ${col * 4}, true); if (_h !== 0xFFFFFFFF) readPos += _h; }`);
      } else if (d.type === "uint64" || d.type === "int64" || d.type === "float64") {
        out.push(`    readPos += 8;`);
      }
    }
    out.push(`    continue;`);
    out.push(`  }`);
  }
  for (let col = 0; col < cols; col++) {
    const d = descs[col];
    const headerOff = `cellBase + ${col * 4}`;
    const batch = textBatch[col];
    if (batch && batch.pos === 0) {
      // Emit the batched decode at the first member of the run. All
      // member _v* locals are produced here, so subsequent text members
      // skip individual emission below.
      out.push(`  let ${batch.members.map((m) => `_v${m}`).join(", ")};`);
      out.push(`  {`);
      for (let p = 0; p < batch.total; p++) {
        const m = batch.members[p];
        out.push(`    const _h${m} = dv.getUint32(cellBase + ${m * 4}, true);`);
        out.push(`    const _b${m} = _h${m} === 0xFFFFFFFF ? 0 : _h${m};`);
      }
      const totalExpr = batch.members.map((m) => `_b${m}`).join(" + ");
      out.push(`    const _total = ${totalExpr};`);
      if (sharedTextEligible) {
        out.push(`    let _canSlice = _sharedText !== null;`);
        out.push(`    if (!_canSlice) { _canSlice = true; for (let _p = readPos; _p < readPos + _total; _p++) { if (u8[out + _p] & 0x80) { _canSlice = false; break; } } }`);
        out.push(`    const _blob = _total === 0 ? "" : (_sharedText !== null ? _sharedText.substring(readPos - _payloadStart, readPos - _payloadStart + _total) : (_canSlice ? TD.decode(u8.subarray(out + readPos, out + readPos + _total)) : ""));`);
      } else {
        out.push(`    let _canSlice = true;`);
        out.push(`    for (let _p = readPos; _p < readPos + _total; _p++) { if (u8[out + _p] & 0x80) { _canSlice = false; break; } }`);
        out.push(`    const _blob = _total === 0 ? "" : (_canSlice ? TD.decode(u8.subarray(out + readPos, out + readPos + _total)) : "");`);
      }
      // Walk substrings.
      let cumExpr = "0";
      for (let p = 0; p < batch.total; p++) {
        const m = batch.members[p];
        const startExpr = cumExpr;
        const endExpr = `${cumExpr} + _b${m}`;
        out.push(
          `    _v${m} = _h${m} === 0xFFFFFFFF ? undefined : _h${m} === 0 ? "" : (_canSlice ? _blob.substring(${startExpr}, ${endExpr}) : TD.decode(u8.subarray(out + readPos + ${startExpr}, out + readPos + ${endExpr})));`,
        );
        cumExpr = endExpr;
      }
      out.push(`    readPos += _total;`);
      out.push(`  }`);
      continue;
    }
    if (batch) {
      // Subsequent member of an already-emitted run; nothing to do here
      // because the batch block produced its _v* local.
      continue;
    }
    switch (d.type) {
      case "text":
        out.push(`  let _v${col};`);
        out.push(`  { const _h = dv.getUint32(${headerOff}, true);`);
        out.push(`    if (_h === 0xFFFFFFFF) _v${col} = undefined;`);
        out.push(`    else if (_h === 0) _v${col} = "";`);
        if (sharedTextEligible) {
          out.push(`    else { _v${col} = _sharedText !== null ? _sharedText.substring(readPos - _payloadStart, readPos - _payloadStart + _h) : TD.decode(u8.subarray(out + readPos, out + readPos + _h)); readPos += _h; } }`);
        } else {
          out.push(`    else { _v${col} = TD.decode(u8.subarray(out + readPos, out + readPos + _h)); readPos += _h; } }`);
        }
        break;
      case "data":
        out.push(`  let _v${col};`);
        out.push(`  { const _h = dv.getUint32(${headerOff}, true);`);
        out.push(`    if (_h === 0xFFFFFFFF) _v${col} = undefined;`);
        out.push(`    else { _v${col} = u8.slice(out + readPos, out + readPos + _h); readPos += _h; } }`);
        break;
      case "bool":
        out.push(`  const _v${col} = dv.getUint32(${headerOff}, true) === 1;`);
        break;
      case "uint8":
      case "uint16":
        out.push(`  const _v${col} = dv.getUint32(${headerOff}, true);`);
        break;
      case "int8":
        out.push(`  const _v${col} = (dv.getUint32(${headerOff}, true) << 24) >> 24;`);
        break;
      case "int16":
        out.push(`  const _v${col} = (dv.getUint32(${headerOff}, true) << 16) >> 16;`);
        break;
      case "uint32":
        out.push(`  const _v${col} = dv.getUint32(${headerOff}, true) >>> 0;`);
        break;
      case "int32":
        out.push(`  const _v${col} = dv.getUint32(${headerOff}, true) | 0;`);
        break;
      case "float32":
        out.push(`  F32U[0] = dv.getUint32(${headerOff}, true) >>> 0;`);
        out.push(`  const _v${col} = F32F[0];`);
        break;
      case "int64":
        out.push(`  let _v${col};`);
        out.push(`  { const _lo = dv.getUint32(readPos, true);`);
        out.push(`    const _hi = dv.getInt32(readPos + 4, true);`);
        out.push(`    _v${col} = (_hi >= -0x200000 && _hi <= 0x1FFFFF) ? _hi * 4294967296 + _lo : dv.getBigInt64(readPos, true);`);
        out.push(`    readPos += 8; }`);
        break;
      case "uint64":
        // Unsigned: combine two u32 reads. Past 2^53 use BigInt so
        // high-bit values like UINT64_MAX do not collapse to -1.
        out.push(`  let _v${col};`);
        out.push(`  { const _lo = dv.getUint32(readPos, true) >>> 0;`);
        out.push(`    const _hi = dv.getUint32(readPos + 4, true) >>> 0;`);
        out.push(`    _v${col} = (_hi <= 0x001FFFFF) ? _hi * 4294967296 + _lo : ((BigInt(_hi) << 32n) | BigInt(_lo));`);
        out.push(`    readPos += 8; }`);
        break;
      case "float64":
        out.push(`  F64U[0] = dv.getUint32(readPos, true);`);
        out.push(`  F64U[1] = dv.getUint32(readPos + 4, true);`);
        out.push(`  const _v${col} = F64F[0];`);
        out.push(`  readPos += 8;`);
        break;
      default:
        out.push(`  const _v${col} = undefined;`);
    }
  }
  // Object literal with the projected names — V8 freezes one hidden class
  // for the row shape. Stringified names are valid in literal-key form.
  // When applyMapFn is set, the user's per-row callback consumes the
  // literal in place; we never store the raw row object in arr.
  const litParts = names.map((n, i) => `${JSON.stringify(n)}: _v${i}`);
  const targetExpr = filter ? "arr[arrIdx++]" : "arr[row - start]";
  if (applyMapFn) {
    out.push(`  ${targetExpr} = mapFn({ ${litParts.join(", ")} });`);
  } else {
    out.push(`  ${targetExpr} = { ${litParts.join(", ")} };`);
  }
  out.push(`}`);
  if (filter) out.push(`arr.length = arrIdx;`);
  out.push(`return arr;`);
  return new Function("u8", "dv", "out", "rows", "H", "mapFn", "start", "limit", out.join("\n"));
}

function _capnwasmPick(cpp, fields, names) {
  // Cached request prep + descriptor array. Same names hit the WeakMap and
  // skip both the encode loop and the per-call descs-rebuild.
  const entry = _getPickRequest(fields, names);
  const req = entry.req;
  const descs = entry.descs;
  const u8 = cpp._u8;
  const aux = cpp._auxPtr;
  u8.set(req, aux);
  const written = cpp._exports.cpp_any_batch_read(req.length);
  if (!written) return Object.fromEntries(names.map((n) => [n, undefined]));
  const out = cpp._outPtr;
  const u8After = cpp._u8;
  const dv2 = new DataView(u8After.buffer, out);
  let readPos = names.length * 4;
  const result = {};
  for (let i = 0; i < names.length; i++) {
    const lenOrVal = dv2.getUint32(i * 4, true);
    const d = descs[i];
    switch (d.type) {
      case "text": {
        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }
        if (lenOrVal === 0) { result[names[i]] = ""; break; }
        result[names[i]] = decodeAscii(u8After.subarray(out + readPos, out + readPos + lenOrVal));
        readPos += lenOrVal;
        break;
      }
      case "data": {
        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }
        result[names[i]] = u8After.slice(out + readPos, out + readPos + lenOrVal);
        readPos += lenOrVal;
        break;
      }
      case "bool":   result[names[i]] = lenOrVal === 1; break;
      case "uint8":  result[names[i]] = lenOrVal; break;
      case "int8":   result[names[i]] = (lenOrVal << 24) >> 24; break;
      case "uint16": result[names[i]] = lenOrVal; break;
      case "int16":  result[names[i]] = (lenOrVal << 16) >> 16; break;
      case "uint32": result[names[i]] = lenOrVal >>> 0; break;
      case "int32":  result[names[i]] = lenOrVal | 0; break;
      case "float32": _F32_VIEW_U32[0] = lenOrVal >>> 0; result[names[i]] = _F32_VIEW_F32[0]; break;
      case "int64": {
        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true);
        const hi = dv2.getInt32 (out - dv2.byteOffset + readPos + 4, true);
        result[names[i]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv2.getBigInt64(out - dv2.byteOffset + readPos, true);
        readPos += 8;
        break;
      }
      case "uint64": {
        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true) >>> 0;
        const hi = dv2.getUint32(out - dv2.byteOffset + readPos + 4, true) >>> 0;
        result[names[i]] = (hi <= 0x001FFFFF) ? hi * 4294967296 + lo : ((BigInt(hi) << 32n) | BigInt(lo));
        readPos += 8;
        break;
      }
      case "float64": {
        _F64_VIEW_U32[0] = dv2.getUint32(out - dv2.byteOffset + readPos, true);
        _F64_VIEW_U32[1] = dv2.getUint32(out - dv2.byteOffset + readPos + 4, true);
        result[names[i]] = _F64_VIEW_F64[0];
        readPos += 8;
        break;
      }
      default: result[names[i]] = undefined;
    }
  }
  return result;
}

function _capnwasmListProject(cpp, ptrIndex, fields, names, mapFn, bounds, filter) {
  const exp = cpp._exports;
  if (typeof exp.cpp_any_list_project !== "function") return null;
  if (filter && names.indexOf(filter.field) < 0) return null;
  const entry = _getPickRequest(fields, names);
  cpp._u8.set(entry.req, cpp._auxPtr);
  const written = exp.cpp_any_list_project(ptrIndex, entry.req.length);
  if (!written) return null;
  const out = cpp._outPtr;
  const u8 = cpp._u8;
  const dv = new DataView(u8.buffer, out, written);
  const rows = dv.getUint32(0, true);
  const cols = dv.getUint32(4, true);
  if (cols !== names.length) return null;
  let start = 0, limit = rows;
  if (bounds) {
    start = bounds[0] | 0;
    if (start > rows) start = rows;
    const requested = bounds[1];
    if (requested !== Infinity) {
      const max = (requested | 0);
      if (max < limit - start) limit = start + max;
    }
  }
  if (!entry.listDecoders) entry.listDecoders = new Map();
  const filterKey = filter ? filter.kind + ":" + filter.field : "";
  const decKey = (mapFn ? "m" : "p") + "|" + filterKey;
  let dec = entry.listDecoders.get(decKey);
  if (!dec) { dec = _compileListDecoder(entry.descs, names, !!mapFn, filter); entry.listDecoders.set(decKey, dec); }
  return dec(u8, dv, out, rows, _LIST_HELPERS, mapFn, start, limit);
}

function _capnwasmListReduce(cpp, ptrIndex, fields, names, reducerFn, initial, bounds, filter) {
  const projected = _capnwasmListProject(cpp, ptrIndex, fields, names, null, bounds, filter);
  if (projected === null) return null;
  return projected.reduce(reducerFn, initial);
  const exp = cpp._exports;
  if (typeof exp.cpp_any_list_project !== "function") return null;
  if (filter && names.indexOf(filter.field) < 0) return null;
  const entry = _getPickRequest(fields, names);
  cpp._u8.set(entry.req, cpp._auxPtr);
  const written = exp.cpp_any_list_project(ptrIndex, entry.req.length);
  if (!written) return null;
  const out = cpp._outPtr;
  const u8 = cpp._u8;
  const dv = new DataView(u8.buffer, out, written);
  const rows = dv.getUint32(0, true);
  const cols = dv.getUint32(4, true);
  if (cols !== names.length) return null;
  const descs = entry.descs;
  let start = 0, limit = rows;
  if (bounds) {
    start = bounds[0] | 0;
    if (start > rows) start = rows;
    const requested = bounds[1];
    if (requested !== Infinity) {
      const max = requested | 0;
      if (max < limit - start) limit = start + max;
    }
  }
  let filterColIdx = -1;
  if (filter) {
    filterColIdx = names.indexOf(filter.field);
    if (filterColIdx < 0 || (descs[filterColIdx] && descs[filterColIdx].type !== "bool")) filter = null;
  }
  const rowStride = names.length * 4;
  let readPos = 8 + rows * rowStride;
  const skipPayload = (cellBase) => {
    for (let col = 0; col < cols; col++) {
      const d = descs[col];
      if (d.type === "text" || d.type === "data") { const h = dv.getUint32(cellBase + col * 4, true); if (h !== 0xFFFFFFFF) readPos += h; }
      else if (d.type === "uint64" || d.type === "int64" || d.type === "float64") readPos += 8;
    }
  };
  for (let row = 0; row < start; row++) skipPayload(8 + row * rowStride);
  let acc = initial;
  for (let row = start; row < limit; row++) {
    const cellBase = 8 + row * rowStride;
    if (filter) {
      const pred = dv.getUint32(cellBase + filterColIdx * 4, true);
      const reject = filter.kind === "truthy" ? pred === 0 : pred !== 0;
      if (reject) { skipPayload(cellBase); continue; }
    }
    const item = {};
    for (let col = 0; col < cols; col++) {
      const h = dv.getUint32(cellBase + col * 4, true);
      const d = descs[col];
      switch (d.type) {
        case "text": if (h === 0xFFFFFFFF) item[names[col]] = undefined; else if (h === 0) item[names[col]] = ""; else { item[names[col]] = decodeAscii(u8.subarray(out + readPos, out + readPos + h)); readPos += h; } break;
        case "data": if (h === 0xFFFFFFFF) item[names[col]] = undefined; else { item[names[col]] = u8.slice(out + readPos, out + readPos + h); readPos += h; } break;
        case "bool": item[names[col]] = h === 1; break;
        case "uint8": case "uint16": item[names[col]] = h; break;
        case "int8": item[names[col]] = (h << 24) >> 24; break;
        case "int16": item[names[col]] = (h << 16) >> 16; break;
        case "uint32": item[names[col]] = h >>> 0; break;
        case "int32": item[names[col]] = h | 0; break;
        case "float32": _F32_VIEW_U32[0] = h >>> 0; item[names[col]] = _F32_VIEW_F32[0]; break;
        case "int64": { const lo = dv.getUint32(readPos, true); const hi = dv.getInt32(readPos + 4, true); item[names[col]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv.getBigInt64(readPos, true); readPos += 8; break; }
        case "uint64": { const lo = dv.getUint32(readPos, true) >>> 0; const hi = dv.getUint32(readPos + 4, true) >>> 0; item[names[col]] = (hi <= 0x001FFFFF) ? hi * 4294967296 + lo : ((BigInt(hi) << 32n) | BigInt(lo)); readPos += 8; break; }
        case "float64": _F64_VIEW_U32[0] = dv.getUint32(readPos, true); _F64_VIEW_U32[1] = dv.getUint32(readPos + 4, true); item[names[col]] = _F64_VIEW_F64[0]; readPos += 8; break;
        default: item[names[col]] = undefined;
      }
    }
    acc = reducerFn(acc, item, row);
  }
  return acc;
}

const _STRUCT_FIELDS = Object.create(null);
export class StaleReaderError extends Error {
  constructor(message = "Cap'n Proto reader is stale because the CapnCpp runtime opened another message") {
    super(message);
    this.name = "StaleReaderError";
  }
}
export class DisposedReaderError extends Error {
  constructor(message = "Cap'n Proto reader has been disposed; field access is no longer valid") {
    super(message);
    this.name = "DisposedReaderError";
  }
}
function _openCapnwasmMessage(cpp, bytes, unsafe = false) {
  if (!unsafe && typeof cpp._acquireSlot === "function" && cpp._supportsReaderSlotPool && cpp._supportsReaderSlotPool()) {
    const acquired = cpp._acquireSlot(bytes);
    if (acquired) {
      return { dataPtr: acquired.dataPtr, slotIdx: acquired.slotIdx, slotHandle: acquired.handle, msgStart: acquired.msgStart, msgEnd: acquired.msgEnd, msg: null, gen: cpp._generation };
    }
  }
  if (!unsafe && typeof cpp._allocMessage === "function") {
    const msg = cpp._allocMessage(bytes);
    const dataPtr = cpp._openAnyMessage(msg);
    return { dataPtr, slotIdx: 0, slotHandle: null, msg, msgStart: msg.ptr + (msg.segment0Start ?? 8), msgEnd: msg.ptr + (msg.segment0End ?? msg.len), gen: cpp._generation };
  }
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  const dataPtr = cpp._exports.cpp_any_open(bytes.length);
  if (typeof cpp._bumpGeneration === "function") cpp._bumpGeneration();
  const msgStart = cpp._exports.cpp_any_msg_start?.() >>> 0;
  const msgEnd = cpp._exports.cpp_any_msg_end?.() >>> 0;
  return { dataPtr, slotIdx: 0, slotHandle: null, msg: null, msgStart, msgEnd, gen: cpp._generation ?? 0 };
}
function _ensureCapnwasmReader(reader) {
  if (reader._disposed) throw new DisposedReaderError();
  if (reader._slotIdx) {
    const cpp = reader._cpp;
    if (cpp._activeSlot !== reader._slotIdx) {
      cpp._useSlot(reader._slotIdx);
    }
    const gen = cpp._generation ?? 0;
    if (reader._gen !== gen) {
      if (reader._rebind) {
        reader._rebind();
      } else {
        cpp._exports.cpp_any_slot_reset_root?.();
        cpp._bumpGeneration();
      }
      reader._gen = cpp._generation ?? 0;
      reader._u8 = cpp._u8;
      reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
    } else if (reader._dv && reader._dv.buffer !== cpp.memory.buffer) {
      reader._u8 = cpp._u8;
      reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
    }
    return;
  }
  const gen = reader._cpp._generation ?? 0;
  if (reader._gen === gen) return;
  if (reader._rebind) {
    reader._rebind();
    reader._gen = reader._cpp._generation ?? 0;
    reader._u8 = reader._cpp._u8;
    reader._dv = (reader._cpp._dv && reader._cpp._dv()) || new DataView(reader._cpp._u8.buffer);
    reader._u16 = reader._cpp._u16; reader._i16 = reader._cpp._i16; reader._u32 = reader._cpp._u32; reader._i32 = reader._cpp._i32; reader._f32 = reader._cpp._f32; reader._f64 = reader._cpp._f64;
    return;
  }
  if (reader._msg) {
    reader._dataPtr = reader._cpp._openAnyMessage(reader._msg);
    reader._gen = reader._cpp._generation ?? 0;
    reader._u8 = reader._cpp._u8;
    reader._dv = (reader._cpp._dv && reader._cpp._dv()) || new DataView(reader._cpp._u8.buffer);
    reader._u16 = reader._cpp._u16; reader._i16 = reader._cpp._i16; reader._u32 = reader._cpp._u32; reader._i32 = reader._cpp._i32; reader._f32 = reader._cpp._f32; reader._f64 = reader._cpp._f64;
    return;
  }
  throw new StaleReaderError();
}
const _LIST_MAP_TAG = Symbol("_capnwasm_listMap");
const _LIST_MAP_SLICE_TAG = Symbol("_capnwasm_listMapSlice");
const _LIST_REDUCE_TAG = Symbol("_capnwasm_listReduce");
function _makeListMapTag(idx, slice) {
  const tag = [];
  tag[_LIST_MAP_TAG] = idx;
  if (slice) tag[_LIST_MAP_SLICE_TAG] = slice;
  Object.defineProperty(tag, "slice", { value: function(start, end) {
    const s = (start === undefined) ? 0 : start;
    if (!Number.isInteger(s) || s < 0) return Array.prototype.slice.call(this, start, end);
    let limit = Infinity;
    if (end !== undefined) {
      if (!Number.isInteger(end) || end < s) return Array.prototype.slice.call(this, start, end);
      limit = end - s;
    }
    const prevSlice = this[_LIST_MAP_SLICE_TAG];
    const prevStart = prevSlice ? prevSlice[0] : 0;
    const prevLimit = prevSlice ? prevSlice[1] : Infinity;
    const newStart = prevStart + s;
    const newLimit = Math.min(prevLimit - s, limit);
    if (newLimit < 0) return [];
    return _makeListMapTag(idx, [newStart, newLimit]);
  }});
  return tag;
}
function _makeListReduceTag(idx) {
  const tag = {};
  tag[_LIST_REDUCE_TAG] = idx;
  return tag;
}
function _dummyForDesc(desc) {
  if (!desc) return undefined;
  switch (desc.type) {
    case "text": return "";
    case "data": return new Uint8Array(0);
    case "bool": return false;
    default: return 0;
  }
}
function _dummyAccumulator(initial) {
  if (Array.isArray(initial)) return [];
  if (initial && typeof initial === "object") {
    const out = {};
    for (const [k, v] of Object.entries(initial)) out[k] = Array.isArray(v) ? [] : (v && typeof v === "object" ? {} : v);
    return out;
  }
  return initial;
}
function _parseSimplePredicate(fn) {
  let src;
  try { src = Function.prototype.toString.call(fn); } catch (_) { return null; }
  const truthyRe = /^\s*(?:\(\s*([a-zA-Z_$][\w$]*)\s*\)|([a-zA-Z_$][\w$]*))\s*=>\s*(\1|\2)\.([a-zA-Z_$][\w$]*)\s*;?\s*$/;
  const falsyRe = /^\s*(?:\(\s*([a-zA-Z_$][\w$]*)\s*\)|([a-zA-Z_$][\w$]*))\s*=>\s*!\s*(\1|\2)\.([a-zA-Z_$][\w$]*)\s*;?\s*$/;
  let m = truthyRe.exec(src); if (m) return { kind: "truthy", field: m[4] };
  m = falsyRe.exec(src); if (m) return { kind: "falsy", field: m[4] };
  return null;
}
function _isShapePreservingMap(fn, leafFields) {
  let src;
  try { src = Function.prototype.toString.call(fn); } catch (_) { return false; }
  const m = /^\s*(?:\(\s*([a-zA-Z_$][\w$]*)\s*\)|([a-zA-Z_$][\w$]*))\s*=>\s*\(\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/.exec(src);
  if (!m) return false;
  const param = m[1] || m[2];
  const body = m[3];
  if (/[\/{\[\`'"]/.test(body)) return false;
  const entries = body.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length !== leafFields.length) return false;
  if (!/^[a-zA-Z_$][\w$]*$/.test(param)) return false;
  const entryRe = new RegExp("^([a-zA-Z_$][\\w$]*)\\s*:\\s*" + param + "\\.([a-zA-Z_$][\\w$]*)$");
  const set = new Set(leafFields);
  const seen = new Set();
  for (let i = 0; i < entries.length; i++) {
    const em = entryRe.exec(entries[i]);
    if (!em || em[1] !== em[2]) return false;
    if (!set.has(em[1]) || seen.has(em[1])) return false;
    seen.add(em[1]);
  }
  return true;
}
function _planRaw(fields, fn) {
  const selected = [];
  const seen = new Set();
  const recordField = (schema, path) => {
    const key = path.join(".");
    if (!seen.has(key)) { seen.add(key); selected.push({ kind: "field", path }); }
    return _dummyForDesc(schema[path[path.length - 1]]);
  };
  const make = (schema, path) => new Proxy(Object.create(null), {
    get(_, name) {
      if (typeof name !== "string") return undefined;
      const desc = schema[name];
      if (!desc) return undefined;
      const nextPath = path.concat(name);
      const list = /^List\(([^)]+)\)$/.exec(desc.type);
      if (list && _STRUCT_FIELDS[list[1]]) {
        const recordMap = (childFn, filter) => {
          const idx = selected.length;
          const entry = { kind: "listMap", path: nextPath, inner: list[1], fn: childFn };
          if (filter) entry.filter = filter;
          selected.push(entry);
          return idx;
        };
        const recordReduce = (reducerFn, initial, filter) => {
          const idx = selected.length;
          const entry = { kind: "listReduce", path: nextPath, inner: list[1], fn: reducerFn, initial };
          if (filter) entry.filter = filter;
          selected.push(entry);
          return idx;
        };
        const buildFusedProxy = (filter) => ({
          map(childFn) {
            const idx = recordMap(childFn, filter);
            return _makeListMapTag(idx, null);
          },
          filter(predicateFn) {
            const parsed = _parseSimplePredicate(predicateFn);
            if (parsed) return buildFusedProxy(parsed);
            return buildSafeProxy();
          },
          reduce(reducerFn, initial) {
            const idx = recordReduce(reducerFn, initial, filter);
            return _makeListReduceTag(idx);
          }
        });
        const buildSafeProxy = () => ({
          map(childFn) { recordMap(childFn, null); return []; },
          filter() { return buildSafeProxy(); },
          reduce(reducerFn, initial) { const idx = recordReduce(reducerFn, initial, null); return _makeListReduceTag(idx); }
        });
        return buildFusedProxy(null);
      }
      if (_STRUCT_FIELDS[desc.type]) return make(_STRUCT_FIELDS[desc.type], nextPath);
      return recordField(schema, nextPath);
    }
  });
  const result = fn(make(fields, []));
  let outerListMapIdx = -1;
  let outerListReduceIdx = -1;
  let outerSlice = null;
  if (result && typeof result === "object" && _LIST_MAP_TAG in result) {
    outerListMapIdx = result[_LIST_MAP_TAG];
    if (_LIST_MAP_SLICE_TAG in result) outerSlice = result[_LIST_MAP_SLICE_TAG];
  }
  if (result && typeof result === "object" && _LIST_REDUCE_TAG in result) {
    outerListReduceIdx = result[_LIST_REDUCE_TAG];
  }
  return { selected, outerListMapIdx, outerListReduceIdx, outerSlice };
}
function _compilePlan(selected, outerListMapIdx, outerSlice, outerListReduceIdx = -1) {
  const leaf = [];
  const nestedRaw = new Map();
  const listMapRaw = [];
  const listReduceRaw = [];
  let outerListMapPos = -1;
  let outerListReducePos = -1;
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    const head = item.path[0];
    if (!head) continue;
    if (item.kind === "field" && item.path.length === 1) {
      leaf.push(head);
    } else if (item.kind === "listMap" && item.path.length === 1) {
      if (i === outerListMapIdx) outerListMapPos = listMapRaw.length;
      const lmEntry = { name: head, inner: item.inner, fn: item.fn };
      if (item.filter) lmEntry.filter = item.filter;
      listMapRaw.push(lmEntry);
    } else if (item.kind === "listReduce" && item.path.length === 1) {
      if (i === outerListReduceIdx) outerListReducePos = listReduceRaw.length;
      const lrEntry = { name: head, inner: item.inner, fn: item.fn, initial: item.initial };
      if (item.filter) lrEntry.filter = item.filter;
      listReduceRaw.push(lrEntry);
    } else {
      let entry = nestedRaw.get(head);
      if (!entry) { entry = []; nestedRaw.set(head, entry); }
      const sliced = { kind: item.kind, path: item.path.slice(1) };
      if (item.kind === "listMap") { sliced.inner = item.inner; sliced.fn = item.fn; }
      entry.push(sliced);
    }
  }
  const nested = [];
  for (const [name, raw] of nestedRaw) nested.push({ name, plan: _compilePlan(raw, -1, null) });
  const listMap = listMapRaw.map(({ name, inner, fn, filter }) => {
    const innerPlan = _planDraft(_STRUCT_FIELDS[inner], fn).plan;
    const shapePreserving = (innerPlan.nested.length === 0 && innerPlan.listMap.length === 0)
      && _isShapePreservingMap(fn, innerPlan.leaf);
    return { name, inner, fn, filter, plan: innerPlan, shapePreserving };
  });
  const listReduce = listReduceRaw.map(({ name, inner, fn, initial, filter }) => {
    const innerPlan = _planDraft(_STRUCT_FIELDS[inner], (row) => { fn(_dummyAccumulator(initial), row, 0); return undefined; }).plan;
    return { name, inner, fn, initial, filter, plan: innerPlan };
  });
  return { leaf, nested, listMap, listReduce, outerListMapPos, outerListReducePos, outerSlice };
}
function _planDraft(fields, fn) {
  const raw = _planRaw(fields, fn);
  return { plan: _compilePlan(raw.selected, raw.outerListMapIdx, raw.outerSlice, raw.outerListReduceIdx) };
}
function _getDraftPlan(fields, fn) {
  let perFields = _DRAFT_PLAN_CACHE.get(fields);
  if (!perFields) { perFields = new WeakMap(); _DRAFT_PLAN_CACHE.set(fields, perFields); }
  let plan = perFields.get(fn);
  if (!plan) { plan = _planDraft(fields, fn).plan; perFields.set(fn, plan); }
  return plan;
}
function _materializeDraft(cpp, fields, plan) {
  const out = {};
  if (plan.leaf.length > 0) Object.assign(out, _capnwasmPick(cpp, fields, plan.leaf));
  const exp = cpp._exports;
  for (let i = 0; i < plan.nested.length; i++) {
    const sub = plan.nested[i];
    const desc = fields[sub.name];
    if (!desc || !_STRUCT_FIELDS[desc.type]) { out[sub.name] = undefined; continue; }
    if (exp.cpp_any_enter_struct(desc.off) !== 1) { out[sub.name] = null; continue; }
    try { out[sub.name] = _materializeDraft(cpp, _STRUCT_FIELDS[desc.type], sub.plan); }
    finally { exp.cpp_any_leave_struct(); }
  }
  for (let i = 0; i < plan.listMap.length; i++) {
    const item = plan.listMap[i];
    const desc = fields[item.name];
    if (!desc || !_STRUCT_FIELDS[item.inner]) { out[item.name] = []; continue; }
    const innerFields = _STRUCT_FIELDS[item.inner];
    if (item.plan.nested.length === 0 && item.plan.listMap.length === 0) {
      const fast = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf);
      if (fast !== null) { out[item.name] = fast; continue; }
    }
    const size = exp.cpp_any_open_list(desc.off);
    const arr = new Array(size);
    for (let j = 0; j < size; j++) {
      exp.cpp_any_open_list(desc.off);
      if (exp.cpp_any_enter_list_at(j) !== 1) { arr[j] = null; continue; }
      try { arr[j] = _materializeDraft(cpp, innerFields, item.plan); }
      finally { exp.cpp_any_leave_struct(); }
    }
    out[item.name] = arr;
  }
  for (let i = 0; i < plan.listReduce.length; i++) {
    const item = plan.listReduce[i];
    const desc = fields[item.name];
    if (!desc || !_STRUCT_FIELDS[item.inner]) { out[item.name] = item.initial; continue; }
    const innerFields = _STRUCT_FIELDS[item.inner];
    if (item.plan.nested.length === 0 && item.plan.listMap.length === 0 && item.plan.listReduce.length === 0) {
      const fast = _capnwasmListReduce(cpp, desc.off, innerFields, item.plan.leaf, item.fn, item.initial, null, item.filter);
      if (fast !== null) { out[item.name] = fast; continue; }
    }
    const rows = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf);
    if (rows === null) { out[item.name] = item.initial; continue; }
    out[item.name] = rows.reduce(item.fn, item.initial);
  }
  return out;
}
function _runDraft(cpp, fields, fn) {
  const plan = _getDraftPlan(fields, fn);
  if (plan.outerListReducePos >= 0 && plan.listReduce.length > 0) {
    const item = plan.listReduce[plan.outerListReducePos];
    const desc = fields[item.name];
    if (desc && _STRUCT_FIELDS[item.inner] && item.plan.nested.length === 0 && item.plan.listMap.length === 0 && item.plan.listReduce.length === 0) {
      const innerFields = _STRUCT_FIELDS[item.inner];
      const fast = _capnwasmListReduce(cpp, desc.off, innerFields, item.plan.leaf, item.fn, item.initial, plan.outerSlice, item.filter);
      if (fast !== null) return fast;
    }
  }
  if (plan.outerListMapPos >= 0 && plan.listMap.length > 0) {
    const item = plan.listMap[plan.outerListMapPos];
    const desc = fields[item.name];
    if (desc && _STRUCT_FIELDS[item.inner] && item.plan.nested.length === 0 && item.plan.listMap.length === 0) {
      const innerFields = _STRUCT_FIELDS[item.inner];
      const fastFn = item.shapePreserving ? null : item.fn;
      const fast = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf, fastFn, plan.outerSlice, item.filter);
      if (fast !== null) return fast;
    }
  }
  if (plan.nested.length === 0 && plan.listMap.length === 0 && plan.listReduce.length === 0) {
    return fn(_capnwasmPick(cpp, fields, plan.leaf));
  }
  return fn(_materializeDraft(cpp, fields, plan));
}

export class Box$TextReader {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 1;
  constructor(cpp, dataPtr, opts = undefined) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    this._msg = opts && opts.msg ? opts.msg : null;
    this._rebind = opts && opts.rebind ? opts.rebind : null;
    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);
    this._slotIdx = opts && opts.slotIdx ? opts.slotIdx : 0;
    this._slotHandle = opts && opts.slotHandle ? opts.slotHandle : null;
    this._msgStart = opts && opts.msgStart !== undefined ? opts.msgStart : 0;
    this._msgEnd = opts && opts.msgEnd !== undefined ? opts.msgEnd : 0;
    this._capTable = (opts && opts.capTable) || (opts && opts.parent && opts.parent._capTable) || null;
    this._dataPtr = dataPtr | 0;
    if (opts && opts.parent) {
      const _p = opts.parent;
      this._u8 = _p._u8; this._dv = _p._dv;
      this._u16 = _p._u16; this._i16 = _p._i16; this._u32 = _p._u32; this._i32 = _p._i32; this._f32 = _p._f32; this._f64 = _p._f64;
    } else {
      this._u8 = cpp._u8;
      this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      this._u16 = cpp._u16; this._i16 = cpp._i16; this._u32 = cpp._u32; this._i32 = cpp._i32; this._f32 = cpp._f32; this._f64 = cpp._f64;
    }
    this._disposed = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._slotHandle) {
      this._cpp._releaseSlot(this._slotHandle);
      this._slotHandle = null;
    } else if (this._msg) {
      this._cpp._freeMessage(this._msg);
      this._msg = null;
    }
    this._dataPtr = 0;
    this._rebind = null;
  }


  get value() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 0, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }

  static _FIELDS = {
    value: {"kind":0,"off":0,"type":"text"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, Box$TextReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, Box$TextReader._FIELDS, Object.keys(Box$TextReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  Box$TextReader.prototype[Symbol.dispose] = Box$TextReader.prototype.dispose;
}

export class Box$TagReader {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 1;
  constructor(cpp, dataPtr, opts = undefined) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    this._msg = opts && opts.msg ? opts.msg : null;
    this._rebind = opts && opts.rebind ? opts.rebind : null;
    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);
    this._slotIdx = opts && opts.slotIdx ? opts.slotIdx : 0;
    this._slotHandle = opts && opts.slotHandle ? opts.slotHandle : null;
    this._msgStart = opts && opts.msgStart !== undefined ? opts.msgStart : 0;
    this._msgEnd = opts && opts.msgEnd !== undefined ? opts.msgEnd : 0;
    this._capTable = (opts && opts.capTable) || (opts && opts.parent && opts.parent._capTable) || null;
    this._dataPtr = dataPtr | 0;
    if (opts && opts.parent) {
      const _p = opts.parent;
      this._u8 = _p._u8; this._dv = _p._dv;
      this._u16 = _p._u16; this._i16 = _p._i16; this._u32 = _p._u32; this._i32 = _p._i32; this._f32 = _p._f32; this._f64 = _p._f64;
    } else {
      this._u8 = cpp._u8;
      this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      this._u16 = cpp._u16; this._i16 = cpp._i16; this._u32 = cpp._u32; this._i32 = cpp._i32; this._f32 = cpp._f32; this._f64 = cpp._f64;
    }
    this._disposed = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._slotHandle) {
      this._cpp._releaseSlot(this._slotHandle);
      this._slotHandle = null;
    } else if (this._msg) {
      this._cpp._freeMessage(this._msg);
      this._msg = null;
    }
    this._dataPtr = 0;
    this._rebind = null;
  }


  get value() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    // Rebind closure for cursor-only sub-readers: re-position the C++
    // any_stack onto this nested struct before any boundary call. Used
    // by paths the JS decoder doesn't cover (Bool list, unsafe readers).
    const _rebindNested = () => {
      _ensureCapnwasmReader(reader);
      cpp._exports.cpp_any_slot_reset_root?.();
      cpp._exports.cpp_any_enter_struct(0);
      cpp._bumpGeneration();
    };
    if (_msgEnd) {
      const desc = _jsReadStructPtr(reader._u8, reader._dv, reader._dataPtr, 0, 0, _msgStart, _msgEnd);
      if (desc !== undefined) {
        const dp = desc === null ? 0 : desc.dataPtr;
        // gen=-1 forces _ensureCapnwasmReader to invoke the rebind on the
        // first cursor-using access, which positions the C++ any_stack
        // onto this nested struct. Pure-JS reads via _dataPtr never hit
        // that branch; only Bool list / unsafe paths need the cursor.
        return new TagReader(cpp, dp, {
          slotIdx: reader._slotIdx,
          msgStart: _msgStart,
          msgEnd: _msgEnd,
          gen: -1,
          parent: reader,
          rebind: _rebindNested,
        });
      }
    }
    // Cursor fallback: position the C++ cursor on the nested struct so
    // subsequent getters read from the right level. Pass parent so
    // the nested reader inherits _capTable for cap-typed fields.
    _rebindNested();
    return new TagReader(cpp, 0, {
      msg: reader._msg,
      slotIdx: reader._slotIdx,
      gen: cpp._generation ?? 0,
      parent: reader,
      rebind: _rebindNested,
    });
  }

  static _FIELDS = {
    value: {"kind":-1,"off":0,"type":"Tag"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, Box$TagReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, Box$TagReader._FIELDS, Object.keys(Box$TagReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  Box$TagReader.prototype[Symbol.dispose] = Box$TagReader.prototype.dispose;
}

export class TagReader {
  static _DATA_WORDS = 1;
  static _PTR_WORDS = 1;
  constructor(cpp, dataPtr, opts = undefined) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    this._msg = opts && opts.msg ? opts.msg : null;
    this._rebind = opts && opts.rebind ? opts.rebind : null;
    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);
    this._slotIdx = opts && opts.slotIdx ? opts.slotIdx : 0;
    this._slotHandle = opts && opts.slotHandle ? opts.slotHandle : null;
    this._msgStart = opts && opts.msgStart !== undefined ? opts.msgStart : 0;
    this._msgEnd = opts && opts.msgEnd !== undefined ? opts.msgEnd : 0;
    this._capTable = (opts && opts.capTable) || (opts && opts.parent && opts.parent._capTable) || null;
    this._dataPtr = dataPtr | 0;
    if (opts && opts.parent) {
      const _p = opts.parent;
      this._u8 = _p._u8; this._dv = _p._dv;
      this._u16 = _p._u16; this._i16 = _p._i16; this._u32 = _p._u32; this._i32 = _p._i32; this._f32 = _p._f32; this._f64 = _p._f64;
    } else {
      this._u8 = cpp._u8;
      this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      this._u16 = cpp._u16; this._i16 = cpp._i16; this._u32 = cpp._u32; this._i32 = cpp._i32; this._f32 = cpp._f32; this._f64 = cpp._f64;
    }
    this._disposed = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._slotHandle) {
      this._cpp._releaseSlot(this._slotHandle);
      this._slotHandle = null;
    } else if (this._msg) {
      this._cpp._freeMessage(this._msg);
      this._msg = null;
    }
    this._dataPtr = 0;
    this._rebind = null;
  }


  get name() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 1, 0, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get weight() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u32[(this._dataPtr + 0) >>> 2] : this._exp.cpp_any_uint32_at(0, 0);
  }

  static _FIELDS = {
    name: {"kind":0,"off":0,"type":"text"},
    weight: {"kind":3,"off":0,"type":"uint32"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, TagReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, TagReader._FIELDS, Object.keys(TagReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  TagReader.prototype[Symbol.dispose] = TagReader.prototype.dispose;
}

export class BoxReader {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 1;
  constructor(cpp, dataPtr, opts = undefined) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    this._msg = opts && opts.msg ? opts.msg : null;
    this._rebind = opts && opts.rebind ? opts.rebind : null;
    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);
    this._slotIdx = opts && opts.slotIdx ? opts.slotIdx : 0;
    this._slotHandle = opts && opts.slotHandle ? opts.slotHandle : null;
    this._msgStart = opts && opts.msgStart !== undefined ? opts.msgStart : 0;
    this._msgEnd = opts && opts.msgEnd !== undefined ? opts.msgEnd : 0;
    this._capTable = (opts && opts.capTable) || (opts && opts.parent && opts.parent._capTable) || null;
    this._dataPtr = dataPtr | 0;
    if (opts && opts.parent) {
      const _p = opts.parent;
      this._u8 = _p._u8; this._dv = _p._dv;
      this._u16 = _p._u16; this._i16 = _p._i16; this._u32 = _p._u32; this._i32 = _p._i32; this._f32 = _p._f32; this._f64 = _p._f64;
    } else {
      this._u8 = cpp._u8;
      this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      this._u16 = cpp._u16; this._i16 = cpp._i16; this._u32 = cpp._u32; this._i32 = cpp._i32; this._f32 = cpp._f32; this._f64 = cpp._f64;
    }
    this._disposed = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._slotHandle) {
      this._cpp._releaseSlot(this._slotHandle);
      this._slotHandle = null;
    } else if (this._msg) {
      this._cpp._freeMessage(this._msg);
      this._msg = null;
    }
    this._dataPtr = 0;
    this._rebind = null;
  }


  get value() {
    _ensureCapnwasmReader(this);
    const reader = this;
    return new _AnyPointerReadHandle(reader, 0, 0);
  }

  static _FIELDS = {
    value: {"kind":-1,"off":0,"type":"AnyPointer"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, BoxReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, BoxReader._FIELDS, Object.keys(BoxReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  BoxReader.prototype[Symbol.dispose] = BoxReader.prototype.dispose;
}

export class UseBoxReader {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 2;
  constructor(cpp, dataPtr, opts = undefined) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    this._msg = opts && opts.msg ? opts.msg : null;
    this._rebind = opts && opts.rebind ? opts.rebind : null;
    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);
    this._slotIdx = opts && opts.slotIdx ? opts.slotIdx : 0;
    this._slotHandle = opts && opts.slotHandle ? opts.slotHandle : null;
    this._msgStart = opts && opts.msgStart !== undefined ? opts.msgStart : 0;
    this._msgEnd = opts && opts.msgEnd !== undefined ? opts.msgEnd : 0;
    this._capTable = (opts && opts.capTable) || (opts && opts.parent && opts.parent._capTable) || null;
    this._dataPtr = dataPtr | 0;
    if (opts && opts.parent) {
      const _p = opts.parent;
      this._u8 = _p._u8; this._dv = _p._dv;
      this._u16 = _p._u16; this._i16 = _p._i16; this._u32 = _p._u32; this._i32 = _p._i32; this._f32 = _p._f32; this._f64 = _p._f64;
    } else {
      this._u8 = cpp._u8;
      this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
      this._u16 = cpp._u16; this._i16 = cpp._i16; this._u32 = cpp._u32; this._i32 = cpp._i32; this._f32 = cpp._f32; this._f64 = cpp._f64;
    }
    this._disposed = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._slotHandle) {
      this._cpp._releaseSlot(this._slotHandle);
      this._slotHandle = null;
    } else if (this._msg) {
      this._cpp._freeMessage(this._msg);
      this._msg = null;
    }
    this._dataPtr = 0;
    this._rebind = null;
  }


  get textBox() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    // Rebind closure for cursor-only sub-readers: re-position the C++
    // any_stack onto this nested struct before any boundary call. Used
    // by paths the JS decoder doesn't cover (Bool list, unsafe readers).
    const _rebindNested = () => {
      _ensureCapnwasmReader(reader);
      cpp._exports.cpp_any_slot_reset_root?.();
      cpp._exports.cpp_any_enter_struct(0);
      cpp._bumpGeneration();
    };
    if (_msgEnd) {
      const desc = _jsReadStructPtr(reader._u8, reader._dv, reader._dataPtr, 0, 0, _msgStart, _msgEnd);
      if (desc !== undefined) {
        const dp = desc === null ? 0 : desc.dataPtr;
        // gen=-1 forces _ensureCapnwasmReader to invoke the rebind on the
        // first cursor-using access, which positions the C++ any_stack
        // onto this nested struct. Pure-JS reads via _dataPtr never hit
        // that branch; only Bool list / unsafe paths need the cursor.
        return new Box$TextReader(cpp, dp, {
          slotIdx: reader._slotIdx,
          msgStart: _msgStart,
          msgEnd: _msgEnd,
          gen: -1,
          parent: reader,
          rebind: _rebindNested,
        });
      }
    }
    // Cursor fallback: position the C++ cursor on the nested struct so
    // subsequent getters read from the right level. Pass parent so
    // the nested reader inherits _capTable for cap-typed fields.
    _rebindNested();
    return new Box$TextReader(cpp, 0, {
      msg: reader._msg,
      slotIdx: reader._slotIdx,
      gen: cpp._generation ?? 0,
      parent: reader,
      rebind: _rebindNested,
    });
  }
  get tagBox() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    // Rebind closure for cursor-only sub-readers: re-position the C++
    // any_stack onto this nested struct before any boundary call. Used
    // by paths the JS decoder doesn't cover (Bool list, unsafe readers).
    const _rebindNested = () => {
      _ensureCapnwasmReader(reader);
      cpp._exports.cpp_any_slot_reset_root?.();
      cpp._exports.cpp_any_enter_struct(1);
      cpp._bumpGeneration();
    };
    if (_msgEnd) {
      const desc = _jsReadStructPtr(reader._u8, reader._dv, reader._dataPtr, 0, 1, _msgStart, _msgEnd);
      if (desc !== undefined) {
        const dp = desc === null ? 0 : desc.dataPtr;
        // gen=-1 forces _ensureCapnwasmReader to invoke the rebind on the
        // first cursor-using access, which positions the C++ any_stack
        // onto this nested struct. Pure-JS reads via _dataPtr never hit
        // that branch; only Bool list / unsafe paths need the cursor.
        return new Box$TagReader(cpp, dp, {
          slotIdx: reader._slotIdx,
          msgStart: _msgStart,
          msgEnd: _msgEnd,
          gen: -1,
          parent: reader,
          rebind: _rebindNested,
        });
      }
    }
    // Cursor fallback: position the C++ cursor on the nested struct so
    // subsequent getters read from the right level. Pass parent so
    // the nested reader inherits _capTable for cap-typed fields.
    _rebindNested();
    return new Box$TagReader(cpp, 0, {
      msg: reader._msg,
      slotIdx: reader._slotIdx,
      gen: cpp._generation ?? 0,
      parent: reader,
      rebind: _rebindNested,
    });
  }

  static _FIELDS = {
    textBox: {"kind":-1,"off":0,"type":"Box$Text"},
    tagBox: {"kind":-1,"off":1,"type":"Box$Tag"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, UseBoxReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, UseBoxReader._FIELDS, Object.keys(UseBoxReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  UseBoxReader.prototype[Symbol.dispose] = UseBoxReader.prototype.dispose;
}

_STRUCT_FIELDS["Box$Text"] = Box$TextReader._FIELDS;
_STRUCT_FIELDS["Box$Tag"] = Box$TagReader._FIELDS;
_STRUCT_FIELDS["Tag"] = TagReader._FIELDS;
_STRUCT_FIELDS["Box"] = BoxReader._FIELDS;
_STRUCT_FIELDS["UseBox"] = UseBoxReader._FIELDS;

export class Box$TextBuilder {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 1;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(0, 1) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
    this._capSink = (opts && opts.capSink) || null;
  }

  set value(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(0, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }

  /**
   * Apply fields from a plain JS object to this builder. Same shape
   * as JSON.stringify on the wire side: pass any object whose keys
   * match the schema field names. Missing keys are skipped, unknown
   * keys are ignored. Returns `this` for chaining.
   */
  fromObject(o) {
    if (o == null) return this;
    if (o.value !== undefined) this.value = o.value;
    return this;
  }

  /**
   * Build a Box$Text from a plain JS object in one call.
   * Shorthand for `new Box$TextBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new Box$TextBuilder(cpp).fromObject(o);
  }

  /** Serialize the message to framed Cap'n Proto bytes. */
  toBytes() {
    const len = this._exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    const out = this._cpp._outPtr;
    return this._cpp._u8.slice(out, out + len);
  }
}

export class Box$TagBuilder {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 1;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(0, 1) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
    this._capSink = (opts && opts.capSink) || null;
  }

  get value() {
    if (this._exp.cpp_any_builder_enter_struct(0, 1, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for value");
    }
    const sub = new TagBuilder(this._cpp, { preinitialized: true, capSink: this._capSink });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub._exitOnFinalize = true;
    return sub;
  }
  set value(value) {
    if (value == null) return;
    if (value && value._cpp && typeof value._slotIdx === "number") {
      if (this._exp.cpp_any_builder_set_anypointer_from_slot(0, value._slotIdx) !== 1) {
        throw new Error("orphan/Reader adopt failed for value");
      }
      this._u8 = this._cpp._u8;
      this._dataPtr = this._exp.cpp_any_builder_data_ptr();
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value && value._capnpFrame instanceof Uint8Array) {
      const _frame = value._capnpFrame;
      this._cpp._u8.set(_frame, this._exp.cpp_in_ptr());
      if (this._exp.cpp_any_builder_set_struct_from_bytes(0, _frame.length) !== 1) {
        throw new Error("orphan/bytes adopt failed for value");
      }
      this._u8 = this._cpp._u8;
      this._dataPtr = this._exp.cpp_any_builder_data_ptr();
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (this._exp.cpp_any_builder_enter_struct(0, 1, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for value");
    }
    const sub = new TagBuilder(this._cpp, { preinitialized: true, capSink: this._capSink });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub.fromObject(value);
    if (this._exp.cpp_any_builder_exit_struct() !== 1) {
      throw new Error("cpp_any_builder_exit_struct failed for value");
    }
    this._u8 = this._cpp._u8;
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }

  /**
   * Apply fields from a plain JS object to this builder. Same shape
   * as JSON.stringify on the wire side: pass any object whose keys
   * match the schema field names. Missing keys are skipped, unknown
   * keys are ignored. Returns `this` for chaining.
   */
  fromObject(o) {
    if (o == null) return this;
    if (o.value !== undefined) this.value = o.value;
    return this;
  }

  /**
   * Build a Box$Tag from a plain JS object in one call.
   * Shorthand for `new Box$TagBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new Box$TagBuilder(cpp).fromObject(o);
  }

  /** Serialize the message to framed Cap'n Proto bytes. */
  toBytes() {
    const len = this._exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    const out = this._cpp._outPtr;
    return this._cpp._u8.slice(out, out + len);
  }
}

export class TagBuilder {
  static _DATA_WORDS = 1;
  static _PTR_WORDS = 1;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(1, 1) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
    this._capSink = (opts && opts.capSink) || null;
  }

  set name(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(0, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set weight(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 0;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
    u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;
  }

  /**
   * Apply fields from a plain JS object to this builder. Same shape
   * as JSON.stringify on the wire side: pass any object whose keys
   * match the schema field names. Missing keys are skipped, unknown
   * keys are ignored. Returns `this` for chaining.
   */
  fromObject(o) {
    if (o == null) return this;
    if (o.name !== undefined) this.name = o.name;
    if (o.weight !== undefined) this.weight = o.weight;
    return this;
  }

  /**
   * Build a Tag from a plain JS object in one call.
   * Shorthand for `new TagBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new TagBuilder(cpp).fromObject(o);
  }

  /** Serialize the message to framed Cap'n Proto bytes. */
  toBytes() {
    const len = this._exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    const out = this._cpp._outPtr;
    return this._cpp._u8.slice(out, out + len);
  }
}

export class BoxBuilder {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 1;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(0, 1) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
    this._capSink = (opts && opts.capSink) || null;
  }

  set value(value) {
    if (typeof value === "string") {
      const inPtr = this._exp.cpp_in_ptr();
      const inCap = this._exp.cpp_in_capacity();
      const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
      const { written } = SHARED_ENCODER.encodeInto(value, dst);
      this._exp.cpp_any_builder_set_text(0, written);
      this._u8 = this._cpp._u8;
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value instanceof Uint8Array) {
      this._cpp._u8.set(value, this._exp.cpp_in_ptr());
      this._exp.cpp_any_builder_set_data(0, value.length);
      this._u8 = this._cpp._u8;
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value && value._cpp && typeof value._slotIdx === "number") {
      // Reader instance — deep copy via slot.
      if (this._exp.cpp_any_builder_set_anypointer_from_slot(0, value._slotIdx) !== 1) {
        throw new Error("AnyPointer struct copy from slot failed (slot released or wrong type)");
      }
      this._u8 = this._cpp._u8;
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value && value._capnpFrame instanceof Uint8Array) {
      const frame = value._capnpFrame;
      this._cpp._u8.set(frame, this._exp.cpp_in_ptr());
      if (this._exp.cpp_any_builder_set_struct_from_bytes(0, frame.length) !== 1) {
        throw new Error("AnyPointer struct copy from bytes failed (malformed framed message)");
      }
      this._u8 = this._cpp._u8;
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value == null) return;
    throw new TypeError("AnyPointer setter accepts string (Text), Uint8Array (Data), a capnwasm Reader (struct deep-copy), or { _capnpFrame: Uint8Array } (raw framed message)");
  }

  /**
   * Apply fields from a plain JS object to this builder. Same shape
   * as JSON.stringify on the wire side: pass any object whose keys
   * match the schema field names. Missing keys are skipped, unknown
   * keys are ignored. Returns `this` for chaining.
   */
  fromObject(o) {
    if (o == null) return this;
    if (o.value !== undefined) this.value = o.value;
    return this;
  }

  /**
   * Build a Box from a plain JS object in one call.
   * Shorthand for `new BoxBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new BoxBuilder(cpp).fromObject(o);
  }

  /** Serialize the message to framed Cap'n Proto bytes. */
  toBytes() {
    const len = this._exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    const out = this._cpp._outPtr;
    return this._cpp._u8.slice(out, out + len);
  }
}

export class UseBoxBuilder {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 2;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(0, 2) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
    this._capSink = (opts && opts.capSink) || null;
  }

  get textBox() {
    if (this._exp.cpp_any_builder_enter_struct(0, 0, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for textBox");
    }
    const sub = new Box$TextBuilder(this._cpp, { preinitialized: true, capSink: this._capSink });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub._exitOnFinalize = true;
    return sub;
  }
  set textBox(value) {
    if (value == null) return;
    if (value && value._cpp && typeof value._slotIdx === "number") {
      if (this._exp.cpp_any_builder_set_anypointer_from_slot(0, value._slotIdx) !== 1) {
        throw new Error("orphan/Reader adopt failed for textBox");
      }
      this._u8 = this._cpp._u8;
      this._dataPtr = this._exp.cpp_any_builder_data_ptr();
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value && value._capnpFrame instanceof Uint8Array) {
      const _frame = value._capnpFrame;
      this._cpp._u8.set(_frame, this._exp.cpp_in_ptr());
      if (this._exp.cpp_any_builder_set_struct_from_bytes(0, _frame.length) !== 1) {
        throw new Error("orphan/bytes adopt failed for textBox");
      }
      this._u8 = this._cpp._u8;
      this._dataPtr = this._exp.cpp_any_builder_data_ptr();
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (this._exp.cpp_any_builder_enter_struct(0, 0, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for textBox");
    }
    const sub = new Box$TextBuilder(this._cpp, { preinitialized: true, capSink: this._capSink });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub.fromObject(value);
    if (this._exp.cpp_any_builder_exit_struct() !== 1) {
      throw new Error("cpp_any_builder_exit_struct failed for textBox");
    }
    this._u8 = this._cpp._u8;
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  get tagBox() {
    if (this._exp.cpp_any_builder_enter_struct(1, 0, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for tagBox");
    }
    const sub = new Box$TagBuilder(this._cpp, { preinitialized: true, capSink: this._capSink });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub._exitOnFinalize = true;
    return sub;
  }
  set tagBox(value) {
    if (value == null) return;
    if (value && value._cpp && typeof value._slotIdx === "number") {
      if (this._exp.cpp_any_builder_set_anypointer_from_slot(1, value._slotIdx) !== 1) {
        throw new Error("orphan/Reader adopt failed for tagBox");
      }
      this._u8 = this._cpp._u8;
      this._dataPtr = this._exp.cpp_any_builder_data_ptr();
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (value && value._capnpFrame instanceof Uint8Array) {
      const _frame = value._capnpFrame;
      this._cpp._u8.set(_frame, this._exp.cpp_in_ptr());
      if (this._exp.cpp_any_builder_set_struct_from_bytes(1, _frame.length) !== 1) {
        throw new Error("orphan/bytes adopt failed for tagBox");
      }
      this._u8 = this._cpp._u8;
      this._dataPtr = this._exp.cpp_any_builder_data_ptr();
      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
      return;
    }
    if (this._exp.cpp_any_builder_enter_struct(1, 0, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for tagBox");
    }
    const sub = new Box$TagBuilder(this._cpp, { preinitialized: true, capSink: this._capSink });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub.fromObject(value);
    if (this._exp.cpp_any_builder_exit_struct() !== 1) {
      throw new Error("cpp_any_builder_exit_struct failed for tagBox");
    }
    this._u8 = this._cpp._u8;
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }

  /**
   * Apply fields from a plain JS object to this builder. Same shape
   * as JSON.stringify on the wire side: pass any object whose keys
   * match the schema field names. Missing keys are skipped, unknown
   * keys are ignored. Returns `this` for chaining.
   */
  fromObject(o) {
    if (o == null) return this;
    if (o.textBox !== undefined) this.textBox = o.textBox;
    if (o.tagBox !== undefined) this.tagBox = o.tagBox;
    return this;
  }

  /**
   * Build a UseBox from a plain JS object in one call.
   * Shorthand for `new UseBoxBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new UseBoxBuilder(cpp).fromObject(o);
  }

  /** Serialize the message to framed Cap'n Proto bytes. */
  toBytes() {
    const len = this._exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    const out = this._cpp._outPtr;
    return this._cpp._u8.slice(out, out + len);
  }
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a Box$TextReader.
 */
export function openBox$Text(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new Box$TextReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openBox$TextUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new Box$TextReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new Box$Text message. Returns a Box$TextBuilder. */
export function buildBox$Text(cpp) {
  return new Box$TextBuilder(cpp);
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a Box$TagReader.
 */
export function openBox$Tag(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new Box$TagReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openBox$TagUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new Box$TagReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new Box$Tag message. Returns a Box$TagBuilder. */
export function buildBox$Tag(cpp) {
  return new Box$TagBuilder(cpp);
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a TagReader.
 */
export function openTag(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new TagReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openTagUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new TagReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new Tag message. Returns a TagBuilder. */
export function buildTag(cpp) {
  return new TagBuilder(cpp);
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a BoxReader.
 */
export function openBox(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new BoxReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openBoxUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new BoxReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new Box message. Returns a BoxBuilder. */
export function buildBox(cpp) {
  return new BoxBuilder(cpp);
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a UseBoxReader.
 */
export function openUseBox(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new UseBoxReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openUseBoxUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new UseBoxReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new UseBox message. Returns a UseBoxBuilder. */
export function buildUseBox(cpp) {
  return new UseBoxBuilder(cpp);
}

