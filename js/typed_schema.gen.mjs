// Generated from typed_schema.capnp by capnwasm-gen. Do not edit by hand.

const SHARED_TEXT_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();
function decodeAscii(bytes) {
  return SHARED_TEXT_DECODER.decode(bytes);
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
function _compileListDecoder(descs, names, applyMapFn) {
  const cols = descs.length;
  const rowStride = cols * 4;
  const out = [];
  out.push(`const TD = H.TD;`);
  out.push(`const F32U = H.F32U, F32F = H.F32F, F64U = H.F64U, F64F = H.F64F;`);
  out.push(`const arr = new Array(rows);`);
  out.push(`let readPos = 8 + rows * ${rowStride};`);
  out.push(`for (let row = 0; row < rows; row++) {`);
  out.push(`  const cellBase = 8 + row * ${rowStride};`);
  for (let col = 0; col < cols; col++) {
    const d = descs[col];
    const headerOff = `cellBase + ${col * 4}`;
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
      case "uint64":
      case "int64":
        out.push(`  let _v${col};`);
        out.push(`  { const _lo = dv.getUint32(readPos, true);`);
        out.push(`    const _hi = dv.getInt32(readPos + 4, true);`);
        out.push(`    _v${col} = (_hi >= -0x200000 && _hi <= 0x1FFFFF) ? _hi * 4294967296 + _lo : dv.getBigInt64(readPos, true);`);
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
  if (applyMapFn) {
    out.push(`  arr[row] = mapFn({ ${litParts.join(", ")} });`);
  } else {
    out.push(`  arr[row] = { ${litParts.join(", ")} };`);
  }
  out.push(`}`);
  out.push(`return arr;`);
  return new Function("u8", "dv", "out", "rows", "H", "mapFn", out.join("\n"));
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
      case "uint64":
      case "int64": {
        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true);
        const hi = dv2.getInt32 (out - dv2.byteOffset + readPos + 4, true);
        result[names[i]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv2.getBigInt64(out - dv2.byteOffset + readPos, true);
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

function _capnwasmListProject(cpp, ptrIndex, fields, names, mapFn) {
  const exp = cpp._exports;
  if (typeof exp.cpp_any_list_project !== "function") return null;
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
  if (mapFn) {
    let mdec = entry.listDecoderMapped;
    if (!mdec) { mdec = _compileListDecoder(entry.descs, names, true); entry.listDecoderMapped = mdec; }
    return mdec(u8, dv, out, rows, _LIST_HELPERS, mapFn);
  }
  let dec = entry.listDecoder;
  if (!dec) { dec = _compileListDecoder(entry.descs, names, false); entry.listDecoder = dec; }
  return dec(u8, dv, out, rows, _LIST_HELPERS);
}

const _STRUCT_FIELDS = Object.create(null);
const _LIST_MAP_TAG = Symbol("_capnwasm_listMap");
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
        return { map(childFn) {
          const idx = selected.length;
          selected.push({ kind: "listMap", path: nextPath, inner: list[1], fn: childFn });
          const tag = []; tag[_LIST_MAP_TAG] = idx; return tag;
        } };
      }
      if (_STRUCT_FIELDS[desc.type]) return make(_STRUCT_FIELDS[desc.type], nextPath);
      const key = nextPath.join(".");
      if (!seen.has(key)) { seen.add(key); selected.push({ kind: "field", path: nextPath }); }
      return undefined;
    }
  });
  const result = fn(make(fields, []));
  let outerListMapIdx = -1;
  if (result && typeof result === "object" && _LIST_MAP_TAG in result) outerListMapIdx = result[_LIST_MAP_TAG];
  return { selected, outerListMapIdx };
}
function _compilePlan(selected, outerListMapIdx) {
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
      listMapRaw.push({ name: head, inner: item.inner, fn: item.fn });
    } else {
      let entry = nestedRaw.get(head);
      if (!entry) { entry = []; nestedRaw.set(head, entry); }
      const sliced = { kind: item.kind, path: item.path.slice(1) };
      if (item.kind === "listMap") { sliced.inner = item.inner; sliced.fn = item.fn; }
      entry.push(sliced);
    }
  }
  const nested = [];
  for (const [name, raw] of nestedRaw) nested.push({ name, plan: _compilePlan(raw, -1) });
  const listMap = listMapRaw.map(({ name, inner, fn }) => ({
    name, inner, fn,
    plan: _planDraft(_STRUCT_FIELDS[inner], fn).plan,
  }));
  return { leaf, nested, listMap, outerListMapPos };
}
function _planDraft(fields, fn) {
  const raw = _planRaw(fields, fn);
  return { plan: _compilePlan(raw.selected, raw.outerListMapIdx) };
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
      const fast = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf, item.fn);
      if (fast !== null) return fast;
    }
  }
  if (plan.nested.length === 0 && plan.listMap.length === 0) {
    return fn(_capnwasmPick(cpp, fields, plan.leaf));
  }
  return fn(_materializeDraft(cpp, fields, plan));
}

export class WideUserDataReader {
  constructor(cpp, dataPtr) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    this._dataPtr = dataPtr | 0;
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
  }

  get field0() {
    const len = this._exp.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field1() {
    const len = this._exp.cpp_any_text_at(1);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field2() {
    const len = this._exp.cpp_any_text_at(2);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field3() {
    const len = this._exp.cpp_any_text_at(3);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field4() {
    const len = this._exp.cpp_any_text_at(4);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field5() {
    const len = this._exp.cpp_any_text_at(5);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field6() {
    const len = this._exp.cpp_any_text_at(6);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field7() {
    const len = this._exp.cpp_any_text_at(7);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field8() {
    const len = this._exp.cpp_any_text_at(8);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field9() {
    const len = this._exp.cpp_any_text_at(9);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field10() {
    const len = this._exp.cpp_any_text_at(10);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field11() {
    const len = this._exp.cpp_any_text_at(11);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field12() {
    const len = this._exp.cpp_any_text_at(12);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field13() {
    const len = this._exp.cpp_any_text_at(13);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field14() {
    const len = this._exp.cpp_any_text_at(14);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field15() {
    const len = this._exp.cpp_any_text_at(15);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field16() {
    const len = this._exp.cpp_any_text_at(16);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field17() {
    const len = this._exp.cpp_any_text_at(17);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field18() {
    const len = this._exp.cpp_any_text_at(18);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field19() {
    const len = this._exp.cpp_any_text_at(19);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field20() {
    const len = this._exp.cpp_any_text_at(20);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field21() {
    const len = this._exp.cpp_any_text_at(21);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field22() {
    const len = this._exp.cpp_any_text_at(22);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field23() {
    const len = this._exp.cpp_any_text_at(23);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field24() {
    const len = this._exp.cpp_any_text_at(24);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field25() {
    const len = this._exp.cpp_any_text_at(25);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field26() {
    const len = this._exp.cpp_any_text_at(26);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field27() {
    const len = this._exp.cpp_any_text_at(27);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field28() {
    const len = this._exp.cpp_any_text_at(28);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field29() {
    const len = this._exp.cpp_any_text_at(29);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field30() {
    const len = this._exp.cpp_any_text_at(30);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field31() {
    const len = this._exp.cpp_any_text_at(31);
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
  };

  draft(fn) {
    return _runDraft(this._cpp, WideUserDataReader._FIELDS, fn);
  }

  toObject() {
    return _capnwasmPick(this._cpp, WideUserDataReader._FIELDS, Object.keys(WideUserDataReader._FIELDS));
  }
}

_STRUCT_FIELDS["WideUserData"] = WideUserDataReader._FIELDS;

export class WideUserDataBuilder {
  static _DATA_WORDS = 0;
  static _PTR_WORDS = 32;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(0, 32) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = (opts && opts.dataPtr !== undefined)
      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);
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
    return this;
  }

  /**
   * Build a WideUserData from a plain JS object in one call.
   * Shorthand for `new WideUserDataBuilder(cpp).fromObject(o)`.
   */
  static from(cpp, o) {
    return new WideUserDataBuilder(cpp).fromObject(o);
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
 * Open framed Cap'n Proto bytes for typed access. Returns a WideUserDataReader.
 */
export function openWideUserData(cpp, bytes) {
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  const dataPtr = cpp._exports.cpp_any_open(bytes.length);
  return new WideUserDataReader(cpp, dataPtr);
}

/** Begin building a new WideUserData message. Returns a WideUserDataBuilder. */
export function buildWideUserData(cpp) {
  return new WideUserDataBuilder(cpp);
}

