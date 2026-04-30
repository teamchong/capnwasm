// Generated from conformance_schema.capnp by capnwasm-gen — do not edit by hand.

const SHARED_TEXT_DECODER = new TextDecoder();
function decodeAscii(bytes) {
  let asciiOk = true;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { asciiOk = false; break; }
  if (asciiOk) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  return SHARED_TEXT_DECODER.decode(bytes);
}

export class PrimitivesReader {
  constructor(cpp) { this._cpp = cpp; }

  get u8() {
    return this._cpp._exports.cpp_any_uint8_at(0, 0);
  }
  get u16() {
    return this._cpp._exports.cpp_any_uint16_at(2, 0);
  }
  get u32() {
    return this._cpp._exports.cpp_any_uint32_at(4, 0);
  }
  get u64() {
    return this._cpp._exports.cpp_any_int64_at(8, 0n);
  }
  get i8() {
    return (this._cpp._exports.cpp_any_uint8_at(1, 0) << 24) >> 24;
  }
  get i16() {
    return (this._cpp._exports.cpp_any_uint16_at(16, 0) << 16) >> 16;
  }
  get i32() {
    return this._cpp._exports.cpp_any_uint32_at(20, 0) | 0;
  }
  get i64() {
    return this._cpp._exports.cpp_any_int64_at(24, 0n);
  }
  get f32() {
    const u = this._cpp._exports.cpp_any_uint32_at(32, 0) >>> 0;
    if (!this._f32buf) { this._f32buf = new ArrayBuffer(4); this._f32u32 = new Uint32Array(this._f32buf); this._f32f32 = new Float32Array(this._f32buf); }
    this._f32u32[0] = u;
    return this._f32f32[0];
  }
  get f64() {
    const lo = this._cpp._exports.cpp_any_uint32_at(40, 0) >>> 0;
    const hi = this._cpp._exports.cpp_any_uint32_at(44, 0) >>> 0;
    if (!this._f64buf) { this._f64buf = new ArrayBuffer(8); this._f64u32 = new Uint32Array(this._f64buf); this._f64f64 = new Float64Array(this._f64buf); }
    this._f64u32[0] = lo; this._f64u32[1] = hi;
    return this._f64f64[0];
  }
  get flag0() {
    return this._cpp._exports.cpp_any_bool_at(144, 0) === 1;
  }
  get flag1() {
    return this._cpp._exports.cpp_any_bool_at(145, 0) === 1;
  }
  get flag2() {
    return this._cpp._exports.cpp_any_bool_at(146, 0) === 1;
  }
  get text() {
    const len = this._cpp._exports.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get data() {
    const len = this._cpp._exports.cpp_any_data_at(1);
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return u8.slice(out, out + len);
  }
  get emptyText() {
    const len = this._cpp._exports.cpp_any_text_at(2);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get emptyData() {
    const len = this._cpp._exports.cpp_any_data_at(3);
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return u8.slice(out, out + len);
  }

  toObject() {
    return {
      u8: this.u8,
      u16: this.u16,
      u32: this.u32,
      u64: this.u64,
      i8: this.i8,
      i16: this.i16,
      i32: this.i32,
      i64: this.i64,
      f32: this.f32,
      f64: this.f64,
      flag0: this.flag0,
      flag1: this.flag1,
      flag2: this.flag2,
      text: this.text,
      data: this.data,
      emptyText: this.emptyText,
      emptyData: this.emptyData,
    };
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
