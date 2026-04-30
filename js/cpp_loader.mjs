// Loads the C++ capnproto wasm module (built via cpp/build.sh from upstream
// capnproto sources statically linked through zig cc) and exposes the same
// serialize/deserialize tape interface as our hand-written version.
//
// The tape byte format is shared with src/tape.zig and js/tape.mjs; the C++
// wrapper at cpp/wrapper.cpp implements the same encoding rules using the
// real capnproto MessageBuilder / MessageReader.

import { TapeWriter, TapeReader } from "./tape.mjs";
import { buildWasiImports } from "./cpp_wasi_shim.mjs";

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
    let bytes;
    if (wasmSource instanceof Uint8Array) bytes = wasmSource;
    else if (wasmSource instanceof ArrayBuffer) bytes = new Uint8Array(wasmSource);
    else bytes = new Uint8Array(await (await fetch(wasmSource)).arrayBuffer());

    const wasi = buildWasiImports();
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: wasi.imports,
    });
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

  /** Encode a capnweb-shape message via the real C++ capnproto runtime. */
  serialize(value) {
    const u8 = this.#u8();
    const tapeArea = u8.subarray(this.#inPtr, this.#inPtr + this.#cap);
    const tw = new TapeWriter(tapeArea);
    tw.writeMessage(value);
    const len = this.#exports.cpp_serialize_tape(tw.pos);
    if (!len) throw new Error("cpp_serialize_tape failed");
    return this.#u8().slice(this.#outPtr, this.#outPtr + len);
  }

  /** Decode Cap'n Proto framed bytes via the C++ runtime. */
  deserialize(bytes) {
    if (bytes.length > this.#cap) throw new Error("input larger than scratch buffer");
    this.#u8().set(bytes, this.#inPtr);
    const tapeLen = this.#exports.cpp_deserialize_to_tape(bytes.length);
    if (!tapeLen) throw new Error("cpp_deserialize_to_tape failed");
    const tape = this.#u8().subarray(this.#outPtr, this.#outPtr + tapeLen);
    return new TapeReader(tape).readMessage();
  }
}
