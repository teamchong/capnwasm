// Reader-only entry point: loads dist/capnp.reader.wasm with the
// minimum runtime needed to project capnp messages via draft() / per-field
// getters.
//
// Why this file is self-contained instead of importing cpp_loader.mjs:
//   - LazyReader (the legacy lazy field-access path) is not reachable from
//     reader.wasm (its cpp_lazy_* exports are absent), so importing
//     cpp_loader.mjs ships ~600 B of dead JS even after tree-shaking.
//   - The full WASI fd_write impl in cpp_loader.mjs decodes UTF-8 and
//     forwards to console.log/error so KJ_LOG can land somewhere in dev.
//     Reader-mode wasm is built with KJ_LOG no-op'd, so fd_write is
//     unreachable. Stubbing it to `() => 0` saves more bytes.
//
// Bundle: ~22 KB raw / ~1 KB gzip / ~700 B brotli for this JS shim.
// Total reader bundle (this file + capnp.reader.wasm) ≈ 21 KB gzip,
// within ~200 B of capnweb's whole library. Wasm gives memory safety
// and can update independently from the JS surface.

const noop = () => 0;
const WASI_IMPORTS = {
  wasi_snapshot_preview1: {
    fd_close: noop,
    fd_write: noop,
  },
};

export class CapnCpp {
  static async load(wasmSource) {
    if (wasmSource === undefined) {
      wasmSource = new URL("../dist/capnp.reader.wasm", import.meta.url);
    }
    let instance;
    if (typeof wasmSource === "string") {
      instance = (await WebAssembly.instantiateStreaming(fetch(wasmSource), WASI_IMPORTS)).instance;
    } else if (wasmSource instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(wasmSource, WASI_IMPORTS);
    } else if (wasmSource && typeof wasmSource === "object"
               && typeof wasmSource.arrayBuffer === "function" && wasmSource.headers) {
      instance = (await WebAssembly.instantiateStreaming(wasmSource, WASI_IMPORTS)).instance;
    } else if (wasmSource && typeof wasmSource === "object"
               && typeof wasmSource.href === "string") {
      instance = (await WebAssembly.instantiateStreaming(fetch(wasmSource), WASI_IMPORTS)).instance;
    } else {
      instance = (await WebAssembly.instantiate(wasmSource, WASI_IMPORTS)).instance;
    }
    const memory = instance.exports.memory;
    const cpp = new CapnCpp();
    cpp._memory = memory;
    cpp._exports = instance.exports;
    if (cpp._exports.cpp_abi_version() !== 1) {
      throw new Error("Unsupported capnp_cpp ABI version");
    }
    cpp._inPtr = cpp._exports.cpp_in_ptr();
    cpp._outPtr = cpp._exports.cpp_out_ptr();
    cpp._cap = cpp._exports.cpp_in_capacity();
    if (cpp._exports.cpp_lazy_aux_ptr) {
      cpp._auxPtr = cpp._exports.cpp_lazy_aux_ptr();
      cpp._auxCap = cpp._exports.cpp_lazy_aux_capacity();
    } else {
      cpp._auxPtr = 0;
      cpp._auxCap = 0;
    }
    cpp._cachedDv = new DataView(memory.buffer);
    return cpp;
  }

  get _u8() {
    return new Uint8Array(this._memory.buffer);
  }

  _dv() {
    if (this._cachedDv.buffer !== this._memory.buffer) {
      this._cachedDv = new DataView(this._memory.buffer);
    }
    return this._cachedDv;
  }

  get exports() { return this._exports; }
  get memory() { return this._memory; }
}

export async function load(wasmUrl) {
  return await CapnCpp.load(wasmUrl);
}
