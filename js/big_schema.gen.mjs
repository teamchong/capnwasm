// Generated from big_schema.capnp by capnwasm-gen. Do not edit by hand.

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
        const buildFusedProxy = (filter) => ({
          map(childFn) {
            const idx = recordMap(childFn, filter);
            return _makeListMapTag(idx, null);
          },
          filter(predicateFn) {
            const parsed = _parseSimplePredicate(predicateFn);
            if (parsed) return buildFusedProxy(parsed);
            return buildSafeProxy();
          }
        });
        const buildSafeProxy = () => ({
          map(childFn) { recordMap(childFn, null); return []; },
          filter() { return buildSafeProxy(); }
        });
        return buildFusedProxy(null);
      }
      if (_STRUCT_FIELDS[desc.type]) return make(_STRUCT_FIELDS[desc.type], nextPath);
      const key = nextPath.join(".");
      if (!seen.has(key)) { seen.add(key); selected.push({ kind: "field", path: nextPath }); }
      return undefined;
    }
  });
  const result = fn(make(fields, []));
  let outerListMapIdx = -1;
  let outerSlice = null;
  if (result && typeof result === "object" && _LIST_MAP_TAG in result) {
    outerListMapIdx = result[_LIST_MAP_TAG];
    if (_LIST_MAP_SLICE_TAG in result) outerSlice = result[_LIST_MAP_SLICE_TAG];
  }
  return { selected, outerListMapIdx, outerSlice };
}
function _compilePlan(selected, outerListMapIdx, outerSlice) {
  const leaf = [];
  const nestedRaw = new Map();
  const listMapRaw = [];
  let outerListMapPos = -1;
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
  return { leaf, nested, listMap, outerListMapPos, outerSlice };
}
function _planDraft(fields, fn) {
  const raw = _planRaw(fields, fn);
  return { plan: _compilePlan(raw.selected, raw.outerListMapIdx, raw.outerSlice) };
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
  return out;
}
function _runDraft(cpp, fields, fn) {
  const plan = _getDraftPlan(fields, fn);
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
  if (plan.nested.length === 0 && plan.listMap.length === 0) {
    return fn(_capnwasmPick(cpp, fields, plan.leaf));
  }
  return fn(_materializeDraft(cpp, fields, plan));
}

export class BigUserReader {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 256;
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


  get field0() {
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
  get field1() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 1, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(1);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field2() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 2, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(2);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field3() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 3, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(3);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field4() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 4, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(4);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field5() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 5, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(5);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field6() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 6, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(6);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field7() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 7, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(7);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field8() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 8, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(8);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field9() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 9, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(9);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field10() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 10, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(10);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field11() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 11, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(11);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field12() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 12, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(12);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field13() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 13, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(13);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field14() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 14, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(14);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field15() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 15, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(15);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field16() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 16, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(16);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field17() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 17, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(17);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field18() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 18, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(18);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field19() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 19, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(19);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field20() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 20, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(20);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field21() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 21, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(21);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field22() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 22, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(22);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field23() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 23, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(23);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field24() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 24, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(24);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field25() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 25, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(25);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field26() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 26, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(26);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field27() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 27, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(27);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field28() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 28, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(28);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field29() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 29, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(29);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field30() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 30, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(30);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field31() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 31, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(31);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field32() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 32, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(32);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field33() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 33, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(33);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field34() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 34, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(34);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field35() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 35, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(35);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field36() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 36, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(36);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field37() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 37, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(37);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field38() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 38, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(38);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field39() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 39, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(39);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field40() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 40, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(40);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field41() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 41, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(41);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field42() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 42, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(42);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field43() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 43, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(43);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field44() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 44, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(44);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field45() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 45, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(45);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field46() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 46, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(46);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field47() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 47, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(47);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field48() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 48, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(48);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field49() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 49, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(49);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field50() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 50, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(50);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field51() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 51, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(51);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field52() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 52, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(52);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field53() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 53, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(53);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field54() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 54, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(54);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field55() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 55, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(55);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field56() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 56, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(56);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field57() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 57, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(57);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field58() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 58, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(58);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field59() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 59, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(59);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field60() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 60, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(60);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field61() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 61, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(61);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field62() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 62, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(62);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field63() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 63, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(63);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field64() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 64, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(64);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field65() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 65, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(65);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field66() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 66, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(66);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field67() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 67, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(67);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field68() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 68, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(68);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field69() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 69, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(69);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field70() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 70, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(70);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field71() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 71, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(71);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field72() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 72, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(72);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field73() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 73, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(73);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field74() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 74, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(74);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field75() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 75, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(75);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field76() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 76, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(76);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field77() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 77, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(77);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field78() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 78, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(78);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field79() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 79, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(79);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field80() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 80, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(80);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field81() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 81, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(81);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field82() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 82, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(82);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field83() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 83, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(83);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field84() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 84, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(84);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field85() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 85, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(85);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field86() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 86, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(86);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field87() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 87, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(87);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field88() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 88, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(88);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field89() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 89, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(89);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field90() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 90, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(90);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field91() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 91, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(91);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field92() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 92, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(92);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field93() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 93, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(93);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field94() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 94, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(94);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field95() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 95, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(95);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field96() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 96, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(96);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field97() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 97, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(97);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field98() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 98, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(98);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field99() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 99, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(99);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field100() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 100, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(100);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field101() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 101, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(101);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field102() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 102, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(102);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field103() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 103, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(103);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field104() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 104, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(104);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field105() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 105, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(105);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field106() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 106, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(106);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field107() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 107, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(107);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field108() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 108, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(108);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field109() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 109, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(109);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field110() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 110, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(110);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field111() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 111, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(111);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field112() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 112, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(112);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field113() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 113, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(113);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field114() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 114, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(114);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field115() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 115, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(115);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field116() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 116, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(116);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field117() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 117, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(117);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field118() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 118, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(118);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field119() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 119, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(119);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field120() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 120, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(120);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field121() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 121, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(121);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field122() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 122, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(122);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field123() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 123, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(123);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field124() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 124, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(124);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field125() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 125, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(125);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field126() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 126, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(126);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field127() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 127, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(127);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field128() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 128, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(128);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field129() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 129, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(129);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field130() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 130, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(130);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field131() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 131, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(131);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field132() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 132, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(132);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field133() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 133, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(133);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field134() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 134, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(134);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field135() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 135, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(135);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field136() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 136, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(136);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field137() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 137, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(137);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field138() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 138, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(138);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field139() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 139, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(139);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field140() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 140, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(140);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field141() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 141, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(141);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field142() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 142, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(142);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field143() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 143, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(143);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field144() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 144, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(144);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field145() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 145, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(145);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field146() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 146, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(146);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field147() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 147, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(147);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field148() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 148, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(148);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field149() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 149, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(149);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field150() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 150, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(150);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field151() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 151, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(151);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field152() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 152, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(152);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field153() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 153, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(153);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field154() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 154, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(154);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field155() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 155, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(155);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field156() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 156, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(156);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field157() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 157, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(157);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field158() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 158, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(158);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field159() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 159, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(159);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field160() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 160, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(160);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field161() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 161, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(161);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field162() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 162, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(162);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field163() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 163, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(163);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field164() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 164, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(164);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field165() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 165, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(165);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field166() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 166, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(166);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field167() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 167, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(167);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field168() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 168, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(168);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field169() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 169, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(169);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field170() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 170, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(170);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field171() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 171, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(171);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field172() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 172, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(172);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field173() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 173, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(173);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field174() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 174, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(174);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field175() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 175, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(175);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field176() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 176, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(176);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field177() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 177, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(177);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field178() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 178, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(178);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field179() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 179, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(179);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field180() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 180, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(180);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field181() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 181, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(181);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field182() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 182, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(182);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field183() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 183, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(183);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field184() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 184, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(184);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field185() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 185, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(185);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field186() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 186, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(186);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field187() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 187, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(187);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field188() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 188, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(188);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field189() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 189, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(189);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field190() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 190, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(190);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field191() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 191, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(191);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field192() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 192, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(192);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field193() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 193, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(193);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field194() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 194, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(194);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field195() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 195, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(195);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field196() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 196, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(196);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field197() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 197, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(197);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field198() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 198, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(198);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field199() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 199, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(199);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field200() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 200, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(200);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field201() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 201, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(201);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field202() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 202, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(202);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field203() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 203, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(203);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field204() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 204, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(204);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field205() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 205, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(205);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field206() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 206, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(206);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field207() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 207, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(207);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field208() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 208, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(208);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field209() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 209, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(209);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field210() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 210, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(210);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field211() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 211, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(211);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field212() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 212, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(212);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field213() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 213, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(213);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field214() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 214, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(214);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field215() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 215, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(215);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field216() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 216, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(216);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field217() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 217, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(217);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field218() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 218, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(218);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field219() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 219, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(219);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field220() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 220, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(220);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field221() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 221, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(221);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field222() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 222, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(222);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field223() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 223, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(223);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field224() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 224, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(224);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field225() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 225, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(225);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field226() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 226, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(226);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field227() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 227, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(227);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field228() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 228, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(228);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field229() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 229, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(229);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field230() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 230, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(230);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field231() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 231, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(231);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field232() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 232, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(232);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field233() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 233, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(233);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field234() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 234, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(234);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field235() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 235, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(235);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field236() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 236, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(236);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field237() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 237, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(237);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field238() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 238, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(238);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field239() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 239, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(239);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field240() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 240, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(240);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field241() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 241, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(241);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field242() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 242, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(242);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field243() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 243, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(243);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field244() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 244, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(244);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field245() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 245, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(245);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field246() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 246, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(246);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field247() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 247, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(247);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field248() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 248, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(248);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field249() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 249, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(249);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field250() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 250, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(250);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field251() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 251, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(251);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field252() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 252, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(252);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field253() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 253, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(253);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field254() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 254, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(254);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field255() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 0, 255, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(255);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }

  static _FIELDS = {
    field0: {"kind":0,"off":0,"type":"text"},
    field1: {"kind":0,"off":1,"type":"text"},
    field2: {"kind":0,"off":2,"type":"text"},
    field3: {"kind":0,"off":3,"type":"text"},
    field4: {"kind":0,"off":4,"type":"text"},
    field5: {"kind":0,"off":5,"type":"text"},
    field6: {"kind":0,"off":6,"type":"text"},
    field7: {"kind":0,"off":7,"type":"text"},
    field8: {"kind":0,"off":8,"type":"text"},
    field9: {"kind":0,"off":9,"type":"text"},
    field10: {"kind":0,"off":10,"type":"text"},
    field11: {"kind":0,"off":11,"type":"text"},
    field12: {"kind":0,"off":12,"type":"text"},
    field13: {"kind":0,"off":13,"type":"text"},
    field14: {"kind":0,"off":14,"type":"text"},
    field15: {"kind":0,"off":15,"type":"text"},
    field16: {"kind":0,"off":16,"type":"text"},
    field17: {"kind":0,"off":17,"type":"text"},
    field18: {"kind":0,"off":18,"type":"text"},
    field19: {"kind":0,"off":19,"type":"text"},
    field20: {"kind":0,"off":20,"type":"text"},
    field21: {"kind":0,"off":21,"type":"text"},
    field22: {"kind":0,"off":22,"type":"text"},
    field23: {"kind":0,"off":23,"type":"text"},
    field24: {"kind":0,"off":24,"type":"text"},
    field25: {"kind":0,"off":25,"type":"text"},
    field26: {"kind":0,"off":26,"type":"text"},
    field27: {"kind":0,"off":27,"type":"text"},
    field28: {"kind":0,"off":28,"type":"text"},
    field29: {"kind":0,"off":29,"type":"text"},
    field30: {"kind":0,"off":30,"type":"text"},
    field31: {"kind":0,"off":31,"type":"text"},
    field32: {"kind":0,"off":32,"type":"text"},
    field33: {"kind":0,"off":33,"type":"text"},
    field34: {"kind":0,"off":34,"type":"text"},
    field35: {"kind":0,"off":35,"type":"text"},
    field36: {"kind":0,"off":36,"type":"text"},
    field37: {"kind":0,"off":37,"type":"text"},
    field38: {"kind":0,"off":38,"type":"text"},
    field39: {"kind":0,"off":39,"type":"text"},
    field40: {"kind":0,"off":40,"type":"text"},
    field41: {"kind":0,"off":41,"type":"text"},
    field42: {"kind":0,"off":42,"type":"text"},
    field43: {"kind":0,"off":43,"type":"text"},
    field44: {"kind":0,"off":44,"type":"text"},
    field45: {"kind":0,"off":45,"type":"text"},
    field46: {"kind":0,"off":46,"type":"text"},
    field47: {"kind":0,"off":47,"type":"text"},
    field48: {"kind":0,"off":48,"type":"text"},
    field49: {"kind":0,"off":49,"type":"text"},
    field50: {"kind":0,"off":50,"type":"text"},
    field51: {"kind":0,"off":51,"type":"text"},
    field52: {"kind":0,"off":52,"type":"text"},
    field53: {"kind":0,"off":53,"type":"text"},
    field54: {"kind":0,"off":54,"type":"text"},
    field55: {"kind":0,"off":55,"type":"text"},
    field56: {"kind":0,"off":56,"type":"text"},
    field57: {"kind":0,"off":57,"type":"text"},
    field58: {"kind":0,"off":58,"type":"text"},
    field59: {"kind":0,"off":59,"type":"text"},
    field60: {"kind":0,"off":60,"type":"text"},
    field61: {"kind":0,"off":61,"type":"text"},
    field62: {"kind":0,"off":62,"type":"text"},
    field63: {"kind":0,"off":63,"type":"text"},
    field64: {"kind":0,"off":64,"type":"text"},
    field65: {"kind":0,"off":65,"type":"text"},
    field66: {"kind":0,"off":66,"type":"text"},
    field67: {"kind":0,"off":67,"type":"text"},
    field68: {"kind":0,"off":68,"type":"text"},
    field69: {"kind":0,"off":69,"type":"text"},
    field70: {"kind":0,"off":70,"type":"text"},
    field71: {"kind":0,"off":71,"type":"text"},
    field72: {"kind":0,"off":72,"type":"text"},
    field73: {"kind":0,"off":73,"type":"text"},
    field74: {"kind":0,"off":74,"type":"text"},
    field75: {"kind":0,"off":75,"type":"text"},
    field76: {"kind":0,"off":76,"type":"text"},
    field77: {"kind":0,"off":77,"type":"text"},
    field78: {"kind":0,"off":78,"type":"text"},
    field79: {"kind":0,"off":79,"type":"text"},
    field80: {"kind":0,"off":80,"type":"text"},
    field81: {"kind":0,"off":81,"type":"text"},
    field82: {"kind":0,"off":82,"type":"text"},
    field83: {"kind":0,"off":83,"type":"text"},
    field84: {"kind":0,"off":84,"type":"text"},
    field85: {"kind":0,"off":85,"type":"text"},
    field86: {"kind":0,"off":86,"type":"text"},
    field87: {"kind":0,"off":87,"type":"text"},
    field88: {"kind":0,"off":88,"type":"text"},
    field89: {"kind":0,"off":89,"type":"text"},
    field90: {"kind":0,"off":90,"type":"text"},
    field91: {"kind":0,"off":91,"type":"text"},
    field92: {"kind":0,"off":92,"type":"text"},
    field93: {"kind":0,"off":93,"type":"text"},
    field94: {"kind":0,"off":94,"type":"text"},
    field95: {"kind":0,"off":95,"type":"text"},
    field96: {"kind":0,"off":96,"type":"text"},
    field97: {"kind":0,"off":97,"type":"text"},
    field98: {"kind":0,"off":98,"type":"text"},
    field99: {"kind":0,"off":99,"type":"text"},
    field100: {"kind":0,"off":100,"type":"text"},
    field101: {"kind":0,"off":101,"type":"text"},
    field102: {"kind":0,"off":102,"type":"text"},
    field103: {"kind":0,"off":103,"type":"text"},
    field104: {"kind":0,"off":104,"type":"text"},
    field105: {"kind":0,"off":105,"type":"text"},
    field106: {"kind":0,"off":106,"type":"text"},
    field107: {"kind":0,"off":107,"type":"text"},
    field108: {"kind":0,"off":108,"type":"text"},
    field109: {"kind":0,"off":109,"type":"text"},
    field110: {"kind":0,"off":110,"type":"text"},
    field111: {"kind":0,"off":111,"type":"text"},
    field112: {"kind":0,"off":112,"type":"text"},
    field113: {"kind":0,"off":113,"type":"text"},
    field114: {"kind":0,"off":114,"type":"text"},
    field115: {"kind":0,"off":115,"type":"text"},
    field116: {"kind":0,"off":116,"type":"text"},
    field117: {"kind":0,"off":117,"type":"text"},
    field118: {"kind":0,"off":118,"type":"text"},
    field119: {"kind":0,"off":119,"type":"text"},
    field120: {"kind":0,"off":120,"type":"text"},
    field121: {"kind":0,"off":121,"type":"text"},
    field122: {"kind":0,"off":122,"type":"text"},
    field123: {"kind":0,"off":123,"type":"text"},
    field124: {"kind":0,"off":124,"type":"text"},
    field125: {"kind":0,"off":125,"type":"text"},
    field126: {"kind":0,"off":126,"type":"text"},
    field127: {"kind":0,"off":127,"type":"text"},
    field128: {"kind":0,"off":128,"type":"text"},
    field129: {"kind":0,"off":129,"type":"text"},
    field130: {"kind":0,"off":130,"type":"text"},
    field131: {"kind":0,"off":131,"type":"text"},
    field132: {"kind":0,"off":132,"type":"text"},
    field133: {"kind":0,"off":133,"type":"text"},
    field134: {"kind":0,"off":134,"type":"text"},
    field135: {"kind":0,"off":135,"type":"text"},
    field136: {"kind":0,"off":136,"type":"text"},
    field137: {"kind":0,"off":137,"type":"text"},
    field138: {"kind":0,"off":138,"type":"text"},
    field139: {"kind":0,"off":139,"type":"text"},
    field140: {"kind":0,"off":140,"type":"text"},
    field141: {"kind":0,"off":141,"type":"text"},
    field142: {"kind":0,"off":142,"type":"text"},
    field143: {"kind":0,"off":143,"type":"text"},
    field144: {"kind":0,"off":144,"type":"text"},
    field145: {"kind":0,"off":145,"type":"text"},
    field146: {"kind":0,"off":146,"type":"text"},
    field147: {"kind":0,"off":147,"type":"text"},
    field148: {"kind":0,"off":148,"type":"text"},
    field149: {"kind":0,"off":149,"type":"text"},
    field150: {"kind":0,"off":150,"type":"text"},
    field151: {"kind":0,"off":151,"type":"text"},
    field152: {"kind":0,"off":152,"type":"text"},
    field153: {"kind":0,"off":153,"type":"text"},
    field154: {"kind":0,"off":154,"type":"text"},
    field155: {"kind":0,"off":155,"type":"text"},
    field156: {"kind":0,"off":156,"type":"text"},
    field157: {"kind":0,"off":157,"type":"text"},
    field158: {"kind":0,"off":158,"type":"text"},
    field159: {"kind":0,"off":159,"type":"text"},
    field160: {"kind":0,"off":160,"type":"text"},
    field161: {"kind":0,"off":161,"type":"text"},
    field162: {"kind":0,"off":162,"type":"text"},
    field163: {"kind":0,"off":163,"type":"text"},
    field164: {"kind":0,"off":164,"type":"text"},
    field165: {"kind":0,"off":165,"type":"text"},
    field166: {"kind":0,"off":166,"type":"text"},
    field167: {"kind":0,"off":167,"type":"text"},
    field168: {"kind":0,"off":168,"type":"text"},
    field169: {"kind":0,"off":169,"type":"text"},
    field170: {"kind":0,"off":170,"type":"text"},
    field171: {"kind":0,"off":171,"type":"text"},
    field172: {"kind":0,"off":172,"type":"text"},
    field173: {"kind":0,"off":173,"type":"text"},
    field174: {"kind":0,"off":174,"type":"text"},
    field175: {"kind":0,"off":175,"type":"text"},
    field176: {"kind":0,"off":176,"type":"text"},
    field177: {"kind":0,"off":177,"type":"text"},
    field178: {"kind":0,"off":178,"type":"text"},
    field179: {"kind":0,"off":179,"type":"text"},
    field180: {"kind":0,"off":180,"type":"text"},
    field181: {"kind":0,"off":181,"type":"text"},
    field182: {"kind":0,"off":182,"type":"text"},
    field183: {"kind":0,"off":183,"type":"text"},
    field184: {"kind":0,"off":184,"type":"text"},
    field185: {"kind":0,"off":185,"type":"text"},
    field186: {"kind":0,"off":186,"type":"text"},
    field187: {"kind":0,"off":187,"type":"text"},
    field188: {"kind":0,"off":188,"type":"text"},
    field189: {"kind":0,"off":189,"type":"text"},
    field190: {"kind":0,"off":190,"type":"text"},
    field191: {"kind":0,"off":191,"type":"text"},
    field192: {"kind":0,"off":192,"type":"text"},
    field193: {"kind":0,"off":193,"type":"text"},
    field194: {"kind":0,"off":194,"type":"text"},
    field195: {"kind":0,"off":195,"type":"text"},
    field196: {"kind":0,"off":196,"type":"text"},
    field197: {"kind":0,"off":197,"type":"text"},
    field198: {"kind":0,"off":198,"type":"text"},
    field199: {"kind":0,"off":199,"type":"text"},
    field200: {"kind":0,"off":200,"type":"text"},
    field201: {"kind":0,"off":201,"type":"text"},
    field202: {"kind":0,"off":202,"type":"text"},
    field203: {"kind":0,"off":203,"type":"text"},
    field204: {"kind":0,"off":204,"type":"text"},
    field205: {"kind":0,"off":205,"type":"text"},
    field206: {"kind":0,"off":206,"type":"text"},
    field207: {"kind":0,"off":207,"type":"text"},
    field208: {"kind":0,"off":208,"type":"text"},
    field209: {"kind":0,"off":209,"type":"text"},
    field210: {"kind":0,"off":210,"type":"text"},
    field211: {"kind":0,"off":211,"type":"text"},
    field212: {"kind":0,"off":212,"type":"text"},
    field213: {"kind":0,"off":213,"type":"text"},
    field214: {"kind":0,"off":214,"type":"text"},
    field215: {"kind":0,"off":215,"type":"text"},
    field216: {"kind":0,"off":216,"type":"text"},
    field217: {"kind":0,"off":217,"type":"text"},
    field218: {"kind":0,"off":218,"type":"text"},
    field219: {"kind":0,"off":219,"type":"text"},
    field220: {"kind":0,"off":220,"type":"text"},
    field221: {"kind":0,"off":221,"type":"text"},
    field222: {"kind":0,"off":222,"type":"text"},
    field223: {"kind":0,"off":223,"type":"text"},
    field224: {"kind":0,"off":224,"type":"text"},
    field225: {"kind":0,"off":225,"type":"text"},
    field226: {"kind":0,"off":226,"type":"text"},
    field227: {"kind":0,"off":227,"type":"text"},
    field228: {"kind":0,"off":228,"type":"text"},
    field229: {"kind":0,"off":229,"type":"text"},
    field230: {"kind":0,"off":230,"type":"text"},
    field231: {"kind":0,"off":231,"type":"text"},
    field232: {"kind":0,"off":232,"type":"text"},
    field233: {"kind":0,"off":233,"type":"text"},
    field234: {"kind":0,"off":234,"type":"text"},
    field235: {"kind":0,"off":235,"type":"text"},
    field236: {"kind":0,"off":236,"type":"text"},
    field237: {"kind":0,"off":237,"type":"text"},
    field238: {"kind":0,"off":238,"type":"text"},
    field239: {"kind":0,"off":239,"type":"text"},
    field240: {"kind":0,"off":240,"type":"text"},
    field241: {"kind":0,"off":241,"type":"text"},
    field242: {"kind":0,"off":242,"type":"text"},
    field243: {"kind":0,"off":243,"type":"text"},
    field244: {"kind":0,"off":244,"type":"text"},
    field245: {"kind":0,"off":245,"type":"text"},
    field246: {"kind":0,"off":246,"type":"text"},
    field247: {"kind":0,"off":247,"type":"text"},
    field248: {"kind":0,"off":248,"type":"text"},
    field249: {"kind":0,"off":249,"type":"text"},
    field250: {"kind":0,"off":250,"type":"text"},
    field251: {"kind":0,"off":251,"type":"text"},
    field252: {"kind":0,"off":252,"type":"text"},
    field253: {"kind":0,"off":253,"type":"text"},
    field254: {"kind":0,"off":254,"type":"text"},
    field255: {"kind":0,"off":255,"type":"text"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, BigUserReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, BigUserReader._FIELDS, Object.keys(BigUserReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  BigUserReader.prototype[Symbol.dispose] = BigUserReader.prototype.dispose;
}

_STRUCT_FIELDS["BigUser"] = BigUserReader._FIELDS;

export class BigUserBuilder {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 256;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(0, 256) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
    this._capSink = (opts && opts.capSink) || null;
  }

  set field0(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(0, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field1(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(1, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field2(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(2, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field3(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(3, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field4(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(4, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field5(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(5, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field6(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(6, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field7(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(7, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field8(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(8, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field9(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(9, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field10(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(10, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field11(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(11, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field12(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(12, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field13(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(13, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field14(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(14, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field15(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(15, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field16(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(16, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field17(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(17, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field18(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(18, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field19(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(19, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field20(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(20, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field21(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(21, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field22(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(22, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field23(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(23, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field24(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(24, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field25(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(25, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field26(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(26, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field27(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(27, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field28(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(28, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field29(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(29, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field30(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(30, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field31(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(31, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field32(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(32, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field33(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(33, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field34(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(34, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field35(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(35, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field36(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(36, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field37(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(37, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field38(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(38, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field39(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(39, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field40(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(40, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field41(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(41, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field42(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(42, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field43(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(43, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field44(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(44, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field45(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(45, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field46(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(46, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field47(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(47, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field48(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(48, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field49(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(49, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field50(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(50, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field51(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(51, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field52(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(52, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field53(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(53, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field54(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(54, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field55(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(55, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field56(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(56, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field57(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(57, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field58(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(58, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field59(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(59, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field60(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(60, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field61(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(61, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field62(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(62, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field63(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(63, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field64(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(64, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field65(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(65, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field66(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(66, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field67(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(67, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field68(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(68, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field69(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(69, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field70(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(70, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field71(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(71, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field72(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(72, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field73(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(73, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field74(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(74, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field75(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(75, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field76(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(76, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field77(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(77, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field78(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(78, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field79(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(79, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field80(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(80, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field81(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(81, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field82(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(82, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field83(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(83, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field84(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(84, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field85(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(85, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field86(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(86, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field87(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(87, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field88(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(88, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field89(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(89, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field90(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(90, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field91(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(91, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field92(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(92, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field93(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(93, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field94(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(94, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field95(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(95, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field96(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(96, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field97(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(97, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field98(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(98, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field99(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(99, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field100(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(100, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field101(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(101, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field102(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(102, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field103(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(103, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field104(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(104, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field105(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(105, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field106(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(106, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field107(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(107, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field108(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(108, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field109(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(109, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field110(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(110, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field111(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(111, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field112(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(112, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field113(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(113, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field114(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(114, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field115(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(115, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field116(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(116, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field117(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(117, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field118(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(118, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field119(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(119, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field120(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(120, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field121(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(121, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field122(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(122, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field123(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(123, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field124(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(124, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field125(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(125, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field126(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(126, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field127(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(127, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field128(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(128, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field129(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(129, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field130(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(130, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field131(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(131, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field132(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(132, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field133(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(133, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field134(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(134, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field135(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(135, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field136(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(136, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field137(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(137, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field138(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(138, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field139(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(139, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field140(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(140, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field141(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(141, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field142(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(142, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field143(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(143, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field144(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(144, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field145(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(145, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field146(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(146, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field147(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(147, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field148(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(148, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field149(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(149, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field150(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(150, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field151(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(151, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field152(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(152, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field153(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(153, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field154(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(154, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field155(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(155, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field156(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(156, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field157(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(157, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field158(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(158, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field159(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(159, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field160(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(160, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field161(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(161, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field162(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(162, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field163(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(163, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field164(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(164, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field165(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(165, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field166(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(166, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field167(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(167, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field168(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(168, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field169(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(169, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field170(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(170, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field171(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(171, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field172(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(172, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field173(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(173, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field174(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(174, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field175(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(175, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field176(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(176, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field177(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(177, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field178(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(178, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field179(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(179, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field180(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(180, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field181(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(181, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field182(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(182, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field183(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(183, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field184(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(184, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field185(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(185, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field186(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(186, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field187(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(187, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field188(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(188, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field189(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(189, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field190(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(190, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field191(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(191, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field192(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(192, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field193(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(193, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field194(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(194, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field195(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(195, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field196(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(196, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field197(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(197, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field198(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(198, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field199(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(199, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field200(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(200, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field201(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(201, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field202(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(202, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field203(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(203, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field204(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(204, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field205(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(205, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field206(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(206, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field207(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(207, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field208(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(208, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field209(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(209, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field210(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(210, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field211(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(211, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field212(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(212, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field213(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(213, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field214(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(214, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field215(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(215, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field216(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(216, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field217(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(217, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field218(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(218, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field219(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(219, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field220(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(220, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field221(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(221, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field222(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(222, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field223(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(223, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field224(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(224, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field225(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(225, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field226(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(226, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field227(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(227, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field228(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(228, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field229(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(229, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field230(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(230, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field231(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(231, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field232(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(232, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field233(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(233, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field234(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(234, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field235(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(235, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field236(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(236, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field237(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(237, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field238(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(238, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field239(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(239, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field240(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(240, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field241(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(241, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field242(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(242, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field243(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(243, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field244(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(244, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field245(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(245, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field246(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(246, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field247(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(247, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field248(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(248, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field249(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(249, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field250(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(250, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field251(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(251, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field252(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(252, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field253(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(253, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field254(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(254, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set field255(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(255, written);
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
    if (o.field0 !== undefined) this.field0 = o.field0;
    if (o.field1 !== undefined) this.field1 = o.field1;
    if (o.field2 !== undefined) this.field2 = o.field2;
    if (o.field3 !== undefined) this.field3 = o.field3;
    if (o.field4 !== undefined) this.field4 = o.field4;
    if (o.field5 !== undefined) this.field5 = o.field5;
    if (o.field6 !== undefined) this.field6 = o.field6;
    if (o.field7 !== undefined) this.field7 = o.field7;
    if (o.field8 !== undefined) this.field8 = o.field8;
    if (o.field9 !== undefined) this.field9 = o.field9;
    if (o.field10 !== undefined) this.field10 = o.field10;
    if (o.field11 !== undefined) this.field11 = o.field11;
    if (o.field12 !== undefined) this.field12 = o.field12;
    if (o.field13 !== undefined) this.field13 = o.field13;
    if (o.field14 !== undefined) this.field14 = o.field14;
    if (o.field15 !== undefined) this.field15 = o.field15;
    if (o.field16 !== undefined) this.field16 = o.field16;
    if (o.field17 !== undefined) this.field17 = o.field17;
    if (o.field18 !== undefined) this.field18 = o.field18;
    if (o.field19 !== undefined) this.field19 = o.field19;
    if (o.field20 !== undefined) this.field20 = o.field20;
    if (o.field21 !== undefined) this.field21 = o.field21;
    if (o.field22 !== undefined) this.field22 = o.field22;
    if (o.field23 !== undefined) this.field23 = o.field23;
    if (o.field24 !== undefined) this.field24 = o.field24;
    if (o.field25 !== undefined) this.field25 = o.field25;
    if (o.field26 !== undefined) this.field26 = o.field26;
    if (o.field27 !== undefined) this.field27 = o.field27;
    if (o.field28 !== undefined) this.field28 = o.field28;
    if (o.field29 !== undefined) this.field29 = o.field29;
    if (o.field30 !== undefined) this.field30 = o.field30;
    if (o.field31 !== undefined) this.field31 = o.field31;
    if (o.field32 !== undefined) this.field32 = o.field32;
    if (o.field33 !== undefined) this.field33 = o.field33;
    if (o.field34 !== undefined) this.field34 = o.field34;
    if (o.field35 !== undefined) this.field35 = o.field35;
    if (o.field36 !== undefined) this.field36 = o.field36;
    if (o.field37 !== undefined) this.field37 = o.field37;
    if (o.field38 !== undefined) this.field38 = o.field38;
    if (o.field39 !== undefined) this.field39 = o.field39;
    if (o.field40 !== undefined) this.field40 = o.field40;
    if (o.field41 !== undefined) this.field41 = o.field41;
    if (o.field42 !== undefined) this.field42 = o.field42;
    if (o.field43 !== undefined) this.field43 = o.field43;
    if (o.field44 !== undefined) this.field44 = o.field44;
    if (o.field45 !== undefined) this.field45 = o.field45;
    if (o.field46 !== undefined) this.field46 = o.field46;
    if (o.field47 !== undefined) this.field47 = o.field47;
    if (o.field48 !== undefined) this.field48 = o.field48;
    if (o.field49 !== undefined) this.field49 = o.field49;
    if (o.field50 !== undefined) this.field50 = o.field50;
    if (o.field51 !== undefined) this.field51 = o.field51;
    if (o.field52 !== undefined) this.field52 = o.field52;
    if (o.field53 !== undefined) this.field53 = o.field53;
    if (o.field54 !== undefined) this.field54 = o.field54;
    if (o.field55 !== undefined) this.field55 = o.field55;
    if (o.field56 !== undefined) this.field56 = o.field56;
    if (o.field57 !== undefined) this.field57 = o.field57;
    if (o.field58 !== undefined) this.field58 = o.field58;
    if (o.field59 !== undefined) this.field59 = o.field59;
    if (o.field60 !== undefined) this.field60 = o.field60;
    if (o.field61 !== undefined) this.field61 = o.field61;
    if (o.field62 !== undefined) this.field62 = o.field62;
    if (o.field63 !== undefined) this.field63 = o.field63;
    if (o.field64 !== undefined) this.field64 = o.field64;
    if (o.field65 !== undefined) this.field65 = o.field65;
    if (o.field66 !== undefined) this.field66 = o.field66;
    if (o.field67 !== undefined) this.field67 = o.field67;
    if (o.field68 !== undefined) this.field68 = o.field68;
    if (o.field69 !== undefined) this.field69 = o.field69;
    if (o.field70 !== undefined) this.field70 = o.field70;
    if (o.field71 !== undefined) this.field71 = o.field71;
    if (o.field72 !== undefined) this.field72 = o.field72;
    if (o.field73 !== undefined) this.field73 = o.field73;
    if (o.field74 !== undefined) this.field74 = o.field74;
    if (o.field75 !== undefined) this.field75 = o.field75;
    if (o.field76 !== undefined) this.field76 = o.field76;
    if (o.field77 !== undefined) this.field77 = o.field77;
    if (o.field78 !== undefined) this.field78 = o.field78;
    if (o.field79 !== undefined) this.field79 = o.field79;
    if (o.field80 !== undefined) this.field80 = o.field80;
    if (o.field81 !== undefined) this.field81 = o.field81;
    if (o.field82 !== undefined) this.field82 = o.field82;
    if (o.field83 !== undefined) this.field83 = o.field83;
    if (o.field84 !== undefined) this.field84 = o.field84;
    if (o.field85 !== undefined) this.field85 = o.field85;
    if (o.field86 !== undefined) this.field86 = o.field86;
    if (o.field87 !== undefined) this.field87 = o.field87;
    if (o.field88 !== undefined) this.field88 = o.field88;
    if (o.field89 !== undefined) this.field89 = o.field89;
    if (o.field90 !== undefined) this.field90 = o.field90;
    if (o.field91 !== undefined) this.field91 = o.field91;
    if (o.field92 !== undefined) this.field92 = o.field92;
    if (o.field93 !== undefined) this.field93 = o.field93;
    if (o.field94 !== undefined) this.field94 = o.field94;
    if (o.field95 !== undefined) this.field95 = o.field95;
    if (o.field96 !== undefined) this.field96 = o.field96;
    if (o.field97 !== undefined) this.field97 = o.field97;
    if (o.field98 !== undefined) this.field98 = o.field98;
    if (o.field99 !== undefined) this.field99 = o.field99;
    if (o.field100 !== undefined) this.field100 = o.field100;
    if (o.field101 !== undefined) this.field101 = o.field101;
    if (o.field102 !== undefined) this.field102 = o.field102;
    if (o.field103 !== undefined) this.field103 = o.field103;
    if (o.field104 !== undefined) this.field104 = o.field104;
    if (o.field105 !== undefined) this.field105 = o.field105;
    if (o.field106 !== undefined) this.field106 = o.field106;
    if (o.field107 !== undefined) this.field107 = o.field107;
    if (o.field108 !== undefined) this.field108 = o.field108;
    if (o.field109 !== undefined) this.field109 = o.field109;
    if (o.field110 !== undefined) this.field110 = o.field110;
    if (o.field111 !== undefined) this.field111 = o.field111;
    if (o.field112 !== undefined) this.field112 = o.field112;
    if (o.field113 !== undefined) this.field113 = o.field113;
    if (o.field114 !== undefined) this.field114 = o.field114;
    if (o.field115 !== undefined) this.field115 = o.field115;
    if (o.field116 !== undefined) this.field116 = o.field116;
    if (o.field117 !== undefined) this.field117 = o.field117;
    if (o.field118 !== undefined) this.field118 = o.field118;
    if (o.field119 !== undefined) this.field119 = o.field119;
    if (o.field120 !== undefined) this.field120 = o.field120;
    if (o.field121 !== undefined) this.field121 = o.field121;
    if (o.field122 !== undefined) this.field122 = o.field122;
    if (o.field123 !== undefined) this.field123 = o.field123;
    if (o.field124 !== undefined) this.field124 = o.field124;
    if (o.field125 !== undefined) this.field125 = o.field125;
    if (o.field126 !== undefined) this.field126 = o.field126;
    if (o.field127 !== undefined) this.field127 = o.field127;
    if (o.field128 !== undefined) this.field128 = o.field128;
    if (o.field129 !== undefined) this.field129 = o.field129;
    if (o.field130 !== undefined) this.field130 = o.field130;
    if (o.field131 !== undefined) this.field131 = o.field131;
    if (o.field132 !== undefined) this.field132 = o.field132;
    if (o.field133 !== undefined) this.field133 = o.field133;
    if (o.field134 !== undefined) this.field134 = o.field134;
    if (o.field135 !== undefined) this.field135 = o.field135;
    if (o.field136 !== undefined) this.field136 = o.field136;
    if (o.field137 !== undefined) this.field137 = o.field137;
    if (o.field138 !== undefined) this.field138 = o.field138;
    if (o.field139 !== undefined) this.field139 = o.field139;
    if (o.field140 !== undefined) this.field140 = o.field140;
    if (o.field141 !== undefined) this.field141 = o.field141;
    if (o.field142 !== undefined) this.field142 = o.field142;
    if (o.field143 !== undefined) this.field143 = o.field143;
    if (o.field144 !== undefined) this.field144 = o.field144;
    if (o.field145 !== undefined) this.field145 = o.field145;
    if (o.field146 !== undefined) this.field146 = o.field146;
    if (o.field147 !== undefined) this.field147 = o.field147;
    if (o.field148 !== undefined) this.field148 = o.field148;
    if (o.field149 !== undefined) this.field149 = o.field149;
    if (o.field150 !== undefined) this.field150 = o.field150;
    if (o.field151 !== undefined) this.field151 = o.field151;
    if (o.field152 !== undefined) this.field152 = o.field152;
    if (o.field153 !== undefined) this.field153 = o.field153;
    if (o.field154 !== undefined) this.field154 = o.field154;
    if (o.field155 !== undefined) this.field155 = o.field155;
    if (o.field156 !== undefined) this.field156 = o.field156;
    if (o.field157 !== undefined) this.field157 = o.field157;
    if (o.field158 !== undefined) this.field158 = o.field158;
    if (o.field159 !== undefined) this.field159 = o.field159;
    if (o.field160 !== undefined) this.field160 = o.field160;
    if (o.field161 !== undefined) this.field161 = o.field161;
    if (o.field162 !== undefined) this.field162 = o.field162;
    if (o.field163 !== undefined) this.field163 = o.field163;
    if (o.field164 !== undefined) this.field164 = o.field164;
    if (o.field165 !== undefined) this.field165 = o.field165;
    if (o.field166 !== undefined) this.field166 = o.field166;
    if (o.field167 !== undefined) this.field167 = o.field167;
    if (o.field168 !== undefined) this.field168 = o.field168;
    if (o.field169 !== undefined) this.field169 = o.field169;
    if (o.field170 !== undefined) this.field170 = o.field170;
    if (o.field171 !== undefined) this.field171 = o.field171;
    if (o.field172 !== undefined) this.field172 = o.field172;
    if (o.field173 !== undefined) this.field173 = o.field173;
    if (o.field174 !== undefined) this.field174 = o.field174;
    if (o.field175 !== undefined) this.field175 = o.field175;
    if (o.field176 !== undefined) this.field176 = o.field176;
    if (o.field177 !== undefined) this.field177 = o.field177;
    if (o.field178 !== undefined) this.field178 = o.field178;
    if (o.field179 !== undefined) this.field179 = o.field179;
    if (o.field180 !== undefined) this.field180 = o.field180;
    if (o.field181 !== undefined) this.field181 = o.field181;
    if (o.field182 !== undefined) this.field182 = o.field182;
    if (o.field183 !== undefined) this.field183 = o.field183;
    if (o.field184 !== undefined) this.field184 = o.field184;
    if (o.field185 !== undefined) this.field185 = o.field185;
    if (o.field186 !== undefined) this.field186 = o.field186;
    if (o.field187 !== undefined) this.field187 = o.field187;
    if (o.field188 !== undefined) this.field188 = o.field188;
    if (o.field189 !== undefined) this.field189 = o.field189;
    if (o.field190 !== undefined) this.field190 = o.field190;
    if (o.field191 !== undefined) this.field191 = o.field191;
    if (o.field192 !== undefined) this.field192 = o.field192;
    if (o.field193 !== undefined) this.field193 = o.field193;
    if (o.field194 !== undefined) this.field194 = o.field194;
    if (o.field195 !== undefined) this.field195 = o.field195;
    if (o.field196 !== undefined) this.field196 = o.field196;
    if (o.field197 !== undefined) this.field197 = o.field197;
    if (o.field198 !== undefined) this.field198 = o.field198;
    if (o.field199 !== undefined) this.field199 = o.field199;
    if (o.field200 !== undefined) this.field200 = o.field200;
    if (o.field201 !== undefined) this.field201 = o.field201;
    if (o.field202 !== undefined) this.field202 = o.field202;
    if (o.field203 !== undefined) this.field203 = o.field203;
    if (o.field204 !== undefined) this.field204 = o.field204;
    if (o.field205 !== undefined) this.field205 = o.field205;
    if (o.field206 !== undefined) this.field206 = o.field206;
    if (o.field207 !== undefined) this.field207 = o.field207;
    if (o.field208 !== undefined) this.field208 = o.field208;
    if (o.field209 !== undefined) this.field209 = o.field209;
    if (o.field210 !== undefined) this.field210 = o.field210;
    if (o.field211 !== undefined) this.field211 = o.field211;
    if (o.field212 !== undefined) this.field212 = o.field212;
    if (o.field213 !== undefined) this.field213 = o.field213;
    if (o.field214 !== undefined) this.field214 = o.field214;
    if (o.field215 !== undefined) this.field215 = o.field215;
    if (o.field216 !== undefined) this.field216 = o.field216;
    if (o.field217 !== undefined) this.field217 = o.field217;
    if (o.field218 !== undefined) this.field218 = o.field218;
    if (o.field219 !== undefined) this.field219 = o.field219;
    if (o.field220 !== undefined) this.field220 = o.field220;
    if (o.field221 !== undefined) this.field221 = o.field221;
    if (o.field222 !== undefined) this.field222 = o.field222;
    if (o.field223 !== undefined) this.field223 = o.field223;
    if (o.field224 !== undefined) this.field224 = o.field224;
    if (o.field225 !== undefined) this.field225 = o.field225;
    if (o.field226 !== undefined) this.field226 = o.field226;
    if (o.field227 !== undefined) this.field227 = o.field227;
    if (o.field228 !== undefined) this.field228 = o.field228;
    if (o.field229 !== undefined) this.field229 = o.field229;
    if (o.field230 !== undefined) this.field230 = o.field230;
    if (o.field231 !== undefined) this.field231 = o.field231;
    if (o.field232 !== undefined) this.field232 = o.field232;
    if (o.field233 !== undefined) this.field233 = o.field233;
    if (o.field234 !== undefined) this.field234 = o.field234;
    if (o.field235 !== undefined) this.field235 = o.field235;
    if (o.field236 !== undefined) this.field236 = o.field236;
    if (o.field237 !== undefined) this.field237 = o.field237;
    if (o.field238 !== undefined) this.field238 = o.field238;
    if (o.field239 !== undefined) this.field239 = o.field239;
    if (o.field240 !== undefined) this.field240 = o.field240;
    if (o.field241 !== undefined) this.field241 = o.field241;
    if (o.field242 !== undefined) this.field242 = o.field242;
    if (o.field243 !== undefined) this.field243 = o.field243;
    if (o.field244 !== undefined) this.field244 = o.field244;
    if (o.field245 !== undefined) this.field245 = o.field245;
    if (o.field246 !== undefined) this.field246 = o.field246;
    if (o.field247 !== undefined) this.field247 = o.field247;
    if (o.field248 !== undefined) this.field248 = o.field248;
    if (o.field249 !== undefined) this.field249 = o.field249;
    if (o.field250 !== undefined) this.field250 = o.field250;
    if (o.field251 !== undefined) this.field251 = o.field251;
    if (o.field252 !== undefined) this.field252 = o.field252;
    if (o.field253 !== undefined) this.field253 = o.field253;
    if (o.field254 !== undefined) this.field254 = o.field254;
    if (o.field255 !== undefined) this.field255 = o.field255;
    return this;
  }

  /**
   * Build a BigUser from a plain JS object in one call.
   * Shorthand for `new BigUserBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new BigUserBuilder(cpp).fromObject(o);
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
 * Open framed Cap'n Proto bytes for typed access. Returns a BigUserReader.
 */
export function openBigUser(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new BigUserReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openBigUserUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new BigUserReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new BigUser message. Returns a BigUserBuilder. */
export function buildBigUser(cpp) {
  return new BigUserBuilder(cpp);
}

