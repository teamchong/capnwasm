// Loader + JS-side import implementations for the experimental WasmGC
// decode module (wat/gc_decode.wat). Uses externref to construct the JS
// value tree directly from wasm calls — avoids the JS-side TapeReader walk.
//
// Hypothesis: V8's externref import boundary is cheaper than recursive JS
// tree-walk for object/array-heavy decodes.

const SHARED_DECODER = new TextDecoder();

export class GcDecoder {
  /** @type {WebAssembly.Memory} */
  #memory;
  /** @type {WebAssembly.Instance} */
  #instance;
  /** Tag enum names matching tape MSG_TAGS. */
  #msgNames = ["push", "pull", "resolve", "reject", "release", "stream", "abort", "pipe"];

  static async load(wasmSource, sharedMemory) {
    let bytes;
    if (wasmSource instanceof Uint8Array) bytes = wasmSource;
    else if (wasmSource instanceof ArrayBuffer) bytes = new Uint8Array(wasmSource);
    else bytes = new Uint8Array(await (await fetch(wasmSource)).arrayBuffer());

    const dec = new GcDecoder();
    dec.#memory = sharedMemory;
    const imports = {
      env: { memory: sharedMemory },
      js: dec.#buildImports(),
    };
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    dec.#instance = instance;
    return dec;
  }

  /** Decode a tape (already in shared memory at [ptr, ptr+len)) into a JS value. */
  decodeTape(ptr, len) {
    return this.#instance.exports.decode_root(ptr, len);
  }

  #u8() { return new Uint8Array(this.#memory.buffer); }

  #buildImports() {
    const u8 = () => this.#u8();
    return {
      make_array: () => [],
      array_push: (arr, v) => { arr.push(v); },
      make_object: () => ({}),
      set_field: (obj, key, val) => { obj[key] = val; },

      make_string: (ptr, len) => {
        // Fast path: ASCII inline.
        const buf = u8();
        let asciiOk = true;
        for (let i = 0; i < len; i++) {
          if (buf[ptr + i] >= 0x80) { asciiOk = false; break; }
        }
        if (asciiOk) {
          let s = "";
          for (let i = 0; i < len; i++) s += String.fromCharCode(buf[ptr + i]);
          return s;
        }
        return SHARED_DECODER.decode(buf.subarray(ptr, ptr + len));
      },

      make_int_safe: (lo, hi) => {
        // Reconstruct safe-integer JS number without BigInt.
        if (hi >= -0x200000 && hi <= 0x1FFFFF) {
          return hi * 4294967296 + (lo >>> 0);
        }
        // Fall back to bigint for very large values; shouldn't happen for IDs.
        const view = new DataView(new ArrayBuffer(8));
        view.setInt32(0, lo, true);
        view.setInt32(4, hi, true);
        return Number(view.getBigInt64(0, true));
      },

      make_double: (v) => v,
      make_undefined: () => ["undefined"],
      make_null: () => null,
      make_true: () => true,
      make_false: () => false,

      make_data: (ptr, len) => {
        const buf = u8();
        const slice = buf.subarray(ptr, ptr + len);
        if (slice.toBase64) return ["bytes", slice.toBase64()];
        let bin = "";
        for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
        return ["bytes", btoa(bin)];
      },

      make_date: (ms) => ["date", ms],
      make_bigint_text: (ptr, len) => {
        const buf = u8();
        let s = "";
        for (let i = 0; i < len; i++) s += String.fromCharCode(buf[ptr + i]);
        return ["bigint", s];
      },

      make_import_ref: (lo, hi) => ["import", hi * 4294967296 + (lo >>> 0)],
      make_export_ref: (lo, hi) => ["export", hi * 4294967296 + (lo >>> 0)],

      make_pipeline: (src, path) => ["pipeline", src, path],
      make_pipeline_with_args: (src, path, args) => ["pipeline", src, path, args],

      make_error: (type, msg) => ["error", type, msg],

      make_message: (tag, arg1, arg2) => {
        const name = this.#msgNames[tag];
        switch (name) {
          case "pull":    return [name, arg1];
          case "release": return [name, arg1, arg2];
          case "resolve":
          case "reject":  return [name, arg1, arg2];
          case "pipe":    return [name];
          default:        return [name, arg1];
        }
      },
    };
  }
}
