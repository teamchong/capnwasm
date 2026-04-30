// Runtime-schema reader.
//
// The codegen path emits a typed JS class per Cap'n Proto struct. That's the
// fast, ergonomic path when the schema is known at build time. This module
// is for cases where the schema is *only* available at runtime — multi-tenant
// SaaS where each tenant uploads their own schema, admin tools that need to
// pretty-print arbitrary messages, GraphQL-style fragment selection.
//
// The schema descriptor is plain JS data, the same `_FIELDS` shape codegen
// produces. You can hand-write it, JSON-load it, or generate it from a
// CodeGeneratorRequest at build time.
//
// Usage:
//
//   import { defineSchema, openDynamic } from "capnwasm/dynamic";
//
//   const User = defineSchema({
//     name:   { kind: "text",   slot: 0 },
//     email:  { kind: "text",   slot: 1 },
//     age:    { kind: "uint32", offset: 0 },
//     active: { kind: "bool",   bitOffset: 32 },
//     idHi:   { kind: "int64",  offset: 8 },
//   });
//
//   const reader = openDynamic(cpp, User, bytes);
//   reader.name;                      // "Ada"
//   reader.pick(["name", "age"]);     // { name: "Ada", age: 36 }
//   reader.toObject();                // all fields
//
// Wire-format-compatible with the codegen path. A reader built dynamically
// reads the same bytes a codegen reader for the same schema would.

const SHARED_DECODER = new TextDecoder();

const _F32_BUF = new ArrayBuffer(4);
const _F32_U32 = new Uint32Array(_F32_BUF);
const _F32_F32 = new Float32Array(_F32_BUF);
const _F64_BUF = new ArrayBuffer(8);
const _F64_U32 = new Uint32Array(_F64_BUF);
const _F64_F64 = new Float64Array(_F64_BUF);

// Map JS-friendly kind names to the (kind, off-key) pair used by the
// underlying cpp_any_batch_read API. The off-key tells `defineSchema` which
// property of the user descriptor holds the offset.
//
// `signExtend` is applied client-side because wasm only exposes unsigned
// reads at this size; signed integers are derived from the unsigned ones.
const KIND_TABLE = {
  text:    { wireKind: 0, offKey: "slot",      type: "text" },
  uint8:   { wireKind: 1, offKey: "offset",    type: "uint8" },
  uint16:  { wireKind: 2, offKey: "offset",    type: "uint16" },
  uint32:  { wireKind: 3, offKey: "offset",    type: "uint32" },
  int8:    { wireKind: 1, offKey: "offset",    type: "int8" },
  int16:   { wireKind: 2, offKey: "offset",    type: "int16" },
  int32:   { wireKind: 3, offKey: "offset",    type: "int32" },
  int64:   { wireKind: 4, offKey: "offset",    type: "int64" },
  uint64:  { wireKind: 4, offKey: "offset",    type: "uint64" },
  bool:    { wireKind: 5, offKey: "bitOffset", type: "bool" },
  data:    { wireKind: 6, offKey: "slot",      type: "data" },
  // Floats reuse the integer wireKinds — the wasm boundary returns the raw
  // bits, JS does the bit-cast through a typed-array view.
  float32: { wireKind: 3, offKey: "offset",    type: "float32" },
  float64: { wireKind: 4, offKey: "offset",    type: "float64" },
  // List-of-primitive types. Reads happen through `cpp_any_open_list` +
  // per-element `cpp_any_list_get_*`, materialized into a JS array. Lists
  // are pointer-typed in the wire format, so they live at a slot index.
  // Not in cpp_any_batch_read — these go through `_readSingle` even from
  // pick(), which means N+1 wasm calls per list (open + size + N gets);
  // codegen-emitted readers are unchanged and stay faster on hot paths.
  listUint8:   { wireKind: -1, offKey: "slot", type: "list",   element: "uint8" },
  listUint16:  { wireKind: -1, offKey: "slot", type: "list",   element: "uint16" },
  listUint32:  { wireKind: -1, offKey: "slot", type: "list",   element: "uint32" },
  listUint64:  { wireKind: -1, offKey: "slot", type: "list",   element: "uint64" },
  listInt8:    { wireKind: -1, offKey: "slot", type: "list",   element: "int8" },
  listInt16:   { wireKind: -1, offKey: "slot", type: "list",   element: "int16" },
  listInt32:   { wireKind: -1, offKey: "slot", type: "list",   element: "int32" },
  listInt64:   { wireKind: -1, offKey: "slot", type: "list",   element: "int64" },
  listFloat32: { wireKind: -1, offKey: "slot", type: "list",   element: "float32" },
  listFloat64: { wireKind: -1, offKey: "slot", type: "list",   element: "float64" },
  listBool:    { wireKind: -1, offKey: "slot", type: "list",   element: "bool" },
  listText:    { wireKind: -1, offKey: "slot", type: "list",   element: "text" },
  listData:    { wireKind: -1, offKey: "slot", type: "list",   element: "data" },
};

/**
 * Validate and freeze a schema descriptor. The argument is a plain object
 * mapping field names to `{ kind, slot|offset|bitOffset }` records.
 *
 * Returns an opaque DynamicSchema object that `openDynamic` accepts. Throws
 * synchronously on malformed input — so that schema bugs surface at load
 * time, not on the first read.
 *
 * Nested structs use `{ kind: "struct", slot: N, schema: <result of
 * defineSchema(...)> }`. The nested schema is materialized eagerly when
 * the field is read, so it returns a plain object — not a sub-reader —
 * since the underlying wasm cursor would be invalidated by any sibling
 * access.
 */
export function defineSchema(spec) {
  if (!spec || typeof spec !== "object") throw new TypeError("defineSchema: expected an object");
  const fields = Object.create(null);
  for (const [name, raw] of Object.entries(spec)) {
    if (!raw || typeof raw !== "object") throw new TypeError(`field "${name}": expected an object`);
    if (raw.kind === "struct") {
      // Nested struct — schema is recursive. Validate the nested schema
      // shape (must look like the result of defineSchema).
      if (typeof raw.slot !== "number" || raw.slot < 0 || !Number.isInteger(raw.slot)) {
        throw new TypeError(`field "${name}": nested struct missing or invalid "slot"`);
      }
      if (!raw.schema || !raw.schema.fields) {
        throw new TypeError(`field "${name}": nested struct missing "schema" (use defineSchema(...))`);
      }
      fields[name] = Object.freeze({ kind: -2, off: raw.slot, type: "struct", schema: raw.schema });
      continue;
    }
    if (raw.kind === "listStruct") {
      if (typeof raw.slot !== "number" || raw.slot < 0 || !Number.isInteger(raw.slot)) {
        throw new TypeError(`field "${name}": listStruct missing or invalid "slot"`);
      }
      if (!raw.element || !raw.element.fields) {
        throw new TypeError(`field "${name}": listStruct missing "element" (use defineSchema(...))`);
      }
      fields[name] = Object.freeze({ kind: -3, off: raw.slot, type: "listStruct", element: raw.element });
      continue;
    }
    const meta = KIND_TABLE[raw.kind];
    if (!meta) throw new TypeError(`field "${name}": unknown kind "${raw.kind}"`);
    const off = raw[meta.offKey];
    if (typeof off !== "number" || off < 0 || !Number.isInteger(off)) {
      throw new TypeError(`field "${name}": missing or invalid "${meta.offKey}"`);
    }
    const desc = {
      kind: meta.wireKind,
      off,
      type: meta.type,
    };
    if (meta.element) desc.element = meta.element;
    fields[name] = Object.freeze(desc);
  }
  Object.freeze(fields);
  return { fields };
}

/**
 * Load `bytes` into the wasm scratch buffer and prepare a dynamic reader.
 *
 * `cpp` is a CapnCpp instance from `capnwasm/load`. `schema` is from
 * `defineSchema`. `bytes` is a serialized Cap'n Proto message.
 */
export function openDynamic(cpp, schema, bytes) {
  if (bytes.length > cpp._cap) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._inPtr);
  if (cpp._exports.cpp_any_open(bytes.length) !== 1) {
    throw new Error("cpp_any_open failed");
  }
  return new DynamicReader(cpp, schema);
}

/**
 * Reader bound to a single message. Field access is via the `pick` family
 * (one wasm boundary call per pick) or by indexing the reader directly,
 * which goes through a Proxy and resolves one field per call.
 */
export class DynamicReader {
  constructor(cpp, schema) {
    this._cpp = cpp;
    this._schema = schema;
    this._proxy = null;
  }

  /** Pick a subset of fields in one wasm round trip. Order matches `names`. */
  pick(names) {
    return _batchPick(this._cpp, this._schema.fields, names);
  }

  /** Materialize every field in the schema. */
  toObject() {
    return this.pick(Object.keys(this._schema.fields));
  }

  /** Get a single field by name. */
  get(name) {
    const desc = this._schema.fields[name];
    if (!desc) return undefined;
    return _readSingle(this._cpp, desc);
  }

  /**
   * Proxy-style access — `reader.fieldName`. Convenience over .get(). Each
   * access is a separate wasm call; for multiple fields prefer `pick`.
   */
  get fields() {
    if (this._proxy) return this._proxy;
    const cpp = this._cpp;
    const fields = this._schema.fields;
    this._proxy = new Proxy(Object.create(null), {
      get(_, name) {
        if (typeof name !== "string") return undefined;
        const desc = fields[name];
        if (!desc) return undefined;
        return _readSingle(cpp, desc);
      },
      has(_, name) { return typeof name === "string" && fields[name] !== undefined; },
      ownKeys() { return Object.keys(fields); },
      getOwnPropertyDescriptor(_, name) {
        if (typeof name !== "string" || !fields[name]) return undefined;
        return { enumerable: true, configurable: true, value: _readSingle(cpp, fields[name]) };
      },
    });
    return this._proxy;
  }
}

// Single-field read — one wasm call. Use this for the Proxy path, or when
// only one field is wanted.
function _readSingle(cpp, desc) {
  const exp = cpp._exports;
  switch (desc.type) {
    case "text": {
      const len = exp.cpp_any_text_at(desc.off);
      if (len === 0) return "";
      return SHARED_DECODER.decode(cpp._u8.subarray(cpp._outPtr, cpp._outPtr + len));
    }
    case "data": {
      const len = exp.cpp_any_data_at(desc.off);
      if (len === 0xFFFFFFFF) return undefined;
      return cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);
    }
    case "uint8":  return exp.cpp_any_uint8_at(desc.off, 0);
    case "uint16": return exp.cpp_any_uint16_at(desc.off, 0);
    case "uint32": return exp.cpp_any_uint32_at(desc.off, 0) >>> 0;
    case "int8":   { const v = exp.cpp_any_uint8_at(desc.off, 0); return (v << 24) >> 24; }
    case "int16":  { const v = exp.cpp_any_uint16_at(desc.off, 0); return (v << 16) >> 16; }
    case "int32":  return exp.cpp_any_uint32_at(desc.off, 0) | 0;
    case "float32": _F32_U32[0] = exp.cpp_any_uint32_at(desc.off, 0) >>> 0; return _F32_F32[0];
    case "float64": {
      _F64_U32[0] = exp.cpp_any_uint32_at(desc.off, 0) >>> 0;
      _F64_U32[1] = exp.cpp_any_uint32_at(desc.off + 4, 0) >>> 0;
      return _F64_F64[0];
    }
    case "int64":
    case "uint64": {
      // cpp_any_int64_at returns the low 64 bits as a BigInt over the wasm
      // boundary in node; we coerce to plain Number when it fits in safe
      // integer range, otherwise return BigInt.
      const v = exp.cpp_any_int64_at(BigInt(desc.off), 0n);
      if (typeof v === "bigint") {
        if (v >= -9007199254740992n && v <= 9007199254740992n) return Number(v);
        return v;
      }
      return v;
    }
    case "bool":   return exp.cpp_any_bool_at(desc.off, 0) === 1;
    case "list":       return _readList(cpp, desc);
    case "struct":     return _readNestedStruct(cpp, desc);
    case "listStruct": return _readListOfStructs(cpp, desc);
    default:           return undefined;
  }
}

// Push the nested struct on the wasm-side stack, eagerly read every field
// of its schema, then pop. Eager materialization keeps the API safe — a
// returned sub-reader would silently break the moment the caller touches
// a sibling field at the parent level (which would re-position the
// cursor). Nested-of-nested works because each recursion saves and
// restores the cursor via enter/leave.
function _readNestedStruct(cpp, desc) {
  const exp = cpp._exports;
  if (exp.cpp_any_enter_struct(desc.off) !== 1) {
    // Pointer slot is null or out-of-range — return null, the
    // wire-format-correct interpretation of "field not present".
    return null;
  }
  try {
    const out = {};
    for (const [name, sub] of Object.entries(desc.schema.fields)) {
      out[name] = _readSingle(cpp, sub);
    }
    return out;
  } finally {
    exp.cpp_any_leave_struct();
  }
}

// List<Struct>. cpp_any_open_list returns the size; cpp_any_enter_list_at(i)
// pushes element i onto the same any_stack the struct accessors read from.
// We materialize each element fully before moving to the next, so memory is
// O(N × fields) but the cursor state is always coherent.
function _readListOfStructs(cpp, desc) {
  const exp = cpp._exports;
  const size = exp.cpp_any_open_list(desc.off);
  if (size === 0) return [];
  const elementFields = Object.entries(desc.element.fields);
  const out = new Array(size);
  for (let i = 0; i < size; i++) {
    if (exp.cpp_any_enter_list_at(i) !== 1) {
      out[i] = null;
      continue;
    }
    try {
      const obj = {};
      for (const [name, sub] of elementFields) {
        obj[name] = _readSingle(cpp, sub);
      }
      out[i] = obj;
    } finally {
      exp.cpp_any_leave_struct();
    }
    // Re-open the list for the next iteration: each cpp_any_enter_list_at
    // calls .as<List<AnyStruct>>()[i] which doesn't disturb any_list_reader,
    // but reading any sub-struct's list field via cpp_any_open_list during
    // _readSingle would. Defensively re-open to keep the size + reader
    // pointing at our outer list across element boundaries.
    if (i + 1 < size) exp.cpp_any_open_list(desc.off);
  }
  return out;
}

// Materialize a list-of-primitive into a JS array. The wasm exposes a
// single any_list_reader slot (last list opened), so opening another list
// invalidates this one — readers materialize the whole list before
// returning, rather than handing back a lazy iterator that could outlive
// the underlying state.
function _readList(cpp, desc) {
  const exp = cpp._exports;
  const size = exp.cpp_any_open_list(desc.off);
  if (size === 0) return [];
  const out = new Array(size);
  switch (desc.element) {
    case "uint8":
      for (let i = 0; i < size; i++) out[i] = exp.cpp_any_list_get_uint8(i);
      return out;
    case "uint16":
      for (let i = 0; i < size; i++) out[i] = exp.cpp_any_list_get_uint16(i);
      return out;
    case "uint32":
      for (let i = 0; i < size; i++) out[i] = exp.cpp_any_list_get_uint32(i) >>> 0;
      return out;
    case "int8":
      for (let i = 0; i < size; i++) {
        const v = exp.cpp_any_list_get_uint8(i); out[i] = (v << 24) >> 24;
      }
      return out;
    case "int16":
      for (let i = 0; i < size; i++) {
        const v = exp.cpp_any_list_get_uint16(i); out[i] = (v << 16) >> 16;
      }
      return out;
    case "int32":
      for (let i = 0; i < size; i++) out[i] = exp.cpp_any_list_get_uint32(i) | 0;
      return out;
    case "uint64":
    case "int64": {
      for (let i = 0; i < size; i++) {
        const big = exp.cpp_any_list_get_uint64(i);
        out[i] = (typeof big === "bigint" && big >= -9007199254740992n && big <= 9007199254740992n)
          ? Number(big) : big;
      }
      return out;
    }
    case "float32":
      for (let i = 0; i < size; i++) {
        _F32_U32[0] = exp.cpp_any_list_get_float32_bits(i) >>> 0;
        out[i] = _F32_F32[0];
      }
      return out;
    case "float64":
      for (let i = 0; i < size; i++) {
        const bits = exp.cpp_any_list_get_float64_bits(i);
        // bits comes back as BigInt from i64-returning wasm exports.
        const v = typeof bits === "bigint" ? bits : BigInt(bits);
        _F64_U32[0] = Number(v & 0xffffffffn) >>> 0;
        _F64_U32[1] = Number((v >> 32n) & 0xffffffffn) >>> 0;
        out[i] = _F64_F64[0];
      }
      return out;
    case "bool":
      for (let i = 0; i < size; i++) out[i] = exp.cpp_any_list_get_bool(i) === 1;
      return out;
    case "text":
      for (let i = 0; i < size; i++) {
        const len = exp.cpp_any_list_get_text(i);
        if (len === 0) { out[i] = ""; continue; }
        out[i] = SHARED_DECODER.decode(cpp._u8.subarray(cpp._outPtr, cpp._outPtr + len));
      }
      return out;
    case "data":
      for (let i = 0; i < size; i++) {
        const len = exp.cpp_any_list_get_data(i);
        out[i] = cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);
      }
      return out;
    default:
      return out;
  }
}

// Batched pick — single wasm call returning all requested fields in order.
// Mirrors the codegen-generated `_capnwasmPick` helper but reads the field
// list from the dynamic schema instead of a baked _FIELDS object.
//
// Lists fall back to per-field reads because cpp_any_batch_read doesn't
// know about list types. The fallback is whole-pick: as soon as any field
// is a list, we route every field through _readSingle. The fast batch
// path stays intact for the common pure-primitive case.
function _batchPick(cpp, fields, names) {
  const u8 = cpp._u8;
  const dv = new DataView(u8.buffer);
  const aux = cpp._exports.cpp_lazy_aux_ptr();

  // Build the request: u32 count, then (u8 kind, u32 offset) per field.
  const count = names.length;
  const reqLen = 4 + count * 5;
  dv.setUint32(aux, count, true);
  const descs = new Array(count);
  let needsFallback = false;
  for (let i = 0; i < count; i++) {
    const d = fields[names[i]];
    if (!d) throw new Error(`unknown field: ${names[i]}`);
    descs[i] = d;
    // Sentinel kinds (lists = -1, struct = -2) aren't supported by
    // cpp_any_batch_read. Fall back to per-field reads in that case.
    if (d.kind < 0) needsFallback = true;
    u8[aux + 4 + i * 5] = d.kind & 0xff;
    dv.setUint32(aux + 4 + i * 5 + 1, d.off, true);
  }
  if (needsFallback) {
    const result = {};
    for (let i = 0; i < count; i++) result[names[i]] = _readSingle(cpp, descs[i]);
    return result;
  }

  const written = cpp._exports.cpp_any_batch_read(reqLen);
  const result = {};
  if (!written) {
    for (let i = 0; i < count; i++) result[names[i]] = undefined;
    return result;
  }

  // Decode the response: u32 lenOrVal per field, followed by payload bytes
  // in field order for variable-size types (text, data, int64).
  const out = cpp._outPtr;
  const u8After = cpp._u8;
  const dvOut = new DataView(u8After.buffer, out);
  let readPos = count * 4;
  for (let i = 0; i < count; i++) {
    const lenOrVal = dvOut.getUint32(i * 4, true);
    const d = descs[i];
    switch (d.type) {
      case "text":
        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }
        if (lenOrVal === 0) { result[names[i]] = ""; break; }
        result[names[i]] = SHARED_DECODER.decode(u8After.subarray(out + readPos, out + readPos + lenOrVal));
        readPos += lenOrVal;
        break;
      case "data":
        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }
        result[names[i]] = u8After.slice(out + readPos, out + readPos + lenOrVal);
        readPos += lenOrVal;
        break;
      case "uint8":  result[names[i]] = lenOrVal; break;
      case "uint16": result[names[i]] = lenOrVal; break;
      case "uint32": result[names[i]] = lenOrVal >>> 0; break;
      case "int8":   result[names[i]] = (lenOrVal << 24) >> 24; break;
      case "int16":  result[names[i]] = (lenOrVal << 16) >> 16; break;
      case "int32":  result[names[i]] = lenOrVal | 0; break;
      case "bool":   result[names[i]] = lenOrVal === 1; break;
      case "float32":
        _F32_U32[0] = lenOrVal >>> 0;
        result[names[i]] = _F32_F32[0];
        break;
      case "float64": {
        _F64_U32[0] = dvOut.getUint32(readPos, true);
        _F64_U32[1] = dvOut.getUint32(readPos + 4, true);
        result[names[i]] = _F64_F64[0];
        readPos += 8;
        break;
      }
      case "int64":
      case "uint64": {
        const lo = dvOut.getUint32(readPos, true);
        const hi = dvOut.getInt32(readPos + 4, true);
        // Safe-integer fast path; fall back to BigInt above 2**53.
        result[names[i]] = (hi >= -0x200000 && hi <= 0x1FFFFF)
          ? hi * 4294967296 + lo
          : dvOut.getBigInt64(readPos, true);
        readPos += 8;
        break;
      }
      default: result[names[i]] = undefined;
    }
  }
  return result;
}
