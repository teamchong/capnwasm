// Runtime-schema reader.
//
// The codegen path emits a typed JS class per Cap'n Proto struct. That's the
// fast, ergonomic path when the schema is known at build time. This module
// is for cases where the schema is *only* available at runtime. Multi-tenant
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
const SHARED_ENCODER = new TextEncoder();

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
  // Floats reuse the integer wireKinds. The wasm boundary returns the raw
  // bits, JS does the bit-cast through a typed-array view.
  float32: { wireKind: 3, offKey: "offset",    type: "float32" },
  float64: { wireKind: 4, offKey: "offset",    type: "float64" },
  // List-of-primitive types. Reads happen through `cpp_any_open_list` +
  // per-element `cpp_any_list_get_*`, materialized into a JS array. Lists
  // are pointer-typed in the wire format, so they live at a slot index.
  // Not in cpp_any_batch_read. These go through `_readSingle` even from
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
 * synchronously on malformed input. So that schema bugs surface at load
 * time, not on the first read.
 *
 * Nested structs use `{ kind: "struct", slot: N, schema: <result of
 * defineSchema(...)> }`. The nested schema is materialized eagerly when
 * the field is read, so it returns a plain object. Not a sub-reader -
 * since the underlying wasm cursor would be invalidated by any sibling
 * access.
 *
 * For the `buildDynamic` write side, pass `{ dataWords, ptrWords }` as the
 * second argument. The struct's wire-format dimensions. Without these
 * the schema is read-only.
 */
export function defineSchema(spec, opts) {
  if (!spec || typeof spec !== "object") throw new TypeError("defineSchema: expected an object");
  const fields = Object.create(null);
  for (const [name, raw] of Object.entries(spec)) {
    if (!raw || typeof raw !== "object") throw new TypeError(`field "${name}": expected an object`);
    if (raw.kind === "struct") {
      // Nested struct. Schema is recursive. Validate the nested schema
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
  const out = { fields };
  if (opts) {
    if (opts.dataWords !== undefined) {
      if (!Number.isInteger(opts.dataWords) || opts.dataWords < 0) {
        throw new TypeError("defineSchema: opts.dataWords must be a non-negative integer");
      }
      out.dataWords = opts.dataWords;
    }
    if (opts.ptrWords !== undefined) {
      if (!Number.isInteger(opts.ptrWords) || opts.ptrWords < 0) {
        throw new TypeError("defineSchema: opts.ptrWords must be a non-negative integer");
      }
      out.ptrWords = opts.ptrWords;
    }
  }
  return out;
}

/**
 * Begin building a Cap'n Proto message at runtime. The schema must have
 * been defined with `dataWords` and `ptrWords` (the struct's wire-format
 * dimensions); without them the builder doesn't know how big the data and
 * pointer sections should be.
 *
 *   const Schema = defineSchema({
 *     name: { kind: "text", slot: 0 },
 *     age:  { kind: "uint32", offset: 0 },
 *   }, { dataWords: 1, ptrWords: 1 });
 *
 *   const b = buildDynamic(cpp, Schema);
 *   b.set("name", "Alice");
 *   b.set("age", 36);
 *   const bytes = b.finalize();
 *
 * Supports primitive setters (text/data via wasm boundary, fixed-width
 * integers + floats + bool via direct memory writes). Nested structs and
 * lists aren't in this pass. Codegen still wins for those write paths.
 */
export function buildDynamic(cpp, schema) {
  if (typeof schema?.dataWords !== "number" || typeof schema?.ptrWords !== "number") {
    throw new Error(
      "buildDynamic: schema needs dataWords + ptrWords " +
      "(pass them as the second arg to defineSchema)",
    );
  }
  if (cpp._exports.cpp_any_builder_init(schema.dataWords, schema.ptrWords) !== 1) {
    throw new Error("cpp_any_builder_init failed");
  }
  return new DynamicBuilder(cpp, schema);
}

/**
 * Builder bound to one in-progress message. Call .set(name, value) to
 * write each field, then .finalize() to produce framed bytes. The builder
 * is single-shot. Finalize() invalidates it.
 */
export class DynamicBuilder {
  constructor(cpp, schema) {
    this._cpp = cpp;
    this._schema = schema;
    this._dataPtr = cpp._exports.cpp_any_builder_data_ptr();
    this._finalized = false;
    // Cache one DataView for the wasm memory.buffer. The 8-byte and float
    // setters all need a DataView, and `new DataView(buffer)` was the
    // largest single per-call alloc on the bench (~15 ns each, ×4 hot
    // setters = ~60 ns/build). Refresh the view if memory grows under us
    // (text/data setters are the only paths that can trigger growth, and
    // they're rare; we check via buffer-identity each set).
    this._dv = new DataView(cpp._u8.buffer);
  }

  /** Write `value` into the field named `name`. Throws on unknown field. */
  set(name, value) {
    if (this._finalized) throw new Error("builder is finalized");
    const desc = this._schema.fields[name];
    if (!desc) throw new Error(`unknown field: ${name}`);
    const cpp = this._cpp;
    const exp = cpp._exports;
    const u8 = cpp._u8;
    const dp = this._dataPtr;
    // If wasm grew its memory between calls, our cached u8/buffer is
    // stale. Refresh both before the switch dispatch.
    if (this._dv.buffer !== u8.buffer) this._dv = new DataView(u8.buffer);
    const dv = this._dv;
    switch (desc.type) {
      case "uint8":
      case "int8":
        u8[dp + desc.off] = value & 0xff;
        return;
      case "uint16":
      case "int16": {
        const o = dp + desc.off;
        u8[o] = value & 0xff;
        u8[o + 1] = (value >>> 8) & 0xff;
        return;
      }
      case "uint32":
      case "int32": {
        const o = dp + desc.off;
        u8[o] = value & 0xff;
        u8[o + 1] = (value >>> 8) & 0xff;
        u8[o + 2] = (value >>> 16) & 0xff;
        u8[o + 3] = (value >>> 24) & 0xff;
        return;
      }
      case "uint64":
      case "int64": {
        if (typeof value === "bigint") {
          dv.setBigInt64(dp + desc.off, value, true);
        } else {
          let lo, hi;
          if (value >= 0) { lo = value >>> 0; hi = ((value / 4294967296) >>> 0); }
          else { const a = -value; const aLo = a >>> 0; const aHi = ((a / 4294967296) >>> 0);
                 lo = (~aLo + 1) >>> 0; hi = (~aHi + (lo === 0 ? 1 : 0)) >>> 0; }
          dv.setUint32(dp + desc.off, lo, true);
          dv.setUint32(dp + desc.off + 4, hi, true);
        }
        return;
      }
      case "float32":
        dv.setFloat32(dp + desc.off, value, true);
        return;
      case "float64":
        dv.setFloat64(dp + desc.off, value, true);
        return;
      case "bool": {
        // bitOffset is in bits within the data section. Value is truthy/falsy.
        const byte = dp + (desc.off >>> 3);
        const bit = 1 << (desc.off & 7);
        if (value) u8[byte] |= bit;
        else u8[byte] &= ~bit & 0xff;
        return;
      }
      case "text": {
        // Encode UTF-8 directly into the wasm scratch buffer. EncodeInto
        // skips the intermediate Uint8Array that .encode() allocates,
        // matching what the codegen builder does. Saves ~50-100 ns per
        // text field on the bench.
        const inPtr = exp.cpp_in_ptr();
        const inCap = exp.cpp_in_capacity();
        let written;
        if (typeof value === "string") {
          const dst = cpp._u8.subarray(inPtr, inPtr + inCap);
          written = SHARED_ENCODER.encodeInto(value, dst).written;
        } else {
          if (value.length > inCap) throw new Error("text value larger than scratch buffer");
          cpp._u8.set(value, inPtr);
          written = value.length;
        }
        exp.cpp_any_builder_set_text(desc.off, written);
        return;
      }
      case "data": {
        if (!(value instanceof Uint8Array)) throw new TypeError("data field expects Uint8Array");
        const inPtr = exp.cpp_in_ptr();
        if (value.length > exp.cpp_in_capacity()) {
          throw new Error("data value larger than scratch buffer");
        }
        cpp._u8.set(value, inPtr);
        exp.cpp_any_builder_set_data(desc.off, value.length);
        return;
      }
      // Lists. Desc.type is "list" with desc.element being the element
      // kind ("uint32", "text", "data", "bool", etc.). The init+set pair
      // is named after the element kind. Lists of primitives + text + data
      // all live here.
      case "list": {
        if (!Array.isArray(value)) throw new TypeError(`list<${desc.element}> field expects an array`);
        const elemKind = desc.element;
        if (elemKind === "text") {
          if (exp.cpp_any_builder_init_list_text(desc.off, value.length) !== 1) {
            throw new Error("init_list_text failed");
          }
          const inPtr = exp.cpp_in_ptr();
          const inCap = exp.cpp_in_capacity();
          for (let i = 0; i < value.length; i++) {
            const s = value[i];
            let written;
            if (typeof s === "string") {
              const dst = cpp._u8.subarray(inPtr, inPtr + inCap);
              written = SHARED_ENCODER.encodeInto(s, dst).written;
            } else {
              if (s.length > inCap) throw new Error("text element larger than scratch buffer");
              cpp._u8.set(s, inPtr);
              written = s.length;
            }
            if (exp.cpp_any_builder_set_list_text(desc.off, i, written) !== 1) {
              throw new Error(`set_list_text(${i}) failed`);
            }
          }
          return;
        }
        if (elemKind === "data") {
          if (exp.cpp_any_builder_init_list_data(desc.off, value.length) !== 1) {
            throw new Error("init_list_data failed");
          }
          const inPtr = exp.cpp_in_ptr();
          const inCap = exp.cpp_in_capacity();
          for (let i = 0; i < value.length; i++) {
            const d = value[i];
            if (!(d instanceof Uint8Array)) throw new TypeError(`list<data>[${i}] not a Uint8Array`);
            if (d.length > inCap) throw new Error(`data element ${i} larger than scratch buffer`);
            cpp._u8.set(d, inPtr);
            if (exp.cpp_any_builder_set_list_data(desc.off, i, d.length) !== 1) {
              throw new Error(`set_list_data(${i}) failed`);
            }
          }
          return;
        }
        // Numeric / bool lists.
        const init = exp[`cpp_any_builder_init_list_${elemKind}`];
        const setEl = exp[`cpp_any_builder_set_list_${elemKind}`];
        if (!init || !setEl) throw new Error(`builder for list<${elemKind}> not exported`);
        if (init(desc.off, value.length) !== 1) {
          throw new Error(`init_list_${elemKind} failed`);
        }
        if (elemKind === "uint64" || elemKind === "int64") {
          for (let i = 0; i < value.length; i++) {
            const v = value[i];
            setEl(desc.off, i, typeof v === "bigint" ? v : BigInt(v));
          }
        } else if (elemKind === "bool") {
          for (let i = 0; i < value.length; i++) setEl(desc.off, i, value[i] ? 1 : 0);
        } else {
          for (let i = 0; i < value.length; i++) setEl(desc.off, i, value[i]);
        }
        return;
      }
      // Nested struct: push a nested AnyStruct cursor onto the wasm
      // stack so subsequent setters write into the nested struct, then
      // walk the nested fields and pop. Doesn't allocate a separate
      // message. Wire bytes are exactly what a single end-to-end build
      // would produce. Save/restore _schema + _dataPtr around the
      // recursion so nested-of-nested works.
      case "struct": {
        if (!desc.schema) throw new Error("struct field requires a `schema` in its descriptor");
        if (value === null) return;
        const ns = desc.schema;
        if (typeof ns?.dataWords !== "number" || typeof ns?.ptrWords !== "number") {
          throw new Error("nested struct schema needs dataWords + ptrWords");
        }
        if (exp.cpp_any_builder_enter_struct(desc.off, ns.dataWords, ns.ptrWords) !== 1) {
          throw new Error("enter_struct failed");
        }
        const savedSchema = this._schema;
        const savedDataPtr = this._dataPtr;
        this._schema = ns;
        this._dataPtr = exp.cpp_any_builder_data_ptr();
        try {
          for (const subName in ns.fields) {
            const v = value[subName];
            if (v === undefined) continue;
            this.set(subName, v);
          }
        } finally {
          this._schema = savedSchema;
          this._dataPtr = savedDataPtr;
          if (exp.cpp_any_builder_exit_struct() !== 1) {
            throw new Error("exit_struct failed");
          }
        }
        return;
      }
      // List of structs: init the list-of-AnyStruct at the parent's
      // pointer slot using the element schema's size, then for each
      // element push the element AnyStruct onto the cursor stack and
      // recursively populate it via the same set() machinery used for
      // a single nested struct.
      case "listStruct": {
        if (!Array.isArray(value)) throw new TypeError("listStruct field expects an array");
        const elem = desc.element;
        if (typeof elem?.dataWords !== "number" || typeof elem?.ptrWords !== "number") {
          throw new Error("listStruct element schema needs dataWords + ptrWords");
        }
        if (exp.cpp_any_builder_init_list_struct(desc.off, value.length, elem.dataWords, elem.ptrWords) !== 1) {
          throw new Error("init_list_struct failed");
        }
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (item == null) continue;
          if (exp.cpp_any_builder_enter_list_element(desc.off, i) !== 1) {
            throw new Error(`enter_list_element(${i}) failed`);
          }
          const savedSchema = this._schema;
          const savedDataPtr = this._dataPtr;
          this._schema = elem;
          this._dataPtr = exp.cpp_any_builder_data_ptr();
          try {
            for (const subName in elem.fields) {
              const v = item[subName];
              if (v === undefined) continue;
              this.set(subName, v);
            }
          } finally {
            this._schema = savedSchema;
            this._dataPtr = savedDataPtr;
            if (exp.cpp_any_builder_exit_struct() !== 1) {
              throw new Error("exit_struct failed (list element)");
            }
          }
        }
        return;
      }
      default:
        throw new Error(`buildDynamic: kind "${desc.type}" not supported on the write side`);
    }
  }

  /**
   * Apply fields from a plain JS object. Same shape as JSON.stringify on
   * the wire side: keys match the schema's field names, missing keys are
   * skipped, unknown keys are ignored. Returns `this` for chaining.
   *
   * Per-field cost is the same as calling `set(name, value)` directly -
   * one switch-on-type and one wasm setter call. The schema's `fields`
   * object is iterated via `Object.keys` once; that's a hash-walk but it
   * happens once per fromObject call, not per field, so it's amortized.
   */
  fromObject(o) {
    if (o == null) return this;
    if (this._finalized) throw new Error("builder is finalized");
    const fields = this._schema.fields;
    for (const name in fields) {
      const v = o[name];
      if (v === undefined) continue;
      this.set(name, v);
    }
    return this;
  }

  /** Finalize the builder and return the framed Cap'n Proto bytes. */
  finalize() {
    if (this._finalized) throw new Error("builder already finalized");
    this._finalized = true;
    const exp = this._cpp._exports;
    const len = exp.cpp_any_builder_finalize();
    if (!len) throw new Error("cpp_any_builder_finalize failed");
    return this._cpp._u8.slice(this._cpp._outPtr, this._cpp._outPtr + len);
  }
}

/**
 * One-call equivalent of `JSON.stringify` for the dynamic path: take a
 * schema descriptor and a plain JS object, return framed Cap'n Proto bytes.
 *
 *   import { defineSchema, encodeDynamic } from "capnwasm/dynamic";
 *
 *   const User = defineSchema({
 *     id:    { kind: "uint64", offset: 0 },
 *     name:  { kind: "text",   slot: 0 },
 *   }, { dataWords: 1, ptrWords: 1 });
 *
 *   const bytes = encodeDynamic(cpp, User, { id: 42n, name: "Alice" });
 *
 * Equivalent to `buildDynamic(cpp, User).fromObject(obj).finalize()`.
 * The codegen path's `XBuilder.from(cpp, obj)` is the same shape but
 * faster because the field list is hard-coded at codegen time.
 *
 * @param {object} cpp     loaded CapnCpp
 * @param {object} schema  return value of defineSchema(spec, { dataWords, ptrWords })
 * @param {object} obj     plain JS object whose keys match the schema
 * @returns {Uint8Array}   framed Cap'n Proto wire bytes
 */
export function encodeDynamic(cpp, schema, obj) {
  return buildDynamic(cpp, schema).fromObject(obj).finalize();
}

/**
 * Load `bytes` into the wasm scratch buffer and prepare a dynamic reader.
 *
 * `cpp` is a CapnCpp instance from `capnwasm/load`. `schema` is from
 * `defineSchema`. `bytes` is a serialized Cap'n Proto message.
 */
export function openDynamic(cpp, schema, bytes) {
  if (typeof cpp._allocMessage === "function") {
    const msg = cpp._allocMessage(bytes);
    cpp._openAnyMessage(msg);
    return new DynamicReader(cpp, schema, { msg, gen: cpp._generation });
  }
  return openDynamicUnsafe(cpp, schema, bytes);
}

export function openDynamicUnsafe(cpp, schema, bytes) {
  if (bytes.length > cpp._cap) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._inPtr);
  // cpp_any_open returns the data section pointer (or 0 for an empty
  // struct. That's still a successful open). It only "fails" by
  // throwing inside the wasm if the bytes are malformed.
  cpp._exports.cpp_any_open(bytes.length);
  if (typeof cpp._bumpGeneration === "function") cpp._bumpGeneration();
  return new DynamicReader(cpp, schema, { gen: cpp._generation ?? 0 });
}

/**
 * Reader bound to a single message. Field access is via the `pick` family
 * (one wasm boundary call per pick) or by indexing the reader directly,
 * which goes through a Proxy and resolves one field per call.
 */
export class DynamicReader {
  constructor(cpp, schema, opts = undefined) {
    this._cpp = cpp;
    this._schema = schema;
    this._proxy = null;
    this._msg = opts && opts.msg ? opts.msg : null;
    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);
  }

  _ensureOpen() {
    if (this._gen === (this._cpp._generation ?? 0)) return;
    if (!this._msg) throw new StaleDynamicReaderError();
    this._cpp._openAnyMessage(this._msg);
    this._gen = this._cpp._generation ?? 0;
  }

  /** Pick a subset of fields in one wasm round trip. Order matches `names`. */
  pick(names) {
    this._ensureOpen();
    return _batchPick(this._cpp, this._schema.fields, names);
  }

  /** Materialize every field in the schema. */
  toObject() {
    return this.pick(Object.keys(this._schema.fields));
  }

  /** Get a single field by name. */
  get(name) {
    this._ensureOpen();
    const desc = this._schema.fields[name];
    if (!desc) return undefined;
    return _readSingle(this._cpp, desc);
  }

  /**
   * Proxy-style access. `reader.fieldName`. Convenience over .get(). Each
   * access is a separate wasm call; for multiple fields prefer `pick`.
   */
  get fields() {
    if (this._proxy) return this._proxy;
    const reader = this;
    const cpp = this._cpp;
    const fields = this._schema.fields;
    this._proxy = new Proxy(Object.create(null), {
      get(_, name) {
        if (typeof name !== "string") return undefined;
        const desc = fields[name];
        if (!desc) return undefined;
        reader._ensureOpen();
        return _readSingle(cpp, desc);
      },
      has(_, name) { return typeof name === "string" && fields[name] !== undefined; },
      ownKeys() { return Object.keys(fields); },
      getOwnPropertyDescriptor(_, name) {
        if (typeof name !== "string" || !fields[name]) return undefined;
        reader._ensureOpen();
        return { enumerable: true, configurable: true, value: _readSingle(cpp, fields[name]) };
      },
    });
    return this._proxy;
  }
}

export class StaleDynamicReaderError extends Error {
  constructor(message = "DynamicReader is stale because the CapnCpp runtime opened another message") {
    super(message);
    this.name = "StaleDynamicReaderError";
  }
}

// Single-field read. One wasm call. Use this for the Proxy path, or when
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
      // cpp_any_int64_at(uint32_t byte_offset, int64_t default_val): the
      // first arg is i32, the second is i64 (so it must be a BigInt). The
      // return value comes back as a BigInt; we coerce to a plain Number
      // when it fits in safe-integer range, otherwise hand back the BigInt.
      const v = exp.cpp_any_int64_at(desc.off, 0n);
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
// of its schema, then pop. Eager materialization keeps the API safe. A
// returned sub-reader would silently break the moment the caller touches
// a sibling field at the parent level (which would re-position the
// cursor). Nested-of-nested works because each recursion saves and
// restores the cursor via enter/leave.
function _readNestedStruct(cpp, desc) {
  const exp = cpp._exports;
  if (exp.cpp_any_enter_struct(desc.off) !== 1) {
    // Pointer slot is null or out-of-range. Return null, the
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
// invalidates this one. Readers materialize the whole list before
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

// Batched pick. Single wasm call returning all requested fields in order.
// Mirrors the codegen-generated `_capnwasmPick` helper but reads the field
// list from the dynamic schema instead of a baked _FIELDS object.
//
// Lists fall back to per-field reads because cpp_any_batch_read doesn't
// know about list types. The fallback is whole-pick: as soon as any field
// is a list, we route every field through _readSingle. The fast batch
// path stays intact for the common pure-primitive case.
function _batchPick(cpp, fields, names) {
  const u8 = cpp._u8;
  // _dv() returns a buffer-cached DataView (refresh only on memory growth).
  // _auxPtr is a wasm-init constant we cache once on CapnCpp load.
  const dv = cpp._dv();
  const aux = cpp._auxPtr;

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
