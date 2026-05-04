// Generated from conformance_schema.capnp by capnwasm-gen. Do not edit by hand.

const SHARED_TEXT_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();
function decodeAscii(bytes) {
  return SHARED_TEXT_DECODER.decode(bytes);
}

function _jsReadTextPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
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

function _jsReadDataPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
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
      out.push(`    const _blob = _total === 0 ? "" : TD.decode(u8.subarray(out + readPos, out + readPos + _total));`);
      // Walk substrings.
      let cumExpr = "0";
      for (let p = 0; p < batch.total; p++) {
        const m = batch.members[p];
        const startExpr = cumExpr;
        const endExpr = `${cumExpr} + _b${m}`;
        out.push(
          `    _v${m} = _h${m} === 0xFFFFFFFF ? undefined : _h${m} === 0 ? "" : _blob.substring(${startExpr}, ${endExpr});`,
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
        out.push(`    else { _v${col} = TD.decode(u8.subarray(out + readPos, out + readPos + _h)); readPos += _h; } }`);
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
  if (typeof cpp._validateSingleSegment === "function") {
    cpp._validateSingleSegment(bytes);
  }
  if (!unsafe && typeof cpp._acquireSlot === "function" && cpp._supportsReaderSlotPool && cpp._supportsReaderSlotPool()) {
    const acquired = cpp._acquireSlot(bytes);
    if (acquired) {
      return { dataPtr: acquired.dataPtr, slotIdx: acquired.slotIdx, slotHandle: acquired.handle, msgStart: acquired.msgStart, msgEnd: acquired.msgEnd, msg: null, gen: cpp._generation };
    }
  }
  if (!unsafe && typeof cpp._allocMessage === "function") {
    const msg = cpp._allocMessage(bytes);
    const dataPtr = cpp._openAnyMessage(msg);
    return { dataPtr, slotIdx: 0, slotHandle: null, msg, gen: cpp._generation };
  }
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  const dataPtr = cpp._exports.cpp_any_open(bytes.length);
  if (typeof cpp._bumpGeneration === "function") cpp._bumpGeneration();
  return { dataPtr, slotIdx: 0, slotHandle: null, msg: null, gen: cpp._generation ?? 0 };
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

export class PrimitivesReader {
  static _DATA_WORDS = 6;
  static _PTR_WORDS = 4;
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


  get u8() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u8[this._dataPtr + 0] : this._exp.cpp_any_uint8_at(0, 0);
  }
  get u16() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u16[(this._dataPtr + 2) >>> 1] : this._exp.cpp_any_uint16_at(2, 0);
  }
  get u32() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u32[(this._dataPtr + 4) >>> 2] : this._exp.cpp_any_uint32_at(4, 0);
  }
  get u64() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._dv.getBigUint64(this._dataPtr + 8, true) : this._exp.cpp_any_int64_at(8, 0n);
  }
  get i8() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? ((this._u8[this._dataPtr + 1] << 24) >> 24) : ((this._exp.cpp_any_uint8_at(1, 0) << 24) >> 24);
  }
  get i16() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._i16[(this._dataPtr + 16) >>> 1] : ((this._exp.cpp_any_uint16_at(16, 0) << 16) >> 16);
  }
  get i32() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._i32[(this._dataPtr + 20) >>> 2] : (this._exp.cpp_any_uint32_at(20, 0) | 0);
  }
  get i64() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._dv.getBigInt64(this._dataPtr + 24, true) : this._exp.cpp_any_int64_at(24, 0n);
  }
  get f32() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._f32[(this._dataPtr + 32) >>> 2] : (function(){ _F32_VIEW_U32[0] = (this._exp.cpp_any_uint32_at(32, 0) >>> 0); return _F32_VIEW_F32[0]; }).call(this);
  }
  get f64() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._f64[(this._dataPtr + 40) >>> 3] : (function(){ _F64_VIEW_U32[0] = (this._exp.cpp_any_uint32_at(40, 0) >>> 0); _F64_VIEW_U32[1] = (this._exp.cpp_any_uint32_at(44, 0) >>> 0); return _F64_VIEW_F64[0]; }).call(this);
  }
  get flag0() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? ((this._u8[this._dataPtr + 18] >> 0) & 1) === 1 : this._exp.cpp_any_bool_at(144, 0) === 1;
  }
  get flag1() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? ((this._u8[this._dataPtr + 18] >> 1) & 1) === 1 : this._exp.cpp_any_bool_at(145, 0) === 1;
  }
  get flag2() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? ((this._u8[this._dataPtr + 18] >> 2) & 1) === 1 : this._exp.cpp_any_bool_at(146, 0) === 1;
  }
  get text() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 6, 0, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get data() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadDataPtr(this._u8, this._dv, this._dataPtr, 6, 1, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? new Uint8Array(0);
    }
    const len = this._exp.cpp_any_data_at(1);
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return u8.slice(out, out + len);
  }
  get emptyText() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, 6, 2, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? "";
    }
    const len = this._exp.cpp_any_text_at(2);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get emptyData() {
    _ensureCapnwasmReader(this);
    const _msgEnd = this._msgEnd;
    if (_msgEnd) {
      const v = _jsReadDataPtr(this._u8, this._dv, this._dataPtr, 6, 3, this._msgStart, _msgEnd);
      if (v !== undefined) return v ?? new Uint8Array(0);
    }
    const len = this._exp.cpp_any_data_at(3);
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return u8.slice(out, out + len);
  }

  static _FIELDS = {
    u8: {"kind":1,"off":0,"type":"uint8"},
    u16: {"kind":2,"off":2,"type":"uint16"},
    u32: {"kind":3,"off":4,"type":"uint32"},
    u64: {"kind":4,"off":8,"type":"uint64"},
    i8: {"kind":1,"off":1,"type":"int8"},
    i16: {"kind":2,"off":16,"type":"int16"},
    i32: {"kind":3,"off":20,"type":"int32"},
    i64: {"kind":4,"off":24,"type":"int64"},
    f32: {"kind":3,"off":32,"type":"float32"},
    f64: {"kind":4,"off":40,"type":"float64"},
    flag0: {"kind":5,"off":144,"type":"bool"},
    flag1: {"kind":5,"off":145,"type":"bool"},
    flag2: {"kind":5,"off":146,"type":"bool"},
    text: {"kind":0,"off":0,"type":"text"},
    data: {"kind":6,"off":1,"type":"data"},
    emptyText: {"kind":0,"off":2,"type":"text"},
    emptyData: {"kind":6,"off":3,"type":"data"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, PrimitivesReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, PrimitivesReader._FIELDS, Object.keys(PrimitivesReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  PrimitivesReader.prototype[Symbol.dispose] = PrimitivesReader.prototype.dispose;
}

_STRUCT_FIELDS["Primitives"] = PrimitivesReader._FIELDS;

export class PrimitivesBuilder {
  static _DATA_WORDS = 6;
  static _PTR_WORDS = 4;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(6, 4) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
  }

  set u8(value) {
    this._u8[this._dataPtr + 0] = value & 0xff;
  }
  set u16(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 2;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
  }
  set u32(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 4;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
    u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;
  }
  set u64(value) {
    const dv = this._dv;
    if (typeof value === "bigint") {
      dv.setBigInt64(this._dataPtr + 8, value, true);
    } else {
      let lo, hi;
      if (value >= 0) { lo = (value >>> 0); hi = ((value / 4294967296) >>> 0); }
      else { const abs = -value; const aLo = (abs >>> 0); const aHi = ((abs / 4294967296) >>> 0);
             lo = (~aLo + 1) >>> 0; hi = (~aHi + (lo === 0 ? 1 : 0)) >>> 0; }
      dv.setUint32(this._dataPtr + 8, lo, true);
      dv.setUint32(this._dataPtr + 12, hi, true);
    }
  }
  set i8(value) {
    this._u8[this._dataPtr + 1] = value & 0xff;
  }
  set i16(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 16;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
  }
  set i32(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 20;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
    u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;
  }
  set i64(value) {
    const dv = this._dv;
    if (typeof value === "bigint") {
      dv.setBigInt64(this._dataPtr + 24, value, true);
    } else {
      let lo, hi;
      if (value >= 0) { lo = (value >>> 0); hi = ((value / 4294967296) >>> 0); }
      else { const abs = -value; const aLo = (abs >>> 0); const aHi = ((abs / 4294967296) >>> 0);
             lo = (~aLo + 1) >>> 0; hi = (~aHi + (lo === 0 ? 1 : 0)) >>> 0; }
      dv.setUint32(this._dataPtr + 24, lo, true);
      dv.setUint32(this._dataPtr + 28, hi, true);
    }
  }
  set f32(value) {
    this._dv.setFloat32(this._dataPtr + 32, value, true);
  }
  set f64(value) {
    this._dv.setFloat64(this._dataPtr + 40, value, true);
  }
  set flag0(value) {
    const u8 = this._u8;
    const off = this._dataPtr + 18;
    if (value) u8[off] |= 1;
    else u8[off] &= 254;
  }
  set flag1(value) {
    const u8 = this._u8;
    const off = this._dataPtr + 18;
    if (value) u8[off] |= 2;
    else u8[off] &= 253;
  }
  set flag2(value) {
    const u8 = this._u8;
    const off = this._dataPtr + 18;
    if (value) u8[off] |= 4;
    else u8[off] &= 251;
  }
  set text(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(0, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set data(value) {
    const u8 = this._cpp._u8;
    u8.set(value, this._exp.cpp_in_ptr());
    this._exp.cpp_any_builder_set_data(1, value.length);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set emptyText(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(2, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set emptyData(value) {
    const u8 = this._cpp._u8;
    u8.set(value, this._exp.cpp_in_ptr());
    this._exp.cpp_any_builder_set_data(3, value.length);
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
    if (o.u8 !== undefined) this.u8 = o.u8;
    if (o.u16 !== undefined) this.u16 = o.u16;
    if (o.u32 !== undefined) this.u32 = o.u32;
    if (o.u64 !== undefined) this.u64 = o.u64;
    if (o.i8 !== undefined) this.i8 = o.i8;
    if (o.i16 !== undefined) this.i16 = o.i16;
    if (o.i32 !== undefined) this.i32 = o.i32;
    if (o.i64 !== undefined) this.i64 = o.i64;
    if (o.f32 !== undefined) this.f32 = o.f32;
    if (o.f64 !== undefined) this.f64 = o.f64;
    if (o.flag0 !== undefined) this.flag0 = o.flag0;
    if (o.flag1 !== undefined) this.flag1 = o.flag1;
    if (o.flag2 !== undefined) this.flag2 = o.flag2;
    if (o.text !== undefined) this.text = o.text;
    if (o.data !== undefined) this.data = o.data;
    if (o.emptyText !== undefined) this.emptyText = o.emptyText;
    if (o.emptyData !== undefined) this.emptyData = o.emptyData;
    return this;
  }

  /**
   * Build a Primitives from a plain JS object in one call.
   * Shorthand for `new PrimitivesBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new PrimitivesBuilder(cpp).fromObject(o);
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
 * Open framed Cap'n Proto bytes for typed access. Returns a PrimitivesReader.
 */
export function openPrimitives(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new PrimitivesReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openPrimitivesUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new PrimitivesReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new Primitives message. Returns a PrimitivesBuilder. */
export function buildPrimitives(cpp) {
  return new PrimitivesBuilder(cpp);
}

