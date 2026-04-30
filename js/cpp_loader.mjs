// Loads the C++ capnproto wasm module (built via cpp/build.sh from upstream
// capnproto sources statically linked through zig cc).
//
// CapnCpp itself only depends on the wasi shim — it doesn't pull in
// tape_codec.mjs. The capnweb-shape tape codec lives in js/tape_serializer.mjs
// as free functions; bundles that don't use it (e.g. RPC-only browser clients)
// drop tape_codec entirely.

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
    // Inline WASI imports — avoids a cross-module factory call on the cold
    // path. The closures share `mem` via lexical scope, set after instantiate.
    let mem;
    const wasi = {
      args_get: zero,
      args_sizes_get(argc_ptr, argv_buf_size_ptr) {
        const dv = new DataView(mem.buffer);
        dv.setUint32(argc_ptr, 0, true);
        dv.setUint32(argv_buf_size_ptr, 0, true);
        return 0;
      },
      fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
        let total = 0;
        const dv = new DataView(mem.buffer);
        for (let i = 0; i < iovs_len; i++) {
          const ptr = dv.getUint32(iovs_ptr + i * 8, true);
          const len = dv.getUint32(iovs_ptr + i * 8 + 4, true);
          if (fd === 1 || fd === 2) {
            const text = new TextDecoder().decode(new Uint8Array(mem.buffer, ptr, len));
            (fd === 2 ? console.error : console.log)(text.replace(/\n$/, ""));
          }
          total += len;
        }
        dv.setUint32(nwritten_ptr, total, true);
        return 0;
      },
      proc_exit(code) { throw new Error(`capnp_cpp: proc_exit(${code})`); },
      fd_close: zero,
    };
    const importObj = { wasi_snapshot_preview1: wasi };

    // Dispatch carefully: do NOT touch `Response`, `Request`, or `URL` on the
    // bytes/Module fast paths. In Node, those globals come from undici and
    // lazy-init at first reference (~10 ms). Duck-type instead — Response and
    // Request both expose .arrayBuffer + .headers; URL has .href.
    let instance;
    if (typeof wasmSource === "string") {
      instance = (await WebAssembly.instantiateStreaming(fetch(wasmSource), importObj)).instance;
    } else if (wasmSource instanceof WebAssembly.Module) {
      // Cloudflare Workers' canonical pattern. Sync instantiate (link only).
      instance = await WebAssembly.instantiate(wasmSource, importObj);
    } else if (wasmSource && typeof wasmSource === "object"
               && typeof wasmSource.arrayBuffer === "function" && wasmSource.headers) {
      // Response / Request — duck-typed, no `instanceof Response`.
      instance = (await WebAssembly.instantiateStreaming(wasmSource, importObj)).instance;
    } else if (wasmSource && typeof wasmSource === "object"
               && typeof wasmSource.href === "string") {
      // URL — duck-typed.
      instance = (await WebAssembly.instantiateStreaming(fetch(wasmSource), importObj)).instance;
    } else {
      // Uint8Array / ArrayBuffer / typed array.
      instance = (await WebAssembly.instantiate(wasmSource, importObj)).instance;
    }
    mem = instance.exports.memory;

    const cpp = new CapnCpp();
    cpp.#instance = instance;
    cpp.#memory = mem;
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

function zero() { return 0; }

// Module-scoped cache so repeated lookups of the same field name don't burn
// allocations in TextEncoder.encode.
const NAME_ENCODE_CACHE = new Map();
const SHARED_TEXT_ENCODER = new TextEncoder();
const SHARED_DECODER = new TextDecoder();
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
    return SHARED_DECODER.decode(u8.subarray(this.#cpp._outPtr, this.#cpp._outPtr + len));
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
      results[i] = SHARED_DECODER.decode(u8.subarray(outPtr + readPos, outPtr + readPos + len));
      readPos += len;
    }
    return results;
  }
}
