// Generated from users.capnp by capnwasm-gen — do not edit by hand.

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
  const aux = cpp._exports.cpp_lazy_aux_ptr();
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

export class UserReader {
  constructor(cpp) {
    this._cpp = cpp;
    this._exp = cpp._exports;
  }

  get id() {
    return this._exp.cpp_any_int64_at(0, 0n);
  }
  get name() {
    const len = this._exp.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get email() {
    const len = this._exp.cpp_any_text_at(1);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get joinedAtMs() {
    return this._exp.cpp_any_int64_at(8, 0n);
  }
  get active() {
    return this._exp.cpp_any_bool_at(128, 0) === 1;
  }
  get avatar() {
    const len = this._exp.cpp_any_data_at(2);
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return u8.slice(out, out + len);
  }

  static _FIELDS = {
    id: {"kind":4,"off":0,"type":"uint64"},
    name: {"kind":0,"off":0,"type":"text"},
    email: {"kind":0,"off":1,"type":"text"},
    joinedAtMs: {"kind":4,"off":8,"type":"uint64"},
    active: {"kind":5,"off":128,"type":"bool"},
    avatar: {"kind":6,"off":2,"type":"data"},
  };

  pick(names) {
    return UserReader._pickImpl(this._cpp, names);
  }

  static _pickImpl(cpp, names) {
    return _capnwasmPick(cpp, UserReader._FIELDS, names);
  }

  get access() {
    if (!this._plan) {
      this._plan = [];
      const recorded = this._plan;
      const fields = UserReader._FIELDS;
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
    const result = UserReader._pickImpl(this._cpp, this._plan);
    this._plan = null;
    this._access = null;
    return result;
  }

  toObject() {
    return UserReader._pickImpl(this._cpp, Object.keys(UserReader._FIELDS));
  }
}

export class UserBuilder {
  static _DATA_WORDS = 3;
  static _PTR_WORDS = 3;
  constructor(cpp, opts) {
    this._cpp = cpp;
    this._exp = cpp._exports;
    if (!opts || !opts.preinitialized) {
      if (this._exp.cpp_any_builder_init(3, 3) !== 1) {
        throw new Error("cpp_any_builder_init failed");
      }
    }
    this._dataPtr = this._exp.cpp_any_builder_data_ptr();
    this._u8 = cpp._u8;
  }

  set id(value) {
    const dv = new DataView(this._u8.buffer);
    if (typeof value === "bigint") {
      dv.setBigInt64(this._dataPtr + 0, value, true);
    } else {
      let lo, hi;
      if (value >= 0) { lo = (value >>> 0); hi = ((value / 4294967296) >>> 0); }
      else { const abs = -value; const aLo = (abs >>> 0); const aHi = ((abs / 4294967296) >>> 0);
             lo = (~aLo + 1) >>> 0; hi = (~aHi + (lo === 0 ? 1 : 0)) >>> 0; }
      dv.setUint32(this._dataPtr + 0, lo, true);
      dv.setUint32(this._dataPtr + 4, hi, true);
    }
  }
  set name(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(0, written);
    this._u8 = this._cpp._u8;
  }
  set email(value) {
    const inPtr = this._exp.cpp_in_ptr();
    const inCap = this._exp.cpp_in_capacity();
    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);
    const { written } = SHARED_ENCODER.encodeInto(value, dst);
    this._exp.cpp_any_builder_set_text(1, written);
    this._u8 = this._cpp._u8;
  }
  set joinedAtMs(value) {
    const dv = new DataView(this._u8.buffer);
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
  set active(value) {
    const u8 = this._u8;
    const off = this._dataPtr + 16;
    if (value) u8[off] |= 1;
    else u8[off] &= 254;
  }
  set avatar(value) {
    const u8 = this._cpp._u8;
    u8.set(value, this._exp.cpp_in_ptr());
    this._exp.cpp_any_builder_set_data(2, value.length);
    this._u8 = this._cpp._u8;
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
 * Open framed Cap'n Proto bytes for typed access. Returns a UserReader.
 */
export function openUser(cpp, bytes) {
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  if (cpp._exports.cpp_any_open(bytes.length) !== 1) throw new Error("cpp_any_open failed");
  return new UserReader(cpp);
}

/** Begin building a new User message. Returns a UserBuilder. */
export function buildUser(cpp) {
  return new UserBuilder(cpp);
}

