// Loads the C++ capnproto wasm module (built via cpp/build.sh from upstream
// capnproto sources statically linked through zig cc).
//
// CapnCpp owns the wasm instance, exposes the scratch pointers/capacities,
// and provides a managed-message allocator (cpp_msg_alloc/free + open_at)
// so safe Readers can survive other decodes on the same instance.

export class CapnCpp {
  /** @type {WebAssembly.Instance} */
  #instance;
  /** @type {WebAssembly.Memory} */
  #memory;
  #exports;
  #inPtr = 0;
  #outPtr = 0;
  #cap = 0;
  // cpp_scratch_aux is a fixed C++ global. Its address and capacity never
  // change after wasm init. Cache once so every pick / batch-read avoids
  // the wasm boundary call to look them up.
  #auxPtr = 0;
  #auxCap = 0;
  #generation = 0;
  #messageFinalizer = null;
  // A cached DataView over memory.buffer. Hot reader paths re-use this
  // instead of `new DataView(...)` per call. Refreshed on memory growth
  // via #refreshDv().
  #dv = null;

  static async load(wasmSource) {
    // Inline WASI imports. Avoids a cross-module factory call on the cold
    // path. Only the two imports the slim wasm actually declares
    // (fd_write + fd_close). The reactor-mode build dropped the
    // command-mode crt1, so args_get / args_sizes_get / proc_exit are
    // no longer referenced by the wasm and don't need to be supplied.
    let mem;
    const wasi = {
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
      fd_close: zero,
    };
    const importObj = { wasi_snapshot_preview1: wasi };

    // Dispatch carefully: do NOT touch `Response`, `Request`, or `URL` on the
    // bytes/Module fast paths. In Node, those globals come from undici and
    // lazy-init at first reference (~10 ms). Duck-type instead. Response and
    // Request both expose .arrayBuffer + .headers; URL has .href.
    let instance;
    if (typeof wasmSource === "string") {
      instance = (await WebAssembly.instantiateStreaming(fetch(wasmSource), importObj)).instance;
    } else if (wasmSource instanceof WebAssembly.Module) {
      // Cloudflare Workers' canonical pattern. Sync instantiate (link only).
      instance = await WebAssembly.instantiate(wasmSource, importObj);
    } else if (wasmSource && typeof wasmSource === "object"
               && typeof wasmSource.arrayBuffer === "function" && wasmSource.headers) {
      // Response / Request. Duck-typed, no `instanceof Response`.
      instance = (await WebAssembly.instantiateStreaming(wasmSource, importObj)).instance;
    } else if (wasmSource && typeof wasmSource === "object"
               && typeof wasmSource.href === "string") {
      // URL. Duck-typed.
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
    if (cpp.#exports.cpp_scratch_aux_ptr) {
      cpp.#auxPtr = cpp.#exports.cpp_scratch_aux_ptr();
      cpp.#auxCap = cpp.#exports.cpp_scratch_aux_capacity();
    }
    cpp.#dv = new DataView(mem.buffer);
    cpp.#messageFinalizer = new FinalizationRegistry((ptr) => {
      try { cpp.#exports.cpp_msg_free?.(ptr); } catch (_) {}
    });
    return cpp;
  }

  /** Refresh the cached DataView if memory has grown since last fetch. */
  _dv() {
    if (this.#dv.buffer !== this.#memory.buffer) {
      this.#dv = new DataView(this.#memory.buffer);
    }
    return this.#dv;
  }

  get exports() { return this.#exports; }
  get memory() { return this.#memory; }
  get _generation() { return this.#generation; }

  #u8() { return new Uint8Array(this.#memory.buffer); }

  _bumpGeneration() { return ++this.#generation; }

  // Managed message allocation requires the wasm to export cpp_msg_alloc /
  // cpp_msg_free / cpp_any_open_at. Capnwasm 0.0.3+ ships those by default;
  // older builds drop into the *Unsafe path. We probe once at load time so
  // callers can branch on a single boolean instead of every open path doing
  // its own feature-detect.
  _supportsManagedMessages() {
    const e = this.#exports;
    return !!(e.cpp_msg_alloc && e.cpp_msg_free && e.cpp_any_open_at);
  }

  _allocMessage(bytes) {
    if (!this._supportsManagedMessages()) return null;
    const ptr = this.#exports.cpp_msg_alloc(bytes.length) >>> 0;
    if (!ptr) throw new Error("cpp_msg_alloc failed");
    this.#u8().set(bytes, ptr);
    const msg = { ptr, len: bytes.length };
    this.#messageFinalizer?.register(msg, ptr, msg);
    return msg;
  }

  _freeMessage(msg) {
    if (!msg || !msg.ptr) return;
    this.#messageFinalizer?.unregister(msg);
    this.#exports.cpp_msg_free?.(msg.ptr);
    msg.ptr = 0;
    msg.len = 0;
  }

  _openAnyMessage(msg) {
    if (!msg || !msg.ptr) throw new Error("reader message has been disposed");
    if (!this._supportsManagedMessages()) {
      throw new Error("cpp_any_open_at not exported; rebuild capnwasm wasm runtime");
    }
    const dataPtr = this.#exports.cpp_any_open_at(msg.ptr, msg.len);
    this._bumpGeneration();
    return dataPtr;
  }

  get _exports() { return this.#exports; }
  get _inPtr()   { return this.#inPtr; }
  get _outPtr()  { return this.#outPtr; }
  get _cap()     { return this.#cap; }
  get _auxPtr()  { return this.#auxPtr; }
  get _auxCap()  { return this.#auxCap; }
  get _u8()      { return this.#u8(); }
}

function zero() { return 0; }
