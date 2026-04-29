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
import { GcDecoder } from "./gc_decode.mjs";

const SHARED_DECODER = new TextDecoder();

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

  /**
   * Load capnwasm. Optionally pass a second source for the experimental
   * WasmGC decode module (built from wat/gc_decode.wat).
   */
  static async load(wasmSource, gcWasmSource) {
    async function loadBytes(src) {
      if (src instanceof Uint8Array) return src;
      if (src instanceof ArrayBuffer) return new Uint8Array(src);
      if (typeof src === "string" || src instanceof URL) {
        return new Uint8Array(await (await fetch(src)).arrayBuffer());
      }
      throw new TypeError("Expected Uint8Array, ArrayBuffer, URL, or string");
    }
    const bytes = await loadBytes(wasmSource);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const inst = new CapnWasm(instance);
    inst.#sessionHandle = inst.#exports.cw_session_create();
    if (!inst.#sessionHandle) throw new Error("cw_session_create failed");
    if (gcWasmSource) {
      try {
        inst.#gcDecoder = await GcDecoder.load(await loadBytes(gcWasmSource), inst.#memory);
      } catch (err) {
        console.warn("capnwasm: WasmGC decode module failed to load, falling back:", err);
      }
    }
    return inst;
  }

  /** @type {GcDecoder | null} */
  #gcDecoder = null;

  constructor(instance) {
    this.#instance = instance;
    this.#exports = instance.exports;
    this.#memory = instance.exports.memory;
    if (this.#exports.cw_abi_version() !== 5) {
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
    return this.serialize(["push", text]);
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

  /** Lightweight tag-only decode using the tape path. */
  decodeMessage(bytes) {
    return this.deserializeViaTape(bytes);
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

  /**
   * Decode Cap'n Proto bytes into a capnweb-shape message value.
   *
   * Two paths are available:
   *   - JSON: wasm emits a JSON string, JS calls JSON.parse. Best for
   *     object/array-heavy payloads (V8's native parser beats hand-rolled
   *     tree construction).
   *   - Tape: wasm emits a tape, JS walks it. Best for binary-heavy payloads
   *     (uses native Uint8Array.toBase64 for fast base64 encoding).
   *
   * The default switches between them based on a wasm-side probe.
   */
  deserialize(bytes) {
    const u8 = this.#u8();
    if (bytes.length > this.#inCap) throw new Error("input larger than scratch buffer");
    u8.set(bytes, this.#inPtr);
    // Probe: if the message contains a Data expression of >= 1024 bytes, the
    // tape path with native Uint8Array.toBase64 will be faster than wasm's
    // scalar base64 emit.
    const hasBinary = bytes.length > 1024 && this.#exports.cw_has_large_data(bytes.length, 1024) === 1;
    if (hasBinary) {
      const tapeLen = this.#exports.cw_decode_to_tape(bytes.length);
      if (!tapeLen) throw new Error("cw_decode_to_tape failed");
      const tape = this.#u8().subarray(this.#outPtr, this.#outPtr + tapeLen);
      return new TapeReader(tape).readMessage();
    }
    const jsonLen = this.#exports.cw_decode_to_json(bytes.length);
    if (!jsonLen) throw new Error("cw_decode_to_json failed");
    const buf = this.#u8().subarray(this.#outPtr, this.#outPtr + jsonLen);
    return JSON.parse(SHARED_DECODER.decode(buf));
  }

  /** Force the JSON-emit path (testing/benchmark only). */
  deserializeViaJson(bytes) {
    const u8 = this.#u8();
    if (bytes.length > this.#inCap) throw new Error("input larger than scratch buffer");
    u8.set(bytes, this.#inPtr);
    const jsonLen = this.#exports.cw_decode_to_json(bytes.length);
    if (!jsonLen) throw new Error("cw_decode_to_json failed");
    const buf = this.#u8().subarray(this.#outPtr, this.#outPtr + jsonLen);
    return JSON.parse(SHARED_DECODER.decode(buf));
  }

  /** Force the tape path (testing/benchmark only). */
  deserializeViaTape(bytes) {
    const u8 = this.#u8();
    if (bytes.length > this.#inCap) throw new Error("input larger than scratch buffer");
    u8.set(bytes, this.#inPtr);
    const tapeLen = this.#exports.cw_decode_to_tape(bytes.length);
    if (!tapeLen) throw new Error("cw_decode_to_tape failed");
    const tape = this.#u8().subarray(this.#outPtr, this.#outPtr + tapeLen);
    return new TapeReader(tape).readMessage();
  }

  /** Force the WasmGC path (testing/benchmark only). Requires loading with gcWasmSource. */
  deserializeViaGc(bytes) {
    if (!this.#gcDecoder) throw new Error("WasmGC module not loaded");
    if (bytes.length > this.#inCap) throw new Error("input larger than scratch buffer");
    this.#u8().set(bytes, this.#inPtr);
    const tapeLen = this.#exports.cw_decode_to_tape(bytes.length);
    if (!tapeLen) throw new Error("cw_decode_to_tape failed");
    return this.#gcDecoder.decodeTape(this.#outPtr, tapeLen);
  }

  hasGc() { return this.#gcDecoder !== null; }

  /**
   * Open `bytes` for lazy field access. Returns a LazyReader; calls on it pull
   * individual fields from the wasm-side parsed message without materializing
   * the full JS value tree.
   *
   * Honesty note: the work-saved-vs-eager-decode is only realized if the
   * caller accesses few fields. For full materialization use `deserialize`.
   */
  openLazy(bytes) {
    if (bytes.length > this.#inCap) throw new Error("input larger than scratch buffer");
    this.#u8().set(bytes, this.#inPtr);
    if (this.#exports.cw_lazy_open(bytes.length) !== 1) {
      throw new Error("cw_lazy_open failed");
    }
    return new LazyReader(this);
  }

  /** @internal */
  get _exports() { return this.#exports; }
  /** @internal */
  get _outPtr() { return this.#outPtr; }
  /** @internal */
  get _u8() { return this.#u8(); }

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

/**
 * Lazy reader: pulls individual fields from a parsed message on demand.
 * Designed for the Cap'n Proto access pattern where only a few fields are
 * read after decode.
 */
export class LazyReader {
  #wasm;
  #encoder = new TextEncoder();

  constructor(wasm) { this.#wasm = wasm; }

  /** Returns the top-level message tag name. */
  msgTag() {
    const t = this.#wasm._exports.cw_lazy_msg_tag();
    if (t < 0) throw new Error("no message loaded");
    return MESSAGE_TAGS[t];
  }

  /**
   * For an object-typed message expression payload, return the text value of
   * the named field. Returns undefined if the field is missing or non-text.
   */
  fieldText(name) {
    const enc = this.#encoder.encode(name);
    const u8 = this.#wasm._u8;
    // Stage the name into wasm input scratch (we own the input region after open).
    const namePtr = this.#wasm._exports.cw_in_ptr() + this.#wasm._exports.cw_in_capacity() - 1024;
    u8.set(enc, namePtr);
    const len = this.#wasm._exports.cw_lazy_msg_obj_field_text(namePtr, enc.length);
    if (len === 0) return undefined;
    const bytes = u8.subarray(this.#wasm._outPtr, this.#wasm._outPtr + len);
    // Inline ASCII fast-path
    let asciiOk = true;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { asciiOk = false; break; }
    if (asciiOk) {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    return new TextDecoder().decode(bytes);
  }

  /** For an object-typed expression, return the int value of the named field. */
  fieldInt(name) {
    const enc = this.#encoder.encode(name);
    const u8 = this.#wasm._u8;
    const namePtr = this.#wasm._exports.cw_in_ptr() + this.#wasm._exports.cw_in_capacity() - 1024;
    u8.set(enc, namePtr);
    const found = this.#wasm._exports.cw_lazy_msg_obj_field_int(namePtr, enc.length);
    if (!found) return undefined;
    const dv = new DataView(u8.buffer, this.#wasm._outPtr, 16);
    const lo = dv.getUint32(0, true);
    const hi = dv.getInt32(4, true);
    return hi * 4294967296 + lo;
  }
}

const MESSAGE_TAGS_NAMES = ["push", "pull", "resolve", "reject", "release", "stream", "abort", "pipe"];
