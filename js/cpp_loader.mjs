// Loads the C++ capnproto wasm module (built via cpp/build.sh from upstream
// capnproto sources statically linked through zig cc).
//
// CapnCpp itself only depends on the wasi shim — it doesn't pull in
// tape_codec.mjs. The capnweb-shape tape codec lives in js/tape_serializer.mjs
// as free functions; bundles that don't use it (e.g. RPC-only browser clients)
// drop tape_codec entirely.

import { buildRuntimeWasiImports } from "./cpp_wasi_runtime.mjs";

export class CapnCpp {
  /** @type {WebAssembly.Instance} */
  #instance;
  /** @type {WebAssembly.Memory} */
  #memory;
  #exports;
  #inPtr = 0;
  #outPtr = 0;
  #cap = 0;

  static async load(wasmSource) {
    const wasi = buildRuntimeWasiImports();
    const importObj = { wasi_snapshot_preview1: wasi.imports };

    // Streaming compile when the source is a URL/Request/Response — the
    // browser parses bytes as they arrive instead of waiting for the full
    // buffer. Falls through to in-memory instantiate for Uint8Array sources.
    const isResp = typeof Response !== "undefined" && wasmSource instanceof Response;
    const isReq  = typeof Request  !== "undefined" && wasmSource instanceof Request;
    const isUrl  = typeof wasmSource === "string" || wasmSource instanceof URL;

    let instance;
    if (isResp || isReq || isUrl) {
      const resp = isResp ? wasmSource : fetch(wasmSource);
      if (typeof WebAssembly.instantiateStreaming === "function") {
        ({ instance } = await WebAssembly.instantiateStreaming(resp, importObj));
      } else {
        const bytes = new Uint8Array(await (await resp).arrayBuffer());
        ({ instance } = await WebAssembly.instantiate(bytes, importObj));
      }
    } else {
      const bytes = wasmSource instanceof Uint8Array
        ? wasmSource
        : new Uint8Array(wasmSource);
      ({ instance } = await WebAssembly.instantiate(bytes, importObj));
    }
    wasi.setMemory(instance.exports.memory);

    const cpp = new CapnCpp();
    cpp.#instance = instance;
    cpp.#memory = instance.exports.memory;
    cpp.#exports = instance.exports;
    if (cpp.#exports.cpp_abi_version() !== 1) {
      throw new Error("Unsupported capnp_cpp ABI version");
    }
    cpp.#inPtr = cpp.#exports.cpp_in_ptr();
    cpp.#outPtr = cpp.#exports.cpp_out_ptr();
    cpp.#cap = cpp.#exports.cpp_in_capacity();
    return cpp;
  }

  get exports() { return this.#exports; }
  get memory() { return this.#memory; }

  #u8() { return new Uint8Array(this.#memory.buffer); }

  /**
   * Open `bytes` for lazy field access. Returns a LazyReader; calls on it
   * pull individual fields from the wasm-side parsed message (real capnproto
   * MessageReader) without materializing the full JS value tree.
   */
  openLazy(bytes) {
    if (bytes.length > this.#cap) throw new Error("input larger than scratch buffer");
    this.#u8().set(bytes, this.#inPtr);
    if (this.#exports.cpp_lazy_open(bytes.length) !== 1) {
      throw new Error("cpp_lazy_open failed");
    }
    return new LazyReader(this);
  }

  get _exports() { return this.#exports; }
  get _inPtr()   { return this.#inPtr; }
  get _outPtr()  { return this.#outPtr; }
  get _cap()     { return this.#cap; }
  get _u8()      { return this.#u8(); }
}

// Module-scoped cache so repeated lookups of the same field name don't burn
// allocations in TextEncoder.encode.
const NAME_ENCODE_CACHE = new Map();
const SHARED_TEXT_ENCODER = new TextEncoder();
function encodeName(name) {
  let e = NAME_ENCODE_CACHE.get(name);
  if (!e) {
    e = SHARED_TEXT_ENCODER.encode(name);
    NAME_ENCODE_CACHE.set(name, e);
  }
  return e;
}

export class LazyReader {
  #cpp;

  constructor(cpp) { this.#cpp = cpp; }

  /** Single-field text lookup. */
  fieldText(name) {
    const enc = encodeName(name);
    const u8 = this.#cpp._u8;
    const namePtr = this.#cpp._exports.cpp_lazy_aux_ptr();
    u8.set(enc, namePtr);
    const len = this.#cpp._exports.cpp_lazy_msg_obj_field_text(namePtr, enc.length);
    if (len === 0) return undefined;
    const bytes = u8.subarray(this.#cpp._outPtr, this.#cpp._outPtr + len);
    let asciiOk = true;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { asciiOk = false; break; }
    if (asciiOk) {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    return new TextDecoder().decode(bytes);
  }

  /** Batched fetch — N fields in one wasm boundary call. */
  fieldsText(names) {
    if (names.length === 0) return [];
    if (names.length > 256) throw new Error("fieldsText limit is 256 names");
    const u8 = this.#cpp._u8;
    const inPtr = this.#cpp._exports.cpp_lazy_aux_ptr();
    const inCap = this.#cpp._exports.cpp_lazy_aux_capacity();

    const dv = new DataView(u8.buffer, inPtr, inCap);
    dv.setUint32(0, names.length, true);
    const encoded = new Array(names.length);
    for (let i = 0; i < names.length; i++) {
      const e = encodeName(names[i]);
      encoded[i] = e;
      dv.setUint32(4 + i * 4, e.length, true);
    }
    let pos = 4 + names.length * 4;
    for (let i = 0; i < names.length; i++) {
      u8.set(encoded[i], inPtr + pos);
      pos += encoded[i].length;
    }

    const written = this.#cpp._exports.cpp_lazy_obj_fields_text(inPtr, pos);
    if (written === 0) return new Array(names.length).fill(undefined);

    const outPtr = this.#cpp._outPtr;
    const outDv = new DataView(u8.buffer, outPtr, written);
    const results = new Array(names.length);
    let readPos = names.length * 4;
    for (let i = 0; i < names.length; i++) {
      const len = outDv.getUint32(i * 4, true);
      if (len === 0xFFFFFFFF) {
        results[i] = undefined;
        continue;
      }
      const bytes = u8.subarray(outPtr + readPos, outPtr + readPos + len);
      readPos += len;
      let asciiOk = true;
      for (let j = 0; j < bytes.length; j++) if (bytes[j] >= 0x80) { asciiOk = false; break; }
      if (asciiOk) {
        let s = "";
        for (let j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
        results[i] = s;
      } else {
        results[i] = new TextDecoder().decode(bytes);
      }
    }
    return results;
  }
}
