// capnwasm: minimal JS glue around the Zig core.
//
// Public API (subset of capnweb shape):
//   const session = await CapnWasm.load(wasmUrlOrBytes);
//   session.serialize(value)                    -> Uint8Array (Cap'n Proto)
//   session.deserialize(bytes)                  -> capnweb-shape value
//   session.encodePush(text)                    -> Uint8Array (text-only fast path)
//   session.encodePull(importId)                -> Uint8Array
//   session.encodeRelease(importId, refcount)   -> Uint8Array
//   session.decodeMessage(bytes)                -> { tag, ... } (header-only fast path)

import { TapeWriter, TapeReader } from "./tape.mjs";

const TAG_PUSH = 0;
const TAG_PULL = 1;
const TAG_RESOLVE = 2;
const TAG_REJECT = 3;
const TAG_RELEASE = 4;
const TAG_STREAM = 5;
const TAG_ABORT = 6;
const TAG_PIPE = 7;

const MESSAGE_TAGS = {
  0: "push", 1: "pull", 2: "resolve", 3: "reject",
  4: "release", 5: "stream", 6: "abort", 7: "pipe",
};

export class CapnWasm {
  /** @type {WebAssembly.Instance} */
  #instance;
  /** @type {WebAssembly.Memory} */
  #memory;
  #exports;
  /** @type {number} */
  #sessionHandle;

  static async load(wasmSource) {
    let bytes;
    if (wasmSource instanceof Uint8Array) {
      bytes = wasmSource;
    } else if (typeof wasmSource === "string" || wasmSource instanceof URL) {
      const res = await fetch(wasmSource);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else if (wasmSource instanceof ArrayBuffer) {
      bytes = new Uint8Array(wasmSource);
    } else {
      throw new TypeError("CapnWasm.load: expected Uint8Array, ArrayBuffer, URL, or string");
    }

    const { instance } = await WebAssembly.instantiate(bytes, {});
    const inst = new CapnWasm(instance);
    inst.#sessionHandle = inst.#exports.cw_session_create();
    if (!inst.#sessionHandle) throw new Error("cw_session_create failed");
    return inst;
  }

  constructor(instance) {
    this.#instance = instance;
    this.#exports = instance.exports;
    this.#memory = instance.exports.memory;
    if (this.#exports.cw_abi_version() !== 3) {
      throw new Error("Unsupported capnwasm ABI version");
    }
    this.#inPtr = this.#exports.cw_in_ptr();
    this.#inCap = this.#exports.cw_in_capacity();
    this.#outPtr = this.#exports.cw_out_ptr();
    this.#outCap = this.#exports.cw_out_capacity();
  }

  #inPtr = 0;
  #inCap = 0;
  #outPtr = 0;
  #outCap = 0;

  get exports() { return this.#exports; }
  get memory() { return this.#memory; }

  // ------------------------------------------------------------------------
  // Memory helpers
  // ------------------------------------------------------------------------

  #u8() { return new Uint8Array(this.#memory.buffer); }

  /** Copy a Uint8Array into wasm memory; returns the wasm pointer. */
  #intoWasm(bytes) {
    const ptr = this.#exports.cw_alloc(bytes.length);
    if (!ptr) throw new Error("cw_alloc failed");
    this.#u8().set(bytes, ptr);
    return ptr;
  }

  #freeWasm(ptr, len) {
    this.#exports.cw_free(ptr, len);
  }

  /** Read a (handle -> bytes) pair into JS, then destroy the wasm-side bytes. */
  #takeBytesHandle(handle) {
    if (!handle) throw new Error("operation returned 0 handle");
    const ptr = this.#exports.cw_bytes_ptr(handle);
    const len = this.#exports.cw_bytes_len(handle);
    if (!ptr) throw new Error("cw_bytes_ptr returned null");
    // Copy out before destroy.
    const out = this.#u8().slice(ptr, ptr + len);
    this.#exports.cw_bytes_destroy(handle);
    return out;
  }

  // ------------------------------------------------------------------------
  // Encoders
  // ------------------------------------------------------------------------

  encodePush(text) {
    const bh = this.#exports.cw_builder_create(16);
    try {
      const enc = new TextEncoder().encode(text);
      const tp = this.#intoWasm(enc);
      try {
        const rc = this.#exports.cw_build_push_text(bh, tp, enc.length);
        if (rc !== 0) throw new Error("cw_build_push_text failed");
      } finally {
        this.#freeWasm(tp, enc.length);
      }
      const bytesHandle = this.#exports.cw_builder_to_bytes(bh);
      return this.#takeBytesHandle(bytesHandle);
    } finally {
      this.#exports.cw_builder_destroy(bh);
    }
  }

  encodePull(importId) {
    const len = this.#exports.cw_encode_pull(BigInt(importId));
    if (!len) throw new Error("cw_encode_pull failed");
    return this.#u8().slice(this.#outPtr, this.#outPtr + len);
  }

  encodeRelease(importId, refcount) {
    const len = this.#exports.cw_encode_release(BigInt(importId), refcount >>> 0);
    if (!len) throw new Error("cw_encode_release failed");
    return this.#u8().slice(this.#outPtr, this.#outPtr + len);
  }

  // ------------------------------------------------------------------------
  // Decoder
  // ------------------------------------------------------------------------

  decodeMessage(bytes) {
    if (bytes.length > this.#inCap) {
      // Large messages still use the handle-table path (not the hot path).
      return this.#decodeMessageHeap(bytes);
    }
    this.#u8().set(bytes, this.#inPtr);
    const tagInt = this.#exports.cw_decode_in(bytes.length);
    if (tagInt < 0) throw new Error("cw_decode_in failed");
    const tag = MESSAGE_TAGS[tagInt];
    let result;
    switch (tag) {
      case "pull":
        result = { tag, importId: Number(this.#exports.cw_get_pull_id()) };
        break;
      case "resolve":
      case "reject":
        result = { tag, exportId: Number(this.#exports.cw_get_resolve_id()) };
        break;
      case "release":
        result = {
          tag,
          importId: Number(this.#exports.cw_get_pull_id()),
          refcount: this.#exports.cw_get_release_refcount(),
        };
        break;
      default:
        result = { tag };
    }
    this.#exports.cw_decode_clear();
    return result;
  }

  #decodeMessageHeap(bytes) {
    const ptr = this.#intoWasm(bytes);
    let parsed = 0;
    try {
      parsed = this.#exports.cw_parse_message(ptr, bytes.length);
      if (!parsed) throw new Error("cw_parse_message failed");
      const tagInt = this.#exports.cw_parsed_message_tag(parsed);
      const tag = MESSAGE_TAGS[tagInt];
      switch (tag) {
        case "pull": return { tag, importId: Number(this.#exports.cw_parsed_pull_id(parsed)) };
        case "resolve":
        case "reject":
          return { tag, exportId: Number(this.#exports.cw_parsed_resolve_id(parsed)) };
        case "release":
          return {
            tag,
            importId: Number(this.#exports.cw_parsed_pull_id(parsed)),
            refcount: this.#exports.cw_parsed_release_refcount(parsed),
          };
        default:
          return { tag };
      }
    } finally {
      if (parsed) this.#exports.cw_parsed_destroy(parsed);
      this.#freeWasm(ptr, bytes.length);
    }
  }

  // ------------------------------------------------------------------------
  // Tape codec (general value-tree encode/decode)
  // ------------------------------------------------------------------------

  /** Encode a capnweb-shape message value into Cap'n Proto bytes. */
  serialize(value) {
    const u8 = this.#u8();
    const tapeArea = u8.subarray(this.#inPtr, this.#inPtr + this.#inCap);
    const tw = new TapeWriter(tapeArea);
    tw.writeMessage(value);
    const len = this.#exports.cw_encode_tape(tw.pos);
    if (!len) throw new Error("cw_encode_tape failed");
    return this.#u8().slice(this.#outPtr, this.#outPtr + len);
  }

  /** Decode Cap'n Proto bytes into a capnweb-shape message value. */
  deserialize(bytes) {
    const u8 = this.#u8();
    if (bytes.length > this.#inCap) throw new Error("input larger than scratch buffer");
    u8.set(bytes, this.#inPtr);
    const tapeLen = this.#exports.cw_decode_to_tape(bytes.length);
    if (!tapeLen) throw new Error("cw_decode_to_tape failed");
    const tape = this.#u8().subarray(this.#outPtr, this.#outPtr + tapeLen);
    return new TapeReader(tape).readMessage();
  }

  // ------------------------------------------------------------------------
  // Packed encoding
  // ------------------------------------------------------------------------

  pack(bytes) {
    const ptr = this.#intoWasm(bytes);
    try {
      const handle = this.#exports.cw_pack(ptr, bytes.length);
      return this.#takeBytesHandle(handle);
    } finally {
      this.#freeWasm(ptr, bytes.length);
    }
  }

  unpack(bytes) {
    const ptr = this.#intoWasm(bytes);
    try {
      const handle = this.#exports.cw_unpack(ptr, bytes.length);
      return this.#takeBytesHandle(handle);
    } finally {
      this.#freeWasm(ptr, bytes.length);
    }
  }

  // ------------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------------

  allocImport() {
    return Number(this.#exports.cw_session_alloc_import(this.#sessionHandle));
  }
  allocExport(target) {
    return Number(this.#exports.cw_session_alloc_export(this.#sessionHandle, BigInt(target)));
  }
  releaseImport(id, refcount) {
    this.#exports.cw_session_release_import(this.#sessionHandle, BigInt(id), refcount);
  }

  destroy() {
    if (this.#sessionHandle) {
      this.#exports.cw_session_destroy(this.#sessionHandle);
      this.#sessionHandle = 0;
    }
  }
}

export const TAGS = { TAG_PUSH, TAG_PULL, TAG_RESOLVE, TAG_REJECT, TAG_RELEASE, TAG_STREAM, TAG_ABORT, TAG_PIPE };
