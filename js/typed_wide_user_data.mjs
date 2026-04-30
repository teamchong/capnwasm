// Typed reader/builder for cpp/typed_schema.capnp::WideUserData.
//
// In a production deployment this file would be emitted by a `capnp compile
// -ojs` plugin (analogous to capnp's existing C++/Rust/Go plugins). It is
// hand-written here as the demonstration of what users *would* write —
// or generate — to access the wasm at full Cap'n Proto speed.
//
// The shape is: integer-indexed wasm calls (no string lookups) wrapped in
// real JS getters (no Proxy traps). Each `.field0` access is a normal
// property read that V8 can inline through.

const SHARED_TEXT_DECODER = new TextDecoder();
const SHARED_TEXT_ENCODER = new TextEncoder();

function decodeAscii(bytes) {
  let asciiOk = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) { asciiOk = false; break; }
  }
  if (asciiOk) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  return SHARED_TEXT_DECODER.decode(bytes);
}

const FIELD_COUNT = 32;

/**
 * Reader for a WideUserData message currently held by the wasm side.
 *
 * Each property getter is hand-written here; a codegen plugin would emit
 * the same shape from typed_schema.capnp. The cost per access is one wasm
 * call by integer index — no string compare, no Proxy trap.
 */
export class WideUserDataReader {
  #cpp;

  constructor(cpp) { this.#cpp = cpp; }

  // Loop-generated property descriptors so the prototype has 32 hidden-
  // class slots. V8 builds a stable shape and inlines the calls.
  static {
    for (let i = 0; i < FIELD_COUNT; i++) {
      const idx = i;
      Object.defineProperty(WideUserDataReader.prototype, `field${i}`, {
        get() {
          const len = this._cpp_field_at(idx);
          if (len === 0) return "";
          const u8 = this._cpp_u8;
          const out = this._cpp_out_ptr;
          return decodeAscii(u8.subarray(out, out + len));
        },
        enumerable: true,
        configurable: false,
      });
    }
  }

  // Bound accessors used by the generated getters above. Defined as plain
  // properties to keep the call site monomorphic.
  get _cpp_u8() { return this.#cpp._u8; }
  get _cpp_out_ptr() { return this.#cpp._outPtr; }
  _cpp_field_at(idx) { return this.#cpp._exports.cpp_typed_field_at(idx); }
}

/**
 * Build a WideUserData message from a plain object with field0..field31.
 * Pack into the wasm input scratch as: u32 count, [u32 len + bytes]*32.
 * Returns the serialized Cap'n Proto bytes.
 */
export function serializeWideUserData(cpp, obj) {
  const u8 = cpp._u8;
  const inPtr = cpp._exports.cpp_in_ptr();
  const dv = new DataView(u8.buffer, inPtr, cpp._exports.cpp_in_capacity());
  dv.setUint32(0, FIELD_COUNT, true);
  let pos = 4;
  for (let i = 0; i < FIELD_COUNT; i++) {
    const v = obj[`field${i}`] ?? "";
    const enc = SHARED_TEXT_ENCODER.encode(v);
    dv.setUint32(pos, enc.length, true);
    pos += 4;
    u8.set(enc, inPtr + pos);
    pos += enc.length;
  }
  const outLen = cpp._exports.cpp_typed_serialize_wide(pos);
  if (outLen === 0) throw new Error("cpp_typed_serialize_wide failed");
  // Re-fetch the view: the wasm call may have grown memory and detached the old ArrayBuffer.
  const u8After = cpp._u8;
  const outPtr = cpp._exports.cpp_out_ptr();
  return u8After.slice(outPtr, outPtr + outLen);
}

/**
 * Open serialized WideUserData bytes for typed lazy access.
 * Returns a WideUserDataReader; field access is direct integer-index call.
 */
export function openWideUserData(cpp, bytes) {
  const u8 = cpp._u8;
  const inPtr = cpp._exports.cpp_in_ptr();
  if (bytes.length > cpp._exports.cpp_in_capacity()) {
    throw new Error("input larger than scratch buffer");
  }
  u8.set(bytes, inPtr);
  if (cpp._exports.cpp_typed_open(bytes.length) !== 1) {
    throw new Error("cpp_typed_open failed");
  }
  return new WideUserDataReader(cpp);
}
