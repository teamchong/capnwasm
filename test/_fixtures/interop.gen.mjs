// Generated from interop.capnp by capnwasm-gen. Do not edit by hand.

const SHARED_TEXT_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();
function decodeAscii(bytes) {
  return SHARED_TEXT_DECODER.decode(bytes);
}

function _jsReadTextPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
  return _jsReadTextPtrAt(u8, dv, ptrAddr, msgStart, msgEnd);
}

function _jsReadDataPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {
  if (!msgEnd) return undefined;
  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;
  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;
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

export class AllTypesReader {
  static _DATA_WORDS = 6;
  static _PTR_WORDS = 9;
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


  get boolField() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? ((this._u8[this._dataPtr + 0] >> 0) & 1) === 1 : this._exp.cpp_any_bool_at(0, 0) === 1;
  }
  get int8Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? ((this._u8[this._dataPtr + 1] << 24) >> 24) : ((this._exp.cpp_any_uint8_at(1, 0) << 24) >> 24);
  }
  get int16Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._i16[(this._dataPtr + 2) >>> 1] : ((this._exp.cpp_any_uint16_at(2, 0) << 16) >> 16);
  }
  get int32Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._i32[(this._dataPtr + 4) >>> 2] : (this._exp.cpp_any_uint32_at(4, 0) | 0);
  }
  get int64Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._dv.getBigInt64(this._dataPtr + 8, true) : this._exp.cpp_any_int64_at(8, 0n);
  }
  get uint8Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u8[this._dataPtr + 16] : this._exp.cpp_any_uint8_at(16, 0);
  }
  get uint16Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u16[(this._dataPtr + 18) >>> 1] : this._exp.cpp_any_uint16_at(18, 0);
  }
  get uint32Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u32[(this._dataPtr + 20) >>> 2] : this._exp.cpp_any_uint32_at(20, 0);
  }
  get uint64Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._dv.getBigUint64(this._dataPtr + 24, true) : this._exp.cpp_any_int64_at(24, 0n);
  }
  get float32Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._f32[(this._dataPtr + 32) >>> 2] : (function(){ _F32_VIEW_U32[0] = (this._exp.cpp_any_uint32_at(32, 0) >>> 0); return _F32_VIEW_F32[0]; }).call(this);
  }
  get float64Field() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._f64[(this._dataPtr + 40) >>> 3] : (function(){ _F64_VIEW_U32[0] = (this._exp.cpp_any_uint32_at(40, 0) >>> 0); _F64_VIEW_U32[1] = (this._exp.cpp_any_uint32_at(44, 0) >>> 0); return _F64_VIEW_F64[0]; }).call(this);
  }
  get textField() {
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
  get dataField() {
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
  get enumField() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u16[(this._dataPtr + 36) >>> 1] : this._exp.cpp_any_uint16_at(36, 0);
  }
  get boolList() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const size = cpp._exports.cpp_any_open_list(2);
    return {
      length: size,
      at(i) {
        if (i < 0 || i >= size) return undefined;
        _ensureCapnwasmReader(reader);
        cpp._exports.cpp_any_open_list(2);
        return cpp._exports.cpp_any_list_get_bool(i) === 1;
      },
      *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },
    };
  }
  get int32List() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    let _desc = null;
    if (_msgEnd) {
      _desc = _jsReadListPrimPtr(reader._u8, reader._dv, reader._dataPtr, 6, 3, _msgStart, _msgEnd, 4);
    }
    if (_desc) {
      const _count = _desc.count;
      const _baseByte = _desc.elementsBase;
      const _baseIdx = _baseByte >>> 2;
      return {
        length: _count,
        at(i) {
          if (i < 0 || i >= _count) return undefined;
          let v = reader._i32[_baseIdx + i];
          if (v !== undefined) return v;
          if (reader._i32.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          return reader._i32[_baseIdx + i];
        },
        *[Symbol.iterator]() { for (let i = 0; i < _count; i++) yield this.at(i); },
        view() {
          if (reader._i32.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          return reader._i32.subarray(_baseIdx, _baseIdx + _count);
        },
      };
    }
    // Cursor-based fallback: unsafe reader, no _msgEnd, or pointer decode failed.
    const size = cpp._exports.cpp_any_open_list(3);
    return {
      length: size,
      at(i) {
        if (i < 0 || i >= size) return undefined;
        _ensureCapnwasmReader(reader);
        cpp._exports.cpp_any_open_list(3);
        return cpp._exports.cpp_any_list_get_uint32(i) | 0;
      },
      *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },
      view() { throw new Error("view() requires a slot-pool reader; got an unsafe / cursor-only reader"); },
    };
  }
  get uint64List() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    let _desc = null;
    if (_msgEnd) {
      _desc = _jsReadListPrimPtr(reader._u8, reader._dv, reader._dataPtr, 6, 4, _msgStart, _msgEnd, 8);
    }
    if (_desc) {
      const _count = _desc.count;
      const _baseByte = _desc.elementsBase;
      const _baseIdx = _baseByte >>> 3;
      return {
        length: _count,
        at(i) {
          if (i < 0 || i >= _count) return undefined;
          if (reader._u8.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          return new BigUint64Array(reader._u8.buffer, _baseByte, _count)[i];
        },
        *[Symbol.iterator]() { for (let i = 0; i < _count; i++) yield this.at(i); },
        view() {
          if (reader._u8.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          return new BigUint64Array(reader._u8.buffer, _baseByte, _count);
        },
      };
    }
    // Cursor-based fallback: unsafe reader, no _msgEnd, or pointer decode failed.
    const size = cpp._exports.cpp_any_open_list(4);
    return {
      length: size,
      at(i) {
        if (i < 0 || i >= size) return undefined;
        _ensureCapnwasmReader(reader);
        cpp._exports.cpp_any_open_list(4);
        return cpp._exports.cpp_any_list_get_uint64(i);
      },
      *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },
      view() { throw new Error("view() requires a slot-pool reader; got an unsafe / cursor-only reader"); },
    };
  }
  get float64List() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    let _desc = null;
    if (_msgEnd) {
      _desc = _jsReadListPrimPtr(reader._u8, reader._dv, reader._dataPtr, 6, 5, _msgStart, _msgEnd, 8);
    }
    if (_desc) {
      const _count = _desc.count;
      const _baseByte = _desc.elementsBase;
      const _baseIdx = _baseByte >>> 3;
      return {
        length: _count,
        at(i) {
          if (i < 0 || i >= _count) return undefined;
          let v = reader._f64[_baseIdx + i];
          if (v !== undefined) return v;
          if (reader._f64.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          return reader._f64[_baseIdx + i];
        },
        *[Symbol.iterator]() { for (let i = 0; i < _count; i++) yield this.at(i); },
        view() {
          if (reader._f64.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          return reader._f64.subarray(_baseIdx, _baseIdx + _count);
        },
      };
    }
    // Cursor-based fallback: unsafe reader, no _msgEnd, or pointer decode failed.
    const size = cpp._exports.cpp_any_open_list(5);
    return {
      length: size,
      at(i) {
        if (i < 0 || i >= size) return undefined;
        _ensureCapnwasmReader(reader);
        cpp._exports.cpp_any_open_list(5);
        return ((bits) => { _F64_VIEW_U32[0] = Number(bits & 0xFFFFFFFFn) >>> 0; _F64_VIEW_U32[1] = Number(bits >> 32n) >>> 0; return _F64_VIEW_F64[0]; })(cpp._exports.cpp_any_list_get_float64_bits(i));
      },
      *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },
      view() { throw new Error("view() requires a slot-pool reader; got an unsafe / cursor-only reader"); },
    };
  }
  get textList() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    let _desc = null;
    if (_msgEnd) {
      if (reader._u8.buffer !== cpp.memory.buffer) {
        reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
        reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
      }
      _desc = _jsReadListPointerPtr(reader._u8, reader._dv, reader._dataPtr, 6, 6, _msgStart, _msgEnd);
    }
    if (_desc) {
      const _count = _desc.count;
      const _baseByte = _desc.elementsBase;
      return {
        length: _count,
        at(i) {
          if (i < 0 || i >= _count) return undefined;
          if (reader._u8.buffer !== cpp.memory.buffer) {
            reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
            reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;
          }
          const v = _jsReadTextPtrAt(reader._u8, reader._dv, _baseByte + i * 8, _msgStart, _msgEnd);
          if (v !== undefined) return v ?? "";
          _ensureCapnwasmReader(reader);
          cpp._exports.cpp_any_open_list(6);
          const len = cpp._exports.cpp_any_list_get_text(i);
          if (len === 0) return "";
          const out = cpp._outPtr;
          return decodeAscii(cpp._u8.subarray(out, out + len));
        },
        *[Symbol.iterator]() { for (let i = 0; i < _count; i++) yield this.at(i); },
      };
    }
    const size = cpp._exports.cpp_any_open_list(6);
    return {
      length: size,
      at(i) {
        if (i < 0 || i >= size) return undefined;
        _ensureCapnwasmReader(reader);
        cpp._exports.cpp_any_open_list(6);
        const len = cpp._exports.cpp_any_list_get_text(i);
        if (len === 0) return "";
        const out = cpp._outPtr;
        return decodeAscii(cpp._u8.subarray(out, out + len));
      },
      *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },
    };
  }
  get nested() {
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
      cpp._exports.cpp_any_enter_struct(7);
      cpp._bumpGeneration();
    };
    if (_msgEnd) {
      const desc = _jsReadStructPtr(reader._u8, reader._dv, reader._dataPtr, 6, 7, _msgStart, _msgEnd);
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
    // subsequent getters read from the right level.
    _rebindNested();
    return new TagReader(cpp, 0, {
      msg: reader._msg,
      slotIdx: reader._slotIdx,
      gen: cpp._generation ?? 0,
      rebind: _rebindNested,
    });
  }
  get tagList() {
    _ensureCapnwasmReader(this);
    const reader = this;
    const cpp = this._cpp;
    const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;
    const _u8 = reader._u8, _dv = reader._dv;
    let _listDesc = null;
    if (_msgEnd) {
      _listDesc = _jsReadListStructPtr(_u8, _dv, reader._dataPtr, 6, 8, _msgStart, _msgEnd);
    }
    if (_listDesc && _listDesc !== undefined) {
      return {
        length: _listDesc.count,
        at(i) {
          if (i < 0 || i >= _listDesc.count) return undefined;
          const elemDataPtr = _listDesc.elementsBase + i * (_listDesc.dataWords + _listDesc.ptrWords) * 8;
          return new TagReader(cpp, elemDataPtr, {
            slotIdx: reader._slotIdx,
            msgStart: _msgStart,
            msgEnd: _msgEnd,
            gen: cpp._generation ?? 0,
            parent: reader,
            rebind: () => { _ensureCapnwasmReader(reader); cpp._exports.cpp_any_open_list(8); cpp._exports.cpp_any_enter_list_at(i); cpp._bumpGeneration(); },
          });
        },
        *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.at(i); },
      };
    }
    const size = cpp._exports.cpp_any_open_list(8);
    let pushed = false;
    return {
      length: size,
      at(i) {
        if (i < 0 || i >= size) return undefined;
        _ensureCapnwasmReader(reader);
        if (pushed) cpp._exports.cpp_any_leave_struct();
        cpp._exports.cpp_any_open_list(8);
        cpp._exports.cpp_any_enter_list_at(i);
        cpp._bumpGeneration();
        pushed = true;
        const r = new TagReader(cpp, 0, { msg: reader._msg, slotIdx: reader._slotIdx, gen: cpp._generation ?? 0, rebind: () => { _ensureCapnwasmReader(reader); cpp._exports.cpp_any_open_list(8); cpp._exports.cpp_any_enter_list_at(i); cpp._bumpGeneration(); } });
        return r;
      },
      *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },
    };
  }

  static _FIELDS = {
    boolField: {"kind":5,"off":0,"type":"bool"},
    int8Field: {"kind":1,"off":1,"type":"int8"},
    int16Field: {"kind":2,"off":2,"type":"int16"},
    int32Field: {"kind":3,"off":4,"type":"int32"},
    int64Field: {"kind":4,"off":8,"type":"int64"},
    uint8Field: {"kind":1,"off":16,"type":"uint8"},
    uint16Field: {"kind":2,"off":18,"type":"uint16"},
    uint32Field: {"kind":3,"off":20,"type":"uint32"},
    uint64Field: {"kind":4,"off":24,"type":"uint64"},
    float32Field: {"kind":3,"off":32,"type":"float32"},
    float64Field: {"kind":4,"off":40,"type":"float64"},
    textField: {"kind":0,"off":0,"type":"text"},
    dataField: {"kind":6,"off":1,"type":"data"},
    enumField: {"kind":2,"off":36,"type":"uint16"},
    boolList: {"kind":-1,"off":2,"type":"List(Bool)"},
    int32List: {"kind":-1,"off":3,"type":"List(Int32)"},
    uint64List: {"kind":-1,"off":4,"type":"List(UInt64)"},
    float64List: {"kind":-1,"off":5,"type":"List(Float64)"},
    textList: {"kind":-1,"off":6,"type":"List(Text)"},
    nested: {"kind":-1,"off":7,"type":"Tag"},
    tagList: {"kind":-1,"off":8,"type":"List(Tag)"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, AllTypesReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, AllTypesReader._FIELDS, Object.keys(AllTypesReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  AllTypesReader.prototype[Symbol.dispose] = AllTypesReader.prototype.dispose;
}

export class InteropMessageReader {
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


  get payload() {
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
      const desc = _jsReadStructPtr(reader._u8, reader._dv, reader._dataPtr, 1, 0, _msgStart, _msgEnd);
      if (desc !== undefined) {
        const dp = desc === null ? 0 : desc.dataPtr;
        // gen=-1 forces _ensureCapnwasmReader to invoke the rebind on the
        // first cursor-using access, which positions the C++ any_stack
        // onto this nested struct. Pure-JS reads via _dataPtr never hit
        // that branch; only Bool list / unsafe paths need the cursor.
        return new AllTypesReader(cpp, dp, {
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
    // subsequent getters read from the right level.
    _rebindNested();
    return new AllTypesReader(cpp, 0, {
      msg: reader._msg,
      slotIdx: reader._slotIdx,
      gen: cpp._generation ?? 0,
      rebind: _rebindNested,
    });
  }
  get ordinal() {
    _ensureCapnwasmReader(this);
    return this._dataPtr ? this._u32[(this._dataPtr + 0) >>> 2] : this._exp.cpp_any_uint32_at(0, 0);
  }

  static _FIELDS = {
    payload: {"kind":-1,"off":0,"type":"AllTypes"},
    ordinal: {"kind":3,"off":0,"type":"uint32"},
  };

  draft(fn) {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _runDraft(this._cpp, InteropMessageReader._FIELDS, fn);
  }

  toObject() {
    _ensureCapnwasmReader(this);
    if (this._rebind) this._rebind();
    return _capnwasmPick(this._cpp, InteropMessageReader._FIELDS, Object.keys(InteropMessageReader._FIELDS));
  }
}
if (typeof Symbol.dispose === "symbol") {
  InteropMessageReader.prototype[Symbol.dispose] = InteropMessageReader.prototype.dispose;
}

_STRUCT_FIELDS["Tag"] = TagReader._FIELDS;
_STRUCT_FIELDS["AllTypes"] = AllTypesReader._FIELDS;
_STRUCT_FIELDS["InteropMessage"] = InteropMessageReader._FIELDS;

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

export class AllTypesBuilder {
  static _DATA_WORDS = 6;
  static _PTR_WORDS = 9;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(6, 9) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
  }

  set boolField(value) {
    const u8 = this._u8;
    const off = this._dataPtr + 0;
    if (value) u8[off] |= 1;
    else u8[off] &= 254;
  }
  set int8Field(value) {
    this._u8[this._dataPtr + 1] = value & 0xff;
  }
  set int16Field(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 2;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
  }
  set int32Field(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 4;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
    u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;
  }
  set int64Field(value) {
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
  set uint8Field(value) {
    this._u8[this._dataPtr + 16] = value & 0xff;
  }
  set uint16Field(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 18;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
  }
  set uint32Field(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 20;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
    u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;
  }
  set uint64Field(value) {
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
  set float32Field(value) {
    this._dv.setFloat32(this._dataPtr + 32, value, true);
  }
  set float64Field(value) {
    this._dv.setFloat64(this._dataPtr + 40, value, true);
  }
  set textField(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(0, written);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set dataField(value) {
    const u8 = this._cpp._u8;
    u8.set(value, this._exp.cpp_in_ptr());
    this._exp.cpp_any_builder_set_data(1, value.length);
    this._u8 = this._cpp._u8;
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set enumField(value) {
    const u8 = this._u8;
    const o = this._dataPtr + 36;
    u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;
  }
  set boolList(value) {
    if (!Array.isArray(value)) throw new TypeError("List(Bool) field expects an array");
    if (this._exp.cpp_any_builder_init_list_bool(2, value.length) !== 1) {
      throw new Error("init_list_bool failed for boolList");
    }
    for (let i = 0; i < value.length; i++) {
      this._exp.cpp_any_builder_set_list_bool(2, i, value[i] ? 1 : 0);
    }
  }
  set int32List(value) {
    if (!Array.isArray(value)) throw new TypeError("List(Int32) field expects an array");
    if (this._exp.cpp_any_builder_init_list_int32(3, value.length) !== 1) {
      throw new Error("init_list_int32 failed for int32List");
    }
    for (let i = 0; i < value.length; i++) {
      this._exp.cpp_any_builder_set_list_int32(3, i, value[i]);
    }
  }
  set uint64List(value) {
    if (!Array.isArray(value)) throw new TypeError("List(UInt64) field expects an array");
    if (this._exp.cpp_any_builder_init_list_uint64(4, value.length) !== 1) {
      throw new Error("init_list_uint64 failed for uint64List");
    }
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      this._exp.cpp_any_builder_set_list_uint64(4, i, typeof v === "bigint" ? v : BigInt(v));
    }
  }
  set float64List(value) {
    if (!Array.isArray(value)) throw new TypeError("List(Float64) field expects an array");
    if (this._exp.cpp_any_builder_init_list_float64(5, value.length) !== 1) {
      throw new Error("init_list_float64 failed for float64List");
    }
    for (let i = 0; i < value.length; i++) {
      this._exp.cpp_any_builder_set_list_float64(5, i, value[i]);
    }
  }
  set textList(value) {
    if (!Array.isArray(value)) throw new TypeError("List(Text) field expects an array");
    if (this._exp.cpp_any_builder_init_list_text(6, value.length) !== 1) {
      throw new Error("init_list_text failed for textList");
    }
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    for (let i = 0; i < value.length; i++) {
      const s = value[i];
      let written;
      if (typeof s === "string") {
        const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
        written = SHARED_ENCODER.encodeInto(s, dst).written;
      } else {
        if (s.length > inCap) throw new Error("text element larger than scratch buffer");
        this._cpp._u8.set(s, inPtr);
        written = s.length;
      }
      if (this._exp.cpp_any_builder_set_list_text(6, i, written) !== 1) {
        throw new Error("set_list_text(" + i + ") failed for textList");
      }
    }
    this._u8 = this._cpp._u8;
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  get nested() {
    if (this._exp.cpp_any_builder_enter_struct(7, 1, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for nested");
    }
    const sub = new TagBuilder(this._cpp, { preinitialized: true });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub._exitOnFinalize = true;
    return sub;
  }
  set nested(value) {
    if (value == null) return;
    if (this._exp.cpp_any_builder_enter_struct(7, 1, 1) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for nested");
    }
    const sub = new TagBuilder(this._cpp, { preinitialized: true });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub.fromObject(value);
    if (this._exp.cpp_any_builder_exit_struct() !== 1) {
      throw new Error("cpp_any_builder_exit_struct failed for nested");
    }
    this._u8 = this._cpp._u8;
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set tagList(value) {
    if (!Array.isArray(value)) throw new TypeError("List(Tag) field expects an array");
    if (this._exp.cpp_any_builder_init_list_struct(8, value.length, 1, 1) !== 1) {
      throw new Error("init_list_struct failed for tagList");
    }
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item == null) continue;
      if (this._exp.cpp_any_builder_enter_list_element(8, i) !== 1) {
        throw new Error("enter_list_element(" + i + ") failed for tagList");
      }
      const sub = new TagBuilder(this._cpp, { preinitialized: true });
      sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
      sub.fromObject(item);
      if (this._exp.cpp_any_builder_exit_struct() !== 1) {
        throw new Error("exit_struct(list element) failed for tagList");
      }
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
    if (o.boolField !== undefined) this.boolField = o.boolField;
    if (o.int8Field !== undefined) this.int8Field = o.int8Field;
    if (o.int16Field !== undefined) this.int16Field = o.int16Field;
    if (o.int32Field !== undefined) this.int32Field = o.int32Field;
    if (o.int64Field !== undefined) this.int64Field = o.int64Field;
    if (o.uint8Field !== undefined) this.uint8Field = o.uint8Field;
    if (o.uint16Field !== undefined) this.uint16Field = o.uint16Field;
    if (o.uint32Field !== undefined) this.uint32Field = o.uint32Field;
    if (o.uint64Field !== undefined) this.uint64Field = o.uint64Field;
    if (o.float32Field !== undefined) this.float32Field = o.float32Field;
    if (o.float64Field !== undefined) this.float64Field = o.float64Field;
    if (o.textField !== undefined) this.textField = o.textField;
    if (o.dataField !== undefined) this.dataField = o.dataField;
    if (o.enumField !== undefined) this.enumField = o.enumField;
    if (o.boolList !== undefined) this.boolList = o.boolList;
    if (o.int32List !== undefined) this.int32List = o.int32List;
    if (o.uint64List !== undefined) this.uint64List = o.uint64List;
    if (o.float64List !== undefined) this.float64List = o.float64List;
    if (o.textList !== undefined) this.textList = o.textList;
    if (o.nested !== undefined) this.nested = o.nested;
    if (o.tagList !== undefined) this.tagList = o.tagList;
    return this;
  }

  /**
   * Build a AllTypes from a plain JS object in one call.
   * Shorthand for `new AllTypesBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new AllTypesBuilder(cpp).fromObject(o);
  }

  /** Serialize the message to framed Cap'n Proto bytes. */
  toBytes() {
    const len = this._exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    const out = this._cpp._outPtr;
    return this._cpp._u8.slice(out, out + len);
  }
}

export class InteropMessageBuilder {
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
  }

  get payload() {
    if (this._exp.cpp_any_builder_enter_struct(0, 6, 9) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for payload");
    }
    const sub = new AllTypesBuilder(this._cpp, { preinitialized: true });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub._exitOnFinalize = true;
    return sub;
  }
  set payload(value) {
    if (value == null) return;
    if (this._exp.cpp_any_builder_enter_struct(0, 6, 9) !== 1) {
      throw new Error("cpp_any_builder_enter_struct failed for payload");
    }
    const sub = new AllTypesBuilder(this._cpp, { preinitialized: true });
    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();
    sub.fromObject(value);
    if (this._exp.cpp_any_builder_exit_struct() !== 1) {
      throw new Error("cpp_any_builder_exit_struct failed for payload");
    }
    this._u8 = this._cpp._u8;
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);
  }
  set ordinal(value) {
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
    if (o.payload !== undefined) this.payload = o.payload;
    if (o.ordinal !== undefined) this.ordinal = o.ordinal;
    return this;
  }

  /**
   * Build a InteropMessage from a plain JS object in one call.
   * Shorthand for `new InteropMessageBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new InteropMessageBuilder(cpp).fromObject(o);
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
 * Open framed Cap'n Proto bytes for typed access. Returns a AllTypesReader.
 */
export function openAllTypes(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new AllTypesReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openAllTypesUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new AllTypesReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new AllTypes message. Returns a AllTypesBuilder. */
export function buildAllTypes(cpp) {
  return new AllTypesBuilder(cpp);
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a InteropMessageReader.
 */
export function openInteropMessage(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, false);
  return new InteropMessageReader(cpp, opened.dataPtr, opened);
}

/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */
export function openInteropMessageUnsafe(cpp, bytes) {
  const opened = _openCapnwasmMessage(cpp, bytes, true);
  return new InteropMessageReader(cpp, opened.dataPtr, opened);
}

/** Begin building a new InteropMessage message. Returns a InteropMessageBuilder. */
export function buildInteropMessage(cpp) {
  return new InteropMessageBuilder(cpp);
}

