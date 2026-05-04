// Loads the C++ capnproto wasm module (built via cpp/build.sh from upstream
// capnproto sources statically linked through zig cc).
//
// CapnCpp owns the wasm instance, exposes the scratch pointers/capacities,
// and provides a managed-message allocator (cpp_msg_alloc/free + open_at)
// so safe Readers can survive other decodes on the same instance.

// M1: Single-segment ABI surface.
//
// The capnwasm public reader ABI accepts only single-segment Cap'n Proto
// framed messages. The framed format starts with an 8-byte header:
//   word[0]:
//     bytes 0..3 (LE u32) = segmentCount - 1
//     bytes 4..7 (LE u32) = first segment size in words
//   then segment payload(s).
// Single-segment means the first u32 is 0 and the payload occupies
// exactly (bytes_len - 8) bytes, which must be a positive multiple of 8.
//
// Pure-JS validation is sufficient because the segment-count check only
// touches the first 4 bytes; no wasm round-trip required. Foreign wasm
// modules (Rust, Go) can call the equivalent cpp_msg_validate_single_segment
// export for the same check from their own host.
export class MultiSegmentMessageError extends Error {
  constructor(message = "capnwasm ABI requires single-segment Cap'n Proto messages") {
    super(message);
    this.name = "MultiSegmentMessageError";
  }
}

// M3 slot pool exhaustion is a non-throwing path: _acquireSlot returns
// null when the pool is full and callers fall back to the managed-
// message path. We previously exported a ReaderSlotExhaustedError
// class for users who might want to wrap _acquireSlot directly with
// strict-mode behavior, but no caller ever materialized inside or
// outside this repo. Removed during the M7 dead-code audit; the
// non-throwing fallback is the documented contract.

/**
 * Validate that `bytes` is a single-segment framed Cap'n Proto message.
 * Returns nothing on success; throws MultiSegmentMessageError otherwise.
 *
 * Hot path: this runs on every public reader open (openFoo, openDynamic,
 * RPC params extraction in some flows). The fast path is structured to
 * be branch-light and allocation-free:
 *   - The Cap'n Proto framed header's first u32 is segmentCount-1 (LE).
 *     For the single-segment case it is 0, which means all four header
 *     bytes are zero. We can compare `bytes[0] | bytes[1] | bytes[2] |
 *     bytes[3]` against 0 to detect "is single segment" without going
 *     through DataView. That is two L1 loads + three ORs + a branch,
 *     plus one length-aligned check we already do.
 *   - On the rejection path we do reconstruct the actual count for the
 *     error message; that path is cold so the cost there does not matter.
 *   - We skip the size-mismatch check on the hot path because the only
 *     way bytes can lie about their first-segment word count without
 *     also being multi-segment is if a malicious or corrupt sender
 *     hand-crafted them. That is hostile-input territory (M7) and
 *     downstream pointer reads will already trap. We still validate
 *     length-aligned and minimum size, which are the cheap checks
 *     that catch unaligned/truncated buffers.
 *
 * Foreign wasm modules (Rust, Go) can call cpp_msg_validate_single_segment
 * for the equivalent structural check from their own host.
 */
export function validateSingleSegment(bytes) {
  // Length checks. These are unavoidable and cheap.
  const len = bytes.length;
  if (len < 8 || (len & 7) !== 0) {
    if (!bytes || typeof len !== "number") {
      throw new MultiSegmentMessageError("expected Uint8Array-like input");
    }
    if (len < 8) {
      throw new MultiSegmentMessageError(
        `framed message too small: got ${len} bytes, need at least 8`,
      );
    }
    throw new MultiSegmentMessageError(
      `framed message length must be a multiple of 8, got ${len}`,
    );
  }
  // Segment-count fast path: four u8 loads + ORs, no DataView, no
  // function call into capnwasm internals. Hot loops opening thousands
  // of small messages pay only this.
  if ((bytes[0] | bytes[1] | bytes[2] | bytes[3]) !== 0) {
    // Cold path: reconstruct the count for the error message.
    const segMinusOne =
      (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
    throw new MultiSegmentMessageError(
      `multi-segment message rejected (${segMinusOne + 1} segments); ` +
      `capnwasm ABI requires single-segment messages`,
    );
  }
  // Single-segment confirmed. Now verify the first-segment word count
  // matches the rest of the buffer. Same byte-load shape; one branch.
  // This guards against a hand-crafted header that lies about size,
  // which would let downstream pointer reads address slop bytes past
  // the declared segment but still inside the input length. Cheap
  // enough to keep on the hot path.
  const firstSegWords =
    (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  const payloadWords = (len - 8) >>> 3;
  if (firstSegWords !== payloadWords) {
    throw new MultiSegmentMessageError(
      `framed header declares ${firstSegWords} segment words but ` +
      `payload contains ${payloadWords} words`,
    );
  }
}

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
  #activeSlot = 0;
  // M2: count of currently in-flight arena-backed slot allocations.
  // Incremented on _acquireSlot when arena alloc succeeds, decremented
  // on _releaseSlot. When it returns to zero, no live reader points
  // into the arena and the bump cursor can be reset.
  #arenaInFlight = 0;
  #messageFinalizer = null;
  // M3: Per-CapnCpp reader-slot finalizer. Releases a slot back to the
  // wasm pool when the JS reader holding it becomes unreachable. The
  // held value is the slot handle ({ slotIdx, ptr }); the cleanup
  // callback runs cpp_any_release_slot(slotIdx) + cpp_msg_free(ptr).
  // This is a backstop -- M4 (explicit lifetime) will add reader.dispose()
  // and TC39 `using` so production code does not depend on GC timing.
  #slotFinalizer = null;
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
    cpp.#slotFinalizer = new FinalizationRegistry((holdings) => {
      // GC-time release. The holdings object captures slotIdx + ptr +
      // isArena (set in _acquireSlot). _releaseSlot is idempotent
      // so an explicit dispose() before GC is safe; this path runs
      // only when the JS reader was unreachable without dispose().
      try {
        if (holdings && holdings.slotIdx) {
          cpp.#exports.cpp_any_release_slot?.(holdings.slotIdx);
        }
        if (holdings && holdings.ptr) {
          // M2: arena allocations don't free; the arena waits for
          // _arenaInFlight to drain. The arena counter still ticks
          // down here so a leaked-then-GC'd arena slot doesn't keep
          // the arena pinned forever.
          if (holdings.isArena) {
            cpp.#arenaInFlight--;
            if (cpp.#arenaInFlight <= 0) {
              cpp.#arenaInFlight = 0;
              cpp.#exports.cpp_msg_arena_reset?.();
            }
          } else {
            cpp.#exports.cpp_msg_free?.(holdings.ptr);
          }
        }
      } catch (_) {}
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

  // M3: Native multi-reader slot pool. Returns true when the wasm
  // exports the slot-pool entry points so codegen + dynamic readers
  // can acquire dedicated cursors instead of multiplexing onto a
  // single rebind-on-demand cursor. Older runtimes return false; the
  // generated code falls back to the pre-M3 _allocMessage path.
  _supportsReaderSlotPool() {
    const e = this.#exports;
    return !!(
      e.cpp_any_acquire_slot && e.cpp_any_release_slot &&
      e.cpp_any_use_slot && e.cpp_any_slot_data_ptr
    );
  }

  _allocMessage(bytes) {
    if (!this._supportsManagedMessages()) return null;
    // M1: Single-segment ABI. Validate before reserving wasm memory so a
    // bad input does not consume the allocator's bump pointer / arena.
    validateSingleSegment(bytes);
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

  // M3: Acquire a free reader slot, copy `bytes` in (validated as
  // single-segment), and return { slotIdx, dataPtr, handle }. The slot
  // is dedicated to this reader for its lifetime. JS readers register
  // themselves with the slot finalizer so the slot is released when
  // the reader becomes unreachable.
  //
  // Returns `null` on pool exhaustion so callers can fall back to the
  // managed-message + rebind path (still safe, just slower). Pool
  // exhaustion is an unusual condition in production code -- 32
  // simultaneously live readers is a lot -- but keeping the call
  // total/non-throwing means a runaway test or a leak doesn't blow up
  // the whole CapnCpp instance.
  _acquireSlot(bytes) {
    if (!this._supportsReaderSlotPool()) {
      throw new Error("cpp_any_acquire_slot not exported; rebuild capnwasm wasm runtime");
    }
    validateSingleSegment(bytes);
    // M2: Allocate slot message bytes from the bump arena when the
    // wasm runtime exposes it; otherwise (older wasm or block too big)
    // fall back to malloc. Arena allocations are O(1) (just a cursor
    // bump) and free is a no-op; the arena is reset when the JS-tracked
    // count of in-flight arena slots returns to 0. malloc-backed
    // allocations work as before via _releaseSlot's cpp_msg_free path.
    let ptr = 0;
    let isArena = false;
    if (this.#exports.cpp_msg_arena_alloc) {
      ptr = this.#exports.cpp_msg_arena_alloc(bytes.length) >>> 0;
      if (ptr) isArena = true;
    }
    if (!ptr) {
      ptr = this.#exports.cpp_msg_alloc(bytes.length) >>> 0;
      if (!ptr) throw new Error("cpp_msg_alloc failed");
    }
    this.#u8().set(bytes, ptr);
    const slotIdx = this.#exports.cpp_any_acquire_slot(ptr, bytes.length) >>> 0;
    if (slotIdx === 0xFFFFFFFF) {
      // Acquire failed; reclaim the bytes we just allocated. Arena
      // allocations cannot be reclaimed individually (bump-only), so
      // they leak into the arena until the next reset. malloc
      // allocations free immediately.
      if (!isArena) this.#exports.cpp_msg_free?.(ptr);
      return null;
    }
    // The slot now owns the message bytes. Switch the wasm's active
    // slot to this one so the caller's first reads don't need an
    // explicit cpp_any_use_slot. data_ptr reads from the slot's
    // persistent store; safe to call without use_slot first.
    const dataPtr = this.#exports.cpp_any_slot_data_ptr(slotIdx) >>> 0;
    // Go through _useSlot so the JS-tracked #activeSlot stays in sync
    // with the wasm's active_slot_idx.
    this._useSlot(slotIdx);
    this._bumpGeneration();
    // M2: track in-flight arena slots so we know when it's safe to
    // reset the arena cursor.
    if (isArena) this.#arenaInFlight++;
    // FinalizationRegistry forbids target === holdings. Use a separate
    // holdings object that captures slotIdx + ptr so the cleanup
    // callback can release both. The handle stays the registered
    // target so explicit dispose() can unregister. The handle records
    // isArena so _releaseSlot knows whether to free or no-op.
    const handle = { slotIdx, ptr, isArena };
    const holdings = { slotIdx, ptr, isArena };
    this.#slotFinalizer?.register(handle, holdings, handle);
    // M5: Bounds for the pure-JS pointer decoder. The framed message
    // header is 8 bytes (M1 single-segment), payload starts at ptr+8.
    // msgEnd is the byte immediately past the last word of the
    // message. Decoder bounds-checks every pointer target against
    // [msgStart, msgEnd).
    const msgStart = ptr + 8;
    const msgEnd = ptr + bytes.length;
    return { slotIdx, dataPtr, handle, msgStart, msgEnd };
  }

  // M3: Release a slot back to the wasm pool. Idempotent. After
  // release, the slot's reader storage is destroyed and any cached
  // dataPtr from this reader becomes invalid. Called by the
  // FinalizationRegistry when the JS reader is GC'd, or explicitly via
  // reader.dispose() (M4).
  _releaseSlot(handle) {
    if (!handle || handle.slotIdx === 0) return;
    this.#slotFinalizer?.unregister(handle);
    if (this._supportsReaderSlotPool()) {
      this.#exports.cpp_any_release_slot(handle.slotIdx);
      // Wasm-side cpp_any_release_slot resets active_slot_idx to 0
      // when the released slot was active. Mirror that in JS so
      // _useSlot does not short-circuit a future switch under the
      // false belief that the active slot is still the released one.
      if (this.#activeSlot === handle.slotIdx) {
        this.#activeSlot = 0;
      }
    }
    if (handle.ptr) {
      // M2: arena allocations don't go through cpp_msg_free; they sit
      // in the arena until the cursor is reset. Track in-flight count
      // so we can reset when no live readers remain.
      if (handle.isArena) {
        this.#arenaInFlight--;
        if (this.#arenaInFlight <= 0) {
          this.#arenaInFlight = 0;
          this.#exports.cpp_msg_arena_reset?.();
        }
      } else {
        this.#exports.cpp_msg_free?.(handle.ptr);
      }
      handle.ptr = 0;
    }
    handle.slotIdx = 0;
  }

  // M3: Switch the wasm's active reader slot. JS readers call this once
  // before a series of getter calls; subsequent reads on the same
  // reader skip the call. We track the active slot in JS too so
  // _ensureCapnwasmReader can short-circuit when the requested slot is
  // already active, without paying a wasm boundary call to flip it.
  _useSlot(slotIdx) {
    if (this.#activeSlot === slotIdx) return;
    if (this._supportsReaderSlotPool()) {
      this.#exports.cpp_any_use_slot(slotIdx);
    }
    this.#activeSlot = slotIdx;
  }

  get _activeSlot() { return this.#activeSlot; }

  get _exports() { return this.#exports; }
  get _inPtr()   { return this.#inPtr; }
  get _outPtr()  { return this.#outPtr; }
  get _cap()     { return this.#cap; }
  get _auxPtr()  { return this.#auxPtr; }
  get _auxCap()  { return this.#auxCap; }
  get _u8()      { return this.#u8(); }

  // M1: Single-segment ABI surface. Exposed as an instance method so
  // codegen + dynamic readers can call `cpp._validateSingleSegment(bytes)`
  // without importing the helper directly. Throws MultiSegmentMessageError
  // on rejection.
  _validateSingleSegment(bytes) { validateSingleSegment(bytes); }
}

function zero() { return 0; }
