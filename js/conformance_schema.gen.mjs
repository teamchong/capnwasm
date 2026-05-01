// Generated from conformance_schema.capnp by capnwasm-gen — do not edit by hand.

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

// Per-(class, field-list) cache of pre-encoded request bytes. Compiling the
// request is a tight loop but it's still wasted work in a hot pick loop.
// We key on a frozen Uint8Array of the descriptor bytes so identical field
// sets (the common case in batch processing) hit the cache.
const _PICK_REQ_CACHE = new WeakMap();  // fields -> Map<namesKey, Uint8Array>

function _getPickRequest(fields, names) {
  let perFields = _PICK_REQ_CACHE.get(fields);
  if (!perFields) { perFields = new Map(); _PICK_REQ_CACHE.set(fields, perFields); }
  const key = names.join("\0");
  let req = perFields.get(key);
  if (req) return req;
  const buf = new Uint8Array(4 + names.length * 5);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, names.length, true);
  let pos = 4;
  for (let i = 0; i < names.length; i++) {
    const d = fields[names[i]];
    if (!d) throw new Error("unknown field: " + names[i]);
    buf[pos] = d.kind; pos += 1;
    dv.setUint32(pos, d.off, true); pos += 4;
  }
  perFields.set(key, buf);
  return buf;
}

function _capnwasmPick(cpp, fields, names) {
  // Cached request prep — same names hit the WeakMap and skip the encode loop.
  const req = _getPickRequest(fields, names);
  const u8 = cpp._u8;
  const aux = cpp._auxPtr;
  u8.set(req, aux);
  const descs = new Array(names.length);
  for (let i = 0; i < names.length; i++) descs[i] = fields[names[i]];
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

export class PrimitivesReader {
  constructor(cpp) {
    this._cpp = cpp;
    this._exp = cpp._exports;
  }

  get u8() {
    return this._exp.cpp_any_uint8_at(0, 0);
  }
  get u16() {
    return this._exp.cpp_any_uint16_at(2, 0);
  }
  get u32() {
    return this._exp.cpp_any_uint32_at(4, 0);
  }
  get u64() {
    return this._exp.cpp_any_int64_at(8, 0n);
  }
  get i8() {
    return (this._exp.cpp_any_uint8_at(1, 0) << 24) >> 24;
  }
  get i16() {
    return (this._exp.cpp_any_uint16_at(16, 0) << 16) >> 16;
  }
  get i32() {
    return this._exp.cpp_any_uint32_at(20, 0) | 0;
  }
  get i64() {
    return this._exp.cpp_any_int64_at(24, 0n);
  }
  get f32() {
    _F32_VIEW_U32[0] = this._exp.cpp_any_uint32_at(32, 0) >>> 0;
    return _F32_VIEW_F32[0];
  }
  get f64() {
    _F64_VIEW_U32[0] = this._exp.cpp_any_uint32_at(40, 0) >>> 0;
    _F64_VIEW_U32[1] = this._exp.cpp_any_uint32_at(44, 0) >>> 0;
    return _F64_VIEW_F64[0];
  }
  get flag0() {
    return this._exp.cpp_any_bool_at(144, 0) === 1;
  }
  get flag1() {
    return this._exp.cpp_any_bool_at(145, 0) === 1;
  }
  get flag2() {
    return this._exp.cpp_any_bool_at(146, 0) === 1;
  }
  get text() {
    const len = this._exp.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get data() {
    const len = this._exp.cpp_any_data_at(1);
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return u8.slice(out, out + len);
  }
  get emptyText() {
    const len = this._exp.cpp_any_text_at(2);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get emptyData() {
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

  pick(names) {
    return PrimitivesReader._pickImpl(this._cpp, names);
  }

  static _pickImpl(cpp, names) {
    return _capnwasmPick(cpp, PrimitivesReader._FIELDS, names);
  }

  get access() {
    if (!this._plan) {
      this._plan = [];
      const recorded = this._plan;
      const fields = PrimitivesReader._FIELDS;
      this._access = new Proxy(Object.create(null), {
        get(_, name) {
          if (typeof name === "string" && (name in fields)) recorded.push(name);
          return undefined;
        }
      });
    }
    return this._access;
  }

  apply() {
    if (!this._plan || this._plan.length === 0) return {};
    const result = PrimitivesReader._pickImpl(this._cpp, this._plan);
    this._plan = null;
    this._access = null;
    return result;
  }

  toObject() {
    return PrimitivesReader._pickImpl(this._cpp, Object.keys(PrimitivesReader._FIELDS));
  }
}

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
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  if (cpp._exports.cpp_any_open(bytes.length) !== 1) throw new Error("cpp_any_open failed");
  return new PrimitivesReader(cpp);
}

/** Begin building a new Primitives message. Returns a PrimitivesBuilder. */
export function buildPrimitives(cpp) {
  return new PrimitivesBuilder(cpp);
}

