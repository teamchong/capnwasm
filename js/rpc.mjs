// Cap'n Proto RPC layer in JS, speaking the binary `rpc.capnp` wire via the
// cpp_rpc_* exports of capnp_cpp.wasm. The JS side owns the question/answer
// tables and the Proxy facade; the wasm side owns the bytes-on-wire.
//
// Why JS and not C++: kj::async needs epoll/kqueue/threads, none of which
// wasi-libc exposes. The RPC state machine is small enough to maintain in
// JS; what matters is that the bytes travelling between peers are exactly
// the same bytes any other Cap'n Proto implementation produces.
//
// Wire kind codes (mirrors enum in cpp/wrapper.cpp):
//   1 = bootstrap, 2 = call, 3 = return, 4 = finish, 5 = resolve,
//   6 = release, 7 = disembargo, 8 = abort, 0 = unknown.

const KIND_BOOTSTRAP  = 1;
const KIND_CALL       = 2;
const KIND_RETURN     = 3;
const KIND_FINISH     = 4;
const KIND_RELEASE    = 6;

// Stream extension frame markers. Not part of standard rpc.capnp; we
// detect them by checking byte 0 of the payload BEFORE handing to the
// capnp decoder. A standard capnp framed message starts with the
// segment-count-minus-1 (small integer, ≤ a handful in any realistic
// message), so 0xFE/0xFF can never occur there.
//
//   STREAM_CHUNK payload: 0xFF | u32 questionId | u32 chunkLen | chunkLen bytes
//   STREAM_END   payload: 0xFE | u32 questionId | u32 errLen | errLen bytes (UTF-8)
//                         errLen=0 means clean end; >0 means error reason
//
// Why a wire extension and not a Cap'n Proto Resolve / Return chain:
// rpc.capnp's Return is one-shot; streaming would require either
// per-chunk Calls (round-trip per chunk) or capability-passing of a
// stream cap (more state to track). The custom frame is the smallest
// delta that gives us true server-push streaming with one round-trip.
const STREAM_CHUNK_BYTE = 0xFF;
const STREAM_END_BYTE   = 0xFE;

// MessageTarget union discriminant (matches cpp_rpc_get_call_target_kind):
//   0 = importedCap, 1 = promisedAnswer.
const TARGET_IMPORTED_CAP    = 0;
const TARGET_PROMISED_ANSWER = 1;

// Return kind discriminant (matches cpp_rpc_get_return_kind):
//   0 = results, 1 = exception, 2 = canceled, 3 = other.
const RET_RESULTS   = 0;
const RET_EXCEPTION = 1;
const RET_CANCELED  = 2;

// Frame format on the transport: 4-byte little-endian length prefix,
// then that many bytes of Cap'n Proto framed message. Lets us pull one
// message at a time off a stream without re-parsing partial reads.
//
// On the send side we don't allocate a JS Uint8Array for framing — the
// C++ wrappers write the prefix + payload into cpp_out and we hand the
// transport a subarray view into wasm memory. The transport (or its
// underlying WebSocket) is responsible for copying if it needs to retain.

class FrameReader {
  #chunks = [];
  #total = 0;
  push(bytes) {
    this.#chunks.push(bytes);
    this.#total += bytes.length;
  }
  next() {
    if (this.#total < 4) return null;
    const buf = this.#flatten();
    // Read u32 LE inline — saves a DataView allocation per next() call,
    // which fires on every inbound frame (8% of CPU in tight RPC loops).
    const len = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
    const end = 4 + len;
    if (buf.length < end) {
      this.#chunks = [buf];
      this.#total = buf.length;
      return null;
    }
    const payload = buf.subarray(4, end);
    // Skip the rest subarray when the buffer ends here — the common case.
    if (buf.length === end) {
      this.#chunks.length = 0;
      this.#total = 0;
    } else {
      const rest = buf.subarray(end);
      this.#chunks = [rest];
      this.#total = rest.length;
    }
    return payload;
  }
  #flatten() {
    if (this.#chunks.length === 1) return this.#chunks[0];
    const out = new Uint8Array(this.#total);
    let p = 0;
    for (const c of this.#chunks) { out.set(c, p); p += c.length; }
    return out;
  }
}

// Deferred is a tiny promise + resolver pair so we can park awaiters on a
// question id and resolve them when the matching Return arrives.
// Promise.withResolvers (ES2024) skips the executor closure that the
// classic { let r; new Promise((res) => r = res); } pattern needs. One
// fewer allocation per Call. Falls back where unavailable.
const deferred = typeof Promise.withResolvers === "function"
  ? () => Promise.withResolvers()
  : () => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };

/**
 * RpcSession drives one peer of an RPC connection. Both sides instantiate one,
 * connected through a Transport (an in-memory pair for tests, a WebSocket in
 * the browser). The session multiplexes Bootstrap/Call/Return/Finish over a
 * single ordered byte stream and exposes capabilities through RpcCap handles.
 */
export class RpcSession {
  #cpp;
  #transport;
  #registry;
  #frames = new FrameReader();
  // Outgoing questions: map questionId -> { deferred, resultsBytes? }
  #questions = new Map();
  // Incoming answers (calls we are servicing): map answerId -> { params, resolved? }
  #answers = new Map();
  // Local capability table: id -> { target } where target is a JS object whose
  // methods will be invoked on inbound calls.
  #localCaps = new Map();
  // Imported (peer) capabilities: id -> handle. Bootstrap reserves id 0.
  #imports = new Map();
  #nextQuestionId = 0;
  #nextLocalCapId = 0;
  #closed = false;
  #localBootstrap = null;
  // FinalizationRegistry tracks GC of imported RpcCap handles. When a cap
  // becomes unreachable in JS, send Release(importId) so the peer can drop
  // the corresponding export entry. Critical for long-running sessions —
  // without this, every cap-passing Call would leak peer-side state.
  #importRefs;
  // Cached reference to the wasm exports object. V8 inlines call sites
  // more aggressively when the access chain is short and monomorphic —
  // `this.#exp.fn()` is a single hidden-class lookup vs the original
  // `this.#cpp._exports.fn()` which walks two property chains per call.
  #exp;
  // The wasm scratch buffer offsets are constants (set once at C++ init)
  // — call them once at construction and cache. Saves a wasm-boundary
  // call per send (cpp_in_ptr/cpp_in_capacity/cpp_out_ptr were being
  // looked up on every #stageIn / #sendFromOut / #snapshotOut).
  #inPtr  = 0;
  #outPtr = 0;
  #inCap  = 0;
  // Memory view (reuses the underlying buffer). Caching avoids the per-
  // call `new Uint8Array(this.#cpp._u8)` allocation. Invalidated only if
  // the buffer reference changes (memory.grow), but in practice our
  // wasm allocates its scratch space at init and never grows.
  #u8;
  #buffer;
  // RpcSession always microtask-batches outbound sends. The cost is
  // ≤ one microtask of first-byte latency (~1µs, invisible behind any
  // network); the win is N→1 transport.send calls when the user makes
  // multiple calls in the same tick. There is no "no-batch mode" — the
  // tradeoff is one-sided.
  #sendQueue = null;
  #sendQueueBytes = 0;
  #flushScheduled = false;
  #flushBound;
  // Outbound streaming-call state: questionId -> { pushChunk, end, next }.
  // Populated by callStream; drained by #handleStreamChunk / End.
  #streamQuestions = new Map();

  /**
   * @param {object} cpp - loaded CapnCpp instance (from `await load()`)
   * @param {object} transport - { send(bytes), onMessage(cb), close() }
   * @param {InterfaceRegistry} [registry] - typed wrappers for known interfaces
   * @param {object} [options]
   * @param {object} [options.bootstrap] - object exposed when peer requests Bootstrap
   *
   * Multiple sends made in the same tick are always coalesced into one
   * transport.send at the next microtask boundary — there is no
   * "no-batch" mode because the latency cost is invisible. If you need
   * to force a send before the microtask boundary, call session.flush().
   */
  constructor(cpp, transport, registry, options = {}) {
    this.#cpp = cpp;
    this.#exp = cpp._exports;        // shorthand the hot paths use
    // Cache wasm-side constants once. Each cpp_*_ptr/_capacity export is
    // a getter for a fixed C++ global; calling them per-message is wasted
    // boundary crossings.
    this.#inPtr  = cpp._inPtr;
    this.#outPtr = cpp._outPtr;
    this.#inCap  = cpp._cap;
    this.#buffer = cpp.memory.buffer;
    this.#u8     = new Uint8Array(this.#buffer);
    this.#transport = transport;
    this.#registry = registry || new InterfaceRegistry();
    if (options.bootstrap) this.#localBootstrap = options.bootstrap;
    // FinalizationRegistry callback runs (sometime) after the RpcCap is GC'd.
    // We don't get strong timing guarantees, but for cap accounting that's
    // exactly the right semantic: release when nobody is using it anymore.
    this.#importRefs = new FinalizationRegistry((importId) => {
      this.#sendRelease(importId, 1);
    });
    this.#flushBound = () => this.#flush();
    transport.onMessage((bytes) => this.#onBytes(bytes));
  }

  // Returns a Uint8Array over wasm memory. Re-fetches the view if memory
  // has grown (rare; only happens if the wasm calls memory.grow). The
  // buffer-identity check is cheap — it's just a reference compare.
  #mem() {
    const buf = this.#cpp.memory.buffer;
    if (buf !== this.#buffer) {
      this.#buffer = buf;
      this.#u8 = new Uint8Array(buf);
    }
    return this.#u8;
  }

  /** The wasm instance this session uses. Exposed for openPrimitives etc. */
  get cpp() { return this.#cpp; }

  /**
   * Request the peer's bootstrap capability. Returns an RpcCap handle that
   * can issue method calls; the underlying question id stays open until the
   * handle is released.
   */
  bootstrap() {
    const questionId = this.#allocQuestionId();
    const len = this.#exp.cpp_rpc_build_bootstrap(questionId);
    if (!len) throw new Error("cpp_rpc_build_bootstrap failed");
    // The bootstrap cap is addressable as importedCap(0) once the Return
    // arrives. Construct it now (so callers can pipeline immediately) and
    // stash a reference on the question so #handleReturn can register it
    // with the FinalizationRegistry for auto-release.
    const bootstrapCap = new RpcCap(this, { kind: "import", id: 0 }, this.#registry);
    this.#questions.set(questionId, {
      deferred: deferred(), kind: "bootstrap", bootstrapCap,
    });
    this.#sendFromOut(len);
    return bootstrapCap;
  }

  /**
   * Issue a Call. Returns a Promise that resolves with the raw results bytes
   * (a Cap'n Proto framed message holding an AnyPointer struct). Generated
   * typed wrappers turn that into the application-level result type.
   *
   * `target` is `{ kind: "import"|"promise", id: number }`.
   * `paramsBytes` is the framed Cap'n Proto bytes of the params struct.
   */
  call(target, interfaceId, methodId, paramsBytes) {
    if (this.#closed) throw new Error("RpcSession closed");
    const questionId = this.#allocQuestionId();
    const targetKind = target.kind === "promise" ? TARGET_PROMISED_ANSWER : TARGET_IMPORTED_CAP;
    this.#stageIn(paramsBytes);
    const len = this.#exp.cpp_rpc_build_call(
      questionId,
      targetKind,
      BigInt(target.id),
      BigInt(interfaceId),
      methodId,
      paramsBytes.length,
    );
    if (!len) throw new Error("cpp_rpc_build_call failed");
    const d = deferred();
    this.#questions.set(questionId, { deferred: d, kind: "call" });
    this.#sendFromOut(len);
    // The pipeline cap lets the caller chain follow-up calls onto this
    // answer before it returns — those Calls go on the wire immediately,
    // with target=promisedAnswer(questionId). The peer holds them until
    // it resolves the original answer locally.
    const pipelineCap = new RpcCap(this, { kind: "promise", id: questionId }, this.#registry);
    return { questionId, promise: d.promise, cap: pipelineCap };
  }

  /**
   * Zero-copy Call: instead of pre-building params bytes and copying them
   * into the RPC message, this points the wasm-side any_builder at the
   * Call.params.content slot directly. The application's Builder writes
   * straight into the rpc_builder's arena — no intermediate buffer.
   *
   * Returns `{ params, send }`. The caller fills `params` (a Builder
   * instance), then invokes `send()` to finalize and dispatch. `send()`
   * returns the same `{ questionId, promise, cap }` as `call()`.
   */
  callBuilder(target, interfaceId, methodId, BuilderClass) {
    if (this.#closed) throw new Error("RpcSession closed");
    if (typeof BuilderClass?._DATA_WORDS !== "number") {
      throw new Error("BuilderClass must expose static _DATA_WORDS / _PTR_WORDS");
    }
    const questionId = this.#allocQuestionId();
    const targetKind = target.kind === "promise" ? TARGET_PROMISED_ANSWER : TARGET_IMPORTED_CAP;
    const ok = this.#exp.cpp_rpc_begin_call(
      questionId, targetKind, BigInt(target.id), BigInt(interfaceId), methodId,
      BuilderClass._DATA_WORDS, BuilderClass._PTR_WORDS,
    );
    if (!ok) throw new Error("cpp_rpc_begin_call failed");
    const params = new BuilderClass(this.#cpp, { preinitialized: true });
    // send() optionally takes { resultsReader, extract } to read the Return
    // synchronously inside #handleReturn (while rpc_reader still holds the
    // inbound bytes). The promise then resolves to whatever extract returns
    // — no intermediate result-bytes Uint8Array. Without these, the promise
    // resolves to { bytes, caps } as before (caller copies bytes).
    const sendFn = (opts) => {
      // cpp_rpc_finalize writes the 4-byte length prefix + Cap'n Proto bytes
      // straight to cpp_out — no intermediate JS allocation, no frameWrite.
      const framedLen = this.#exp.cpp_rpc_finalize();
      if (!framedLen) throw new Error("cpp_rpc_finalize failed");
      const d = deferred();
      const q = { deferred: d, kind: "call" };
      if (opts && opts.extract) {
        q.resultsReader = opts.resultsReader;
        q.extract = opts.extract;
      }
      this.#questions.set(questionId, q);
      this.#sendFromOut(framedLen);
      // Pipeline cap is lazy: most callers never .cap.call(...). Allocate
      // RpcCap (and its FinalizationRegistry registration on access) only
      // if the caller actually reaches for it. Saves ~150 ns + GC pressure
      // per call on the common no-pipelining path.
      const session = this;
      const reg = this.#registry;
      let pipelineCap = null;
      return {
        questionId,
        promise: d.promise,
        get cap() {
          if (!pipelineCap) {
            pipelineCap = new RpcCap(session, { kind: "promise", id: questionId }, reg);
          }
          return pipelineCap;
        },
      };
    };
    return { params, send: sendFn };
  }

  /** Send Finish to release the peer's hold on a question's resources. */
  finish(questionId) {
    if (this.#closed) return;
    const len = this.#exp.cpp_rpc_build_finish(questionId);
    if (!len) throw new Error("cpp_rpc_build_finish failed");
    this.#sendFromOut(len);
  }

  // Send Release(importId, refcount) so the peer can drop its export entry
  // for this cap. Triggered by FinalizationRegistry when the importing
  // RpcCap is GC'd, or explicitly via close().
  #sendRelease(importId, refcount) {
    if (this.#closed) return;
    if (!this.#imports.has(importId)) return;  // already released or never imported
    this.#imports.delete(importId);
    const len = this.#exp.cpp_rpc_build_release(importId, refcount);
    if (!len) return;  // best-effort; nothing to do if build fails
    try { this.#sendFromOut(len); } catch { /* transport closed mid-release */ }
  }

  // Track an imported cap for auto-release. The RpcCap holds the reference;
  // when it's GC'd, the registry callback fires with the importId.
  #trackImport(rpcCap, importId) {
    this.#imports.set(importId, true);
    this.#importRefs.register(rpcCap, importId);
  }

  close() {
    if (this.#closed) return;
    // Drain queued sends before tearing down — otherwise a call right
    // before close() could be dropped.
    this.#flush();
    this.#closed = true;
    for (const q of this.#questions.values()) q.deferred.reject(new Error("session closed"));
    this.#questions.clear();
    this.#transport.close?.();
  }

  // ---- Internal: message dispatch -----------------------------------------

  #onBytes(bytes) {
    this.#frames.push(bytes);
    let payload;
    while ((payload = this.#frames.next()) !== null) {
      this.#dispatch(payload);
    }
  }

  #dispatch(payload) {
    // Stream extension frames hijack byte 0 of the payload — see
    // STREAM_CHUNK_BYTE / STREAM_END_BYTE definitions at top of file.
    if (payload.length > 0 && payload[0] === STREAM_CHUNK_BYTE) {
      this.#handleStreamChunk(payload);
      return;
    }
    if (payload.length > 0 && payload[0] === STREAM_END_BYTE) {
      this.#handleStreamEnd(payload);
      return;
    }
    this.#stageIn(payload);
    const kind = this.#exp.cpp_rpc_decode(payload.length);
    switch (kind) {
      case KIND_BOOTSTRAP: this.#handleBootstrap(); break;
      case KIND_CALL:      this.#handleCall(); break;
      case KIND_RETURN:    this.#handleReturn(); break;
      case KIND_FINISH:    this.#handleFinish(); break;
      case KIND_RELEASE:   this.#handleRelease(); break;
      default:
        // Resolve/Disembargo/Abort: not yet wired. Ignored so unknown
        // peers don't crash the loop. Wire them up as the RPC layer grows.
        break;
    }
  }

  #handleBootstrap() {
    const questionId = this.#exp.cpp_rpc_get_bootstrap_question_id();
    // Register the local bootstrap as an export under local cap id 0, then
    // send Return with empty results. The current minimal wire skips
    // CapDescriptor encoding; instead, the peer addresses the bootstrap as
    // importedCap(0) on subsequent calls.
    if (!this.#localBootstrap) {
      this.#sendException(questionId, "no bootstrap capability registered");
      return;
    }
    if (!this.#localCaps.has(0)) {
      this.#localCaps.set(0, { target: this.#localBootstrap, refcount: 1 });
      if (this.#nextLocalCapId === 0) this.#nextLocalCapId = 1;
    }
    // Empty results body — a single null pointer message. The peer's handle
    // just needs the answer to arrive; the cap is addressed by import id 0.
    const empty = emptyAnyPointerMessage();
    this.#stageIn(empty);
    const len = this.#exp.cpp_rpc_build_return(questionId, 0, empty.length);
    if (!len) throw new Error("cpp_rpc_build_return (bootstrap) failed");
    this.#sendFromOut(len);
  }

  async #handleCall() {
    // One wasm call returns all the per-Call accessors we need (saves
    // 4 boundary crossings vs the per-field accessors). Layout matches
    // cpp_rpc_get_call_summary in cpp/wrapper.cpp.
    if (this.#exp.cpp_rpc_get_call_summary() !== 1) {
      // Shouldn't happen — we only land here for KIND_CALL — but be defensive.
      return;
    }
    const u8  = this.#mem();
    const out = this.#outPtr;
    const dv  = new DataView(u8.buffer, out, 28);
    const answerId    = dv.getUint32(0,  true);
    const targetKind  = dv.getUint32(4,  true);
    // targetId fits in u32 in practice (questionId / importId both u32);
    // u64 in the wire is for forward-compat. Use Number — match the map
    // key type used by #localCaps and #answers.
    const targetId    = Number(dv.getBigUint64(8,  true));
    const interfaceId = dv.getBigUint64(16, true);  // stays BigInt — InterfaceId is genuinely u64
    const methodId    = dv.getUint16(24, true);
    // Note: we do NOT materialize paramsBytes up front anymore. The handler
    // chooses whether to copy (ctx.paramsBytes()) or to read directly out
    // of rpc_reader (ctx.openParams). Either way, the read must happen
    // before the handler awaits anything that yields.

    // Reserve the answer slot up front so any later Calls that pipeline off
    // this question can find it (and potentially wait on it).
    const stash = this.#getOrCreateAnswer(answerId);

    let cap;
    if (targetKind === TARGET_IMPORTED_CAP) {
      cap = this.#localCaps.get(targetId);
    } else {
      // promisedAnswer: peer is piping off question `targetId`. If that
      // answer is still in flight, wait for its handler to set .resolved
      // before dispatching this call. This is what makes pipelining feel
      // like a single round-trip from the caller's perspective: the second
      // call arrives during the first's handler, queues up, and runs the
      // moment the first one finishes. If the target answer fails, this
      // pipelined call inherits its exception.
      const targetAnswer = this.#getOrCreateAnswer(targetId);
      if (!targetAnswer.resolved) {
        try { await targetAnswer.readyPromise; }
        catch (err) {
          this.#sendException(answerId, `pipeline target failed: ${err?.message ?? err}`);
          return;
        }
      }
      cap = targetAnswer.resolved;
    }
    if (!cap) {
      this.#sendException(answerId, `no capability at target ${targetId}`);
      return;
    }

    const idU64 = u64(interfaceId);
    // Stream methods: the handler is an async generator, and we ship each
    // yielded chunk as a STREAM_CHUNK frame, then a STREAM_END. No regular
    // Return frame is emitted; the client's stream iterator drives off the
    // chunks alone.
    const streamHandler = this.#registry.dispatchStream(cap.target, idU64, methodId);
    if (streamHandler) {
      this.#runStreamHandler(answerId, streamHandler, cap);
      return;
    }
    const handler = this.#registry.dispatch(cap.target, idU64, methodId);
    if (!handler) {
      this.#sendException(answerId, `unknown method 0x${idU64.toString(16)}:${methodId}`);
      return;
    }
    // Build a context the handler can opt into for zero-copy receive +
    // zero-copy build. ctx.openParams reads directly from rpc_reader;
    // ctx.beginResults writes directly into rpc_builder. The handler must
    // call openParams synchronously (before any await) — once it yields,
    // the next inbound message can overwrite rpc_reader.
    let beginResultsUsed = false;
    const ctx = {
      cpp: this.#cpp,
      paramsBytes: () => {
        const len = this.#exp.cpp_rpc_get_call_params();
        return this.#snapshotOut(len);
      },
      openParams: (ReaderClass) => {
        if (this.#exp.cpp_rpc_open_call_params() !== 1) {
          throw new Error("cpp_rpc_open_call_params failed");
        }
        return new ReaderClass(this.#cpp);
      },
      beginResults: (BuilderClass) => {
        if (typeof BuilderClass?._DATA_WORDS !== "number") {
          throw new Error("BuilderClass must expose static _DATA_WORDS / _PTR_WORDS");
        }
        const ok = this.#exp.cpp_rpc_begin_return(
          answerId, BuilderClass._DATA_WORDS, BuilderClass._PTR_WORDS,
        );
        if (!ok) throw new Error("cpp_rpc_begin_return failed");
        beginResultsUsed = true;
        return new BuilderClass(this.#cpp, { preinitialized: true });
      },
    };
    // Synchronous-handler fast path: if the handler returns a non-thenable,
    // we don't await — saves a microtask per inbound call. For async
    // handlers we await the promise as before.
    let handlerResult;
    try {
      const r = handler(ctx);
      if (r && typeof r.then === "function") handlerResult = await r;
      else handlerResult = r;
    } catch (err) {
      this.#sendException(answerId, String(err?.message ?? err));
      return;
    }
    // Handlers can satisfy a Call in one of four ways:
    //   1. ctx.beginResults(Builder) was used — results are already built
    //      in the rpc_builder's arena; just finalize and send.
    //   2. Returned Uint8Array — raw results bytes (legacy / generic path).
    //   3. Returned { caps: [target, ...] } — capabilities to export back.
    //   4. Returned null/undefined — empty reply.
    let resultsBytes = null;
    let capTargets = null;
    if (handlerResult instanceof Uint8Array) {
      resultsBytes = handlerResult;
    } else if (handlerResult && Array.isArray(handlerResult.caps)) {
      capTargets = handlerResult.caps;
    }
    // For pipelined calls (target = promisedAnswer), Cap'n Proto's
    // semantics treat the answer itself as a capability when no transform
    // path is given. Concretely: if this handler returned a single cap
    // (the {caps:[c]} form), pipelined calls dispatch against THAT cap.
    // Otherwise we keep the parent cap (degenerate "self-pipeline" case).
    const pipelineTarget = (capTargets && capTargets.length === 1)
      ? capTargets[0]
      : cap.target;
    stash.resolved = { target: pipelineTarget };
    stash.readyDeferred.resolve();

    if (beginResultsUsed) {
      // Zero-copy results path: rpc_builder is already populated with the
      // Return + Payload + content. cpp_rpc_finalize writes prefix + bytes
      // straight to cpp_out so we can subarray and send without allocating.
      const framedLen = this.#exp.cpp_rpc_finalize();
      if (!framedLen) throw new Error("cpp_rpc_finalize failed");
      this.#sendFromOut(framedLen);
    } else if (capTargets) {
      // Allocate a local cap id for each returned target, stage their ids
      // as a packed u32 array in cpp_in, then build a Return whose Payload
      // capTable is [senderHosted(id0), senderHosted(id1), ...].
      const ids = new Uint32Array(capTargets.length);
      for (let i = 0; i < capTargets.length; i++) {
        const id = this.#allocLocalCapId();
        this.#localCaps.set(id, { target: capTargets[i], refcount: 1 });
        ids[i] = id;
      }
      this.#stageIn(new Uint8Array(ids.buffer, 0, ids.byteLength));
      const len = this.#exp.cpp_rpc_build_return_with_caps(answerId, capTargets.length);
      if (!len) throw new Error("cpp_rpc_build_return_with_caps failed");
      this.#sendFromOut(len);
    } else {
      if (!resultsBytes) resultsBytes = emptyAnyPointerMessage();
      this.#stageIn(resultsBytes);
      const len = this.#exp.cpp_rpc_build_return(answerId, 0, resultsBytes.length);
      if (!len) throw new Error("cpp_rpc_build_return (results) failed");
      this.#sendFromOut(len);
    }
  }

  #allocLocalCapId() {
    // ID 0 is reserved for the bootstrap cap.
    if (this.#nextLocalCapId === 0) this.#nextLocalCapId = 1;
    return this.#nextLocalCapId++;
  }

  // Answers are created on demand: either by the inbound Call (the normal
  // path) or by an inbound pipelined Call that arrives before its target
  // (we still register the slot so the target Call can fill it later).
  #getOrCreateAnswer(answerId) {
    let a = this.#answers.get(answerId);
    if (a) return a;
    const d = deferred();
    // Attach a default catch so an unawaited rejection (the common case —
    // nothing pipelines off most calls) doesn't surface as unhandledRejection.
    // Real awaiters still see the rejection when they `await readyPromise`.
    d.promise.catch(() => {});
    a = { params: null, resolved: null, readyDeferred: d, readyPromise: d.promise };
    this.#answers.set(answerId, a);
    return a;
  }

  #handleReturn() {
    // One wasm call returns answerId + retKind + capCount packed in
    // cpp_out (saves 2-3 boundary crossings per Return). Layout matches
    // cpp_rpc_get_return_summary in cpp/wrapper.cpp.
    if (this.#exp.cpp_rpc_get_return_summary() !== 1) return;
    const u8  = this.#mem();
    const out = this.#outPtr;
    const dv  = new DataView(u8.buffer, out, 12);
    const answerId = dv.getUint32(0, true);
    const retKind  = dv.getUint32(4, true);
    const capCount = dv.getUint32(8, true);
    const q = this.#questions.get(answerId);
    if (!q) return;
    this.#questions.delete(answerId);
    if (retKind === RET_RESULTS) {
      // capCount already populated by the summary call; per-cap kind/id
      // still need their own boundary calls (rare path — most Returns
      // carry zero caps).
      const caps = new Array(capCount);
      for (let i = 0; i < capCount; i++) {
        const kind = this.#exp.cpp_rpc_get_return_cap_kind(i);
        const id   = this.#exp.cpp_rpc_get_return_cap_id(i);
        if (kind === 1 /* senderHosted */) {
          const cap = new RpcCap(this, { kind: "import", id }, this.#registry);
          this.#trackImport(cap, id);
          caps[i] = cap;
        } else {
          caps[i] = null;
        }
      }
      // The bootstrap cap lives at importId 0. The bootstrap RpcCap was
      // already returned to the user from .bootstrap(); tracking happens
      // there (see #trackBootstrap below) so it doesn't leak.
      if (q.kind === "bootstrap" && q.bootstrapCap) {
        this.#trackImport(q.bootstrapCap, 0);
      }

      if (q.extract) {
        // Zero-copy result read: point the reader stack at the inbound
        // Return.results.content and run the caller's extractor here, while
        // rpc_reader is still live. The promise resolves with whatever the
        // extractor returns — no result-bytes Uint8Array allocated, no
        // wasm-to-JS copy of the payload.
        if (this.#exp.cpp_rpc_open_return_results() !== 1) {
          q.deferred.reject(new Error("cpp_rpc_open_return_results failed"));
        } else {
          let extracted;
          try {
            const reader = q.resultsReader ? new q.resultsReader(this.#cpp) : null;
            extracted = q.extract(reader, caps);
          } catch (err) {
            q.deferred.reject(err instanceof Error ? err : new Error(String(err)));
            this.finish(answerId);
            return;
          }
          q.deferred.resolve(extracted);
        }
      } else {
        const len = this.#exp.cpp_rpc_get_return_results();
        const bytes = this.#snapshotOut(len);
        q.deferred.resolve({ bytes, caps });
      }
    } else if (retKind === RET_EXCEPTION) {
      const len = this.#exp.cpp_rpc_get_return_exception();
      const reason = textDecode(this.#snapshotOut(len));
      q.deferred.reject(new Error(reason));
    } else if (retKind === RET_CANCELED) {
      q.deferred.reject(new Error("call canceled"));
    } else {
      q.deferred.reject(new Error("unknown return kind"));
    }
    // Always Finish the question so the peer can free its answer-side table.
    this.finish(answerId);
  }

  #handleFinish() {
    const questionId = this.#exp.cpp_rpc_get_finish_question_id();
    this.#answers.delete(questionId);
  }

  // ---- Streaming RPC ------------------------------------------------------

  /**
   * Issue a streaming Call. The caller iterates the returned object's
   * `chunks` AsyncIterable; each yielded value is one Uint8Array
   * (an application-level chunk encoded by the server). The iteration
   * ends when the server emits STREAM_END.
   *
   *   const stream = cap.callStream(IFC, METHOD, paramsBytes);
   *   for await (const chunk of stream.chunks) { ... }
   */
  callStream(target, interfaceId, methodId, paramsBytes) {
    if (this.#closed) throw new Error("RpcSession closed");
    const questionId = this.#allocQuestionId();
    const targetKind = target.kind === "promise" ? TARGET_PROMISED_ANSWER : TARGET_IMPORTED_CAP;
    this.#stageIn(paramsBytes);
    const len = this.#exp.cpp_rpc_build_call(
      questionId, targetKind, BigInt(target.id), BigInt(interfaceId), methodId, paramsBytes.length,
    );
    if (!len) throw new Error("cpp_rpc_build_call failed");
    // Stash a chunk queue + completion deferred. #handleStreamChunk pushes
    // chunks into pending consumers (or buffers them); #handleStreamEnd
    // resolves the iterator's finalizer.
    const queue = [];
    const waiters = [];
    let done = false;
    let failure = null;
    const stream = {
      pushChunk(c) {
        if (done) return;
        if (waiters.length) waiters.shift().resolve({ value: c, done: false });
        else queue.push(c);
      },
      end(err) {
        done = true;
        failure = err ?? null;
        while (waiters.length) {
          const w = waiters.shift();
          if (failure) w.reject(failure);
          else w.resolve({ value: undefined, done: true });
        }
      },
      next() {
        if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
        if (done) {
          if (failure) return Promise.reject(failure);
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      },
    };
    this.#streamQuestions.set(questionId, stream);
    this.#sendFromOut(len);
    return {
      questionId,
      chunks: { [Symbol.asyncIterator]: () => ({ next: () => stream.next() }) },
    };
  }

  /** Run a server-side stream generator, shipping each yielded chunk. */
  async #runStreamHandler(answerId, handler, cap) {
    const ctx = {
      cpp: this.#cpp,
      paramsBytes: () => {
        const len = this.#exp.cpp_rpc_get_call_params();
        return this.#snapshotOut(len);
      },
    };
    try {
      const it = handler(ctx);
      for await (const chunk of it) {
        if (!(chunk instanceof Uint8Array)) {
          throw new Error("stream handler must yield Uint8Array chunks");
        }
        this.#sendStreamChunk(answerId, chunk);
      }
      this.#sendStreamEnd(answerId);
    } catch (err) {
      // STREAM_END carries the error message so the client iterator
      // rejects on next(). No regular Exception Return is sent — the
      // streaming wire model is end-only.
      this.#sendStreamEnd(answerId, String(err?.message ?? err));
    } finally {
      // Mirror the regular call cleanup: the server-side answer entry can
      // be dropped now that streaming is done.
      this.#answers.delete(answerId);
    }
  }

  #sendStreamChunk(questionId, chunk) {
    const head = 1 + 4 + 4;
    const out = new Uint8Array(head + chunk.length);
    out[0] = STREAM_CHUNK_BYTE;
    const dv = new DataView(out.buffer);
    dv.setUint32(1, questionId, true);
    dv.setUint32(5, chunk.length, true);
    out.set(chunk, head);
    // Streaming bypasses the cpp_out scratch — we own this buffer.
    this.#transport.send(this.#frameAround(out));
  }

  #sendStreamEnd(questionId, errMsg) {
    const errBytes = errMsg ? textEncode(errMsg) : null;
    const errLen = errBytes ? errBytes.length : 0;
    const out = new Uint8Array(1 + 4 + 4 + errLen);
    out[0] = STREAM_END_BYTE;
    const dv = new DataView(out.buffer);
    dv.setUint32(1, questionId, true);
    dv.setUint32(5, errLen, true);
    if (errBytes) out.set(errBytes, 9);
    this.#transport.send(this.#frameAround(out));
  }

  // Helper: prepend the 4-byte length prefix our transport expects.
  // Stream frames don't go through cpp_out, so we frame them in JS.
  #frameAround(payload) {
    const out = new Uint8Array(4 + payload.length);
    new DataView(out.buffer).setUint32(0, payload.length, true);
    out.set(payload, 4);
    return out;
  }

  #handleStreamChunk(payload) {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const qid = dv.getUint32(1, true);
    const len = dv.getUint32(5, true);
    const stream = this.#streamQuestions.get(qid);
    if (!stream) return;  // we dropped the iterator
    // Slice into a JS-owned buffer because the transport's view may be
    // backed by wasm memory that mutates.
    stream.pushChunk(payload.slice(9, 9 + len));
  }

  #handleStreamEnd(payload) {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const qid = dv.getUint32(1, true);
    const errLen = payload.length >= 9 ? dv.getUint32(5, true) : 0;
    const stream = this.#streamQuestions.get(qid);
    if (!stream) return;
    this.#streamQuestions.delete(qid);
    if (errLen > 0) {
      const msg = textDecode(payload.subarray(9, 9 + errLen));
      stream.end(new Error(msg));
    } else {
      stream.end();
    }
  }

  // Peer is dropping `refcount` references to our local export `id`. We
  // track refcounts so a single export shared across multiple Returns
  // doesn't get freed prematurely. When the count hits zero, drop the
  // entry from #localCaps so the JS object can be GC'd by the runtime.
  #handleRelease() {
    const id = this.#exp.cpp_rpc_get_release_id();
    const dec = this.#exp.cpp_rpc_get_release_refcount();
    const entry = this.#localCaps.get(id);
    if (!entry) return;
    entry.refcount = (entry.refcount ?? 1) - dec;
    if (entry.refcount <= 0) this.#localCaps.delete(id);
  }

  #sendException(answerId, reason) {
    // If anything is waiting to pipeline off this answer, fail them with
    // the same reason — otherwise they'd hang on a promise that never settles.
    const a = this.#answers.get(answerId);
    if (a && !a.resolved) a.readyDeferred.reject(new Error(reason));
    const enc = textEncode(reason);
    this.#stageIn(enc);
    const len = this.#exp.cpp_rpc_build_return(answerId, 1, enc.length);
    if (!len) throw new Error("cpp_rpc_build_return (exception) failed");
    this.#sendFromOut(len);
  }

  // ---- Internal: scratch buffer plumbing ----------------------------------

  #stageIn(bytes) {
    if (bytes.length > this.#inCap) throw new Error("payload exceeds scratch buffer");
    this.#mem().set(bytes, this.#inPtr);
  }

  // Auto-batched send: queue the framed bytes from cpp_out and flush at
  // the next microtask boundary. Multiple RPC calls made in the same sync
  // block (e.g. a hot loop, or several pipelined Calls) end up in ONE
  // transport.send. Receiver's FrameReader already handles multi-message
  // chunks, so this is wire-compatible with no other changes.
  //
  // Why batch: each transport.send is a microtask + (for real WebSockets)
  // a syscall. Coalescing N sends into 1 saves N-1 of each. For real
  // workloads where calls fire in bursts (UI events, fan-out, etc.),
  // this pulls our latency way under what individual sends could ever do.
  //
  // We have to copy because cpp_out gets reused on the next wasm call.
  // The copy is into a JS-owned buffer — the transport sees one final
  // concatenated Uint8Array, no memory aliasing surprises.
  // Queue cpp_out bytes; flush all queued sends at the next microtask
  // boundary as one transport.send. We slice (not subarray) into JS-owned
  // bytes because cpp_out gets reused by the next wasm call.
  #sendFromOut(framedLen) {
    if (!this.#sendQueue) this.#sendQueue = [];
    this.#sendQueueBytes += framedLen;
    this.#sendQueue.push(this.#mem().slice(this.#outPtr, this.#outPtr + framedLen));
    if (!this.#flushScheduled) {
      this.#flushScheduled = true;
      queueMicrotask(this.#flushBound);
    }
  }

  /** Force any queued frames out NOW. Rarely needed — the microtask
   *  boundary already does this. Useful when about to close the session. */
  flush() { this.#flush(); }

  #flush() {
    this.#flushScheduled = false;
    const q = this.#sendQueue;
    if (!q || q.length === 0) return;
    this.#sendQueue = null;
    const total = this.#sendQueueBytes;
    this.#sendQueueBytes = 0;
    if (q.length === 1) { this.#transport.send(q[0]); return; }
    const out = new Uint8Array(total);
    let p = 0;
    for (let i = 0; i < q.length; i++) { out.set(q[i], p); p += q[i].length; }
    this.#transport.send(out);
  }

  // For paths that materialize bytes for the user (call-result delivery,
  // ctx.paramsBytes(), exception text decoding). slice produces an
  // independent JS-owned buffer the user can hold across wasm calls.
  #snapshotOut(len) {
    return this.#mem().slice(this.#outPtr, this.#outPtr + len);
  }

  #allocQuestionId() {
    const id = this.#nextQuestionId++;
    if (this.#nextQuestionId > 0xfffffff0) {
      // 4G outstanding questions is implausible, but wrap safely if it ever happens.
      this.#nextQuestionId = 0;
    }
    return id;
  }
}

/**
 * A handle to a remote capability. Method dispatch is two-step: the typed
 * wrapper layer (registered through InterfaceRegistry) translates a JS-level
 * call into params-bytes + interfaceId + methodId, and RpcCap forwards that
 * to its session. Returned promise resolves with whatever the wrapper returns.
 */
export class RpcCap {
  #session;
  #target;
  #registry;
  constructor(session, target, registry) {
    this.#session = session;
    this.#target = target;
    this.#registry = registry;
  }
  /** Low-level: send a raw Call. Returns { questionId, promise<resultsBytes> }. */
  call(interfaceId, methodId, paramsBytes) {
    return this.#session.call(this.#target, interfaceId, methodId, paramsBytes);
  }
  /**
   * Streaming call. Returns `{ questionId, chunks }` where chunks is an
   * AsyncIterable<Uint8Array>. Each yielded value is one server-pushed
   * chunk; iteration ends when the server signals stream-end.
   */
  callStream(interfaceId, methodId, paramsBytes) {
    return this.#session.callStream(this.#target, interfaceId, methodId, paramsBytes);
  }
  /**
   * Zero-copy Call: returns `{ params, send }`. Fill `params` then call
   * `send()` to finalize and dispatch. The application's Builder writes
   * directly into the rpc_builder's Call.params.content arena — no
   * intermediate copy of the params bytes.
   */
  callBuilder(interfaceId, methodId, BuilderClass) {
    return this.#session.callBuilder(this.#target, interfaceId, methodId, BuilderClass);
  }
  /** Used by typed wrappers to look up the method handler for an inbound call. */
  get _target() { return this.#target; }
}

/**
 * Maps interfaceId -> { methodId -> serverHandler(paramsBytes) -> resultsBytes }.
 * Generated code from a .capnp interface registers its dispatch table here,
 * and the same registry is consulted when an inbound Call arrives.
 */
export class InterfaceRegistry {
  #byInterface = new Map();
  #streamByInterface = new Map();
  register(interfaceId, methodId, handler) {
    const id = u64(interfaceId);
    let methods = this.#byInterface.get(id);
    if (!methods) { methods = new Map(); this.#byInterface.set(id, methods); }
    methods.set(methodId, handler);
  }
  /**
   * Register a streaming handler. The handler is an async generator that
   * yields Uint8Array chunks; each yield is shipped immediately to the
   * client as a stream frame. The client iterates them via cap.callStream().
   *
   *   registry.registerStream(IFC, METHOD, async function* (target, ctx) {
   *     for (let i = 0; i < N; i++) yield encodeChunk(i);
   *   });
   */
  registerStream(interfaceId, methodId, handler) {
    const id = u64(interfaceId);
    let methods = this.#streamByInterface.get(id);
    if (!methods) { methods = new Map(); this.#streamByInterface.set(id, methods); }
    methods.set(methodId, handler);
  }
  dispatchStream(targetObject, interfaceId, methodId) {
    const methods = this.#streamByInterface.get(u64(interfaceId));
    if (!methods) return null;
    const fn = methods.get(methodId);
    if (!fn) return null;
    return (ctx) => fn(targetObject, ctx);
  }
  /**
   * Look up the dispatch handler for an inbound call. The handler is invoked
   * with the local capability target object and a request context (`ctx`)
   * that exposes both the legacy bytes-based path (`ctx.paramsBytes()`) and
   * the zero-copy reader/builder primitives (`ctx.openParams`, `ctx.beginResults`).
   * Returns a promise of either Uint8Array results, `{ caps: [...] }`, or
   * null/undefined for an empty reply (or nothing if `ctx.beginResults` was
   * used to build the reply directly into the rpc_builder's arena).
   */
  dispatch(targetObject, interfaceId, methodId) {
    const methods = this.#byInterface.get(u64(interfaceId));
    if (!methods) return null;
    const fn = methods.get(methodId);
    if (!fn) return null;
    return (ctx) => fn(targetObject, ctx);
  }
}

// WebAssembly i64 values cross to JS as signed BigInts (high-bit set →
// negative). Cap'n Proto interface IDs are unsigned 64-bit; normalize so
// `0xabcdef0123456789n` and the BigInt that wasm returns for the same
// 64-bit pattern compare equal as Map keys.
function u64(x) { return BigInt.asUintN(64, BigInt(x)); }

// ---- Browser WebSocket transport ----------------------------------------
//
// Wraps a WebSocket so it satisfies RpcSession's transport contract
// ({ send, onMessage, close }). Each .send(bytes) becomes ws.send(bytes);
// each binary message arriving on the WS becomes the next onMessage delivery.
// Length-prefix framing happens above this layer (FrameReader handles it).
//
// Usage:
//   const ws = new WebSocket("wss://example.com/rpc");
//   ws.binaryType = "arraybuffer";
//   const session = new RpcSession(cpp, wsTransport(ws), registry, { bootstrap });
//
// Or use connectWebSocket() below to skip the boilerplate.
export function wsTransport(ws) {
  ws.binaryType = "arraybuffer";
  let cb = null;
  ws.addEventListener("message", (ev) => {
    if (!cb) return;
    if (ev.data instanceof ArrayBuffer) cb(new Uint8Array(ev.data));
    else if (ev.data instanceof Blob) ev.data.arrayBuffer().then(b => cb(new Uint8Array(b)));
    else if (typeof ev.data === "string") cb(new TextEncoder().encode(ev.data));
  });
  return {
    send(bytes) {
      // ws.send copies the bytes into its own send queue, so handing it a
      // subarray view of wasm memory is safe — the WS implementation doesn't
      // retain the view past the call.
      ws.send(bytes);
    },
    onMessage(handler) { cb = handler; },
    close() { ws.close(); cb = null; },
  };
}

/**
 * Open a WebSocket to `url` and resolve to a connected RpcSession.
 * Stupidly simple: one call, one URL, optional registry/bootstrap.
 *
 *   const session = await connectWebSocket(cpp, "wss://api.example.com/rpc");
 *   const cap = session.bootstrap();
 *   const r = cap.callBuilder(IFC, METHOD, MyParams);
 *   r.params.foo = 1;
 *   const result = await r.send().promise;
 *
 * In Node, pass a `WebSocket` constructor via opts.WebSocket (no built-in).
 *
 * @param {object} cpp - loaded CapnCpp instance (await load())
 * @param {string} url - ws:// or wss:// URL
 * @param {object} [opts]
 * @param {InterfaceRegistry} [opts.registry] - typed wrappers for inbound calls
 * @param {object} [opts.bootstrap] - exposed when peer requests Bootstrap
 * @param {Function} [opts.WebSocket] - WebSocket constructor (defaults to globalThis.WebSocket)
 */
export async function connectWebSocket(cpp, url, opts = {}) {
  const WSCtor = opts.WebSocket ?? globalThis.WebSocket;
  if (!WSCtor) throw new Error("No WebSocket constructor available; pass opts.WebSocket");
  const ws = new WSCtor(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new RpcSession(cpp, wsTransport(ws), opts.registry, {
    bootstrap: opts.bootstrap,
  });
}


// In-process transport pair used by tests. Each side gets a callback queue;
// .send() on side A delivers asynchronously to side B's onMessage (and vice
// versa). Mirrors the WebSocket interface a real browser session would use.
export function createMemoryTransportPair() {
  const a = makeEnd();
  const b = makeEnd();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

function makeEnd() {
  return {
    peer: null,
    _cb: null,
    onMessage(cb) { this._cb = cb; },
    send(bytes) {
      // Defer delivery so handlers run on a clean stack frame, matching
      // how a real socket would surface incoming data. The bytes coming
      // in are already JS-owned (RpcSession#sendFromOut slices from wasm
      // memory before calling us), so no defensive copy is needed —
      // saves a 64KB memcpy on every big round-trip.
      const peer = this.peer;
      queueMicrotask(() => peer._cb?.(bytes));
    },
    close() { this._cb = null; },
  };
}

// ---- Helpers --------------------------------------------------------------

const SHARED_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();
function textDecode(bytes) { return SHARED_DECODER.decode(bytes); }
function textEncode(str) { return SHARED_ENCODER.encode(str); }

// A minimal Cap'n Proto framed message holding a single null AnyPointer at
// its root. Used as the "no payload" body for Bootstrap returns and for
// methods that have empty params/results. Hand-coded: 1-segment header
// (segment count = 0 means "1 segment", segment size = 1 word), then a
// single zero word as the root pointer (= null AnyPointer).
const EMPTY_ANY_POINTER = (() => {
  const out = new Uint8Array(16);
  // Segment table: u32 (segCount-1)=0, u32 segSize=1
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  // Segment 0: one zero word = null pointer.
  return out;
})();
function emptyAnyPointerMessage() { return EMPTY_ANY_POINTER.slice(); }
