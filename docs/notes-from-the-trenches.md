# Notes from the trenches: rebuilding capnweb's wire format with real Cap'n Proto in wasm

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time. Normal readers now keep message bytes in managed `WebAssembly.Memory`, but 0.0.x still needs hardening around allocator lifecycle, large payloads, hostile inputs, concurrency, and secure memory hygiene.

A field report on what happens when you take Cap'n Proto's actual C++ runtime, statically compile it to wasm, wire it up to JS-side codegen, and benchmark against capnweb. I had a hypothesis ("the binary wire is doing real work that JSON can't") and a few well-known traps to avoid. The actual surprises were elsewhere.

## Setup

- Real upstream Cap'n Proto C++ (not a JS reimplementation).
- Compiled with `zig cc` targeting `wasm32-wasi-musl`. No emscripten.
- `-Oz -flto -fdata-sections -ffunction-sections -Wl,--gc-sections -fmerge-all-constants -Wl,--strip-all`. Then `wasm-opt -Oz --converge` on top.
- Pre-allocated arenas instead of malloc/free per RPC frame.
- JS-side codegen with V8-friendly hidden-class shapes, ES2024 `Promise.withResolvers`, etc.

Result: 42 KB gz total bundle (JS shim + separately-fetched wasm) for the browser path.

## Trap 1: a "fast-path" that was 30× slower than the safe path

The original codegen for text fields had this:

```js
// "Fast" ASCII path. Avoid TextDecoder allocation overhead
let asciiOk = true;
for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { asciiOk = false; break; }
if (asciiOk) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
return new TextDecoder().decode(bytes);
```

The intent was to dodge TextDecoder's per-call setup cost. The reality:

| length | hand-rolled loop | shared `TextDecoder.decode` |
|---|---|---|
| 4 B | 23 ns | 46 ns |
| 16 B | 98 ns | 50 ns |
| 256 B | 968 ns | 65 ns |
| 4 KB | 13.0 µs | 0.41 µs |
| 64 KB | 305.2 µs | 4.1 µs |

V8's `TextDecoder.decode` is internal C++ that crushes any JS string-concat loop above ~12 bytes. The crossover is so far below typical message sizes that the "fast path" was the slow path for almost every real string. Removing it dropped 64 KB text echo from 1076 µs → 110 µs per round-trip (~10× faster).

**Lesson**: V8 ships internal C++ for `TextDecoder`, `TextEncoder`, `JSON.parse`, `Uint8Array.set`, `memcpy` (via wasm `memory.copy`), regex, etc. Hand-rolled JS loops don't beat them above trivial sizes. Always benchmark before introducing a "fast path."

## Trap 2: 70% of CPU was in `calloc`

CPU-profiling a tight u8-echo RPC loop showed 70% of time in a single wasm function. Disassembling it: it was `calloc`. Allocating a fresh segment for every `MallocMessageBuilder` we built, then zeroing it. The destructor freed it. We did this 4× per RPC round-trip (Bootstrap, Call, Return, Finish). Most messages were <100 bytes; we were allocating a fresh KB+ segment for every one.

Fix: placement-new the `MallocMessageBuilder` into a static `char[]` buffer with a pre-allocated `word[]` first segment passed in via the constructor's borrowed-segment overload. The destructor zeroes a borrowed segment but doesn't free it, so re-initialization sees a fresh zeroed buffer with no allocator round-trip.

Per-call wasm cost dropped:
- tiny u8 echo: 17.7 µs → 8.5 µs (~2× faster)
- 64 KB text: 110 µs → 96 µs (~14% faster on top of the TextDecoder fix)
- burst 1000: 7.85 µs → 2.5 µs per call (~3× faster aggregated)

**Lesson**: object pooling is one of the oldest perf tricks in the book and Cap'n Proto's `MallocMessageBuilder` API supports it cleanly via the borrowed-firstSegment constructor. Same pattern as Linux's slab allocator, Netty's `ByteBufPool`, Go's `sync.Pool`. If you're allocating the same shape repeatedly in a hot loop, stop allocating.

## Trap 3: V8 hidden classes are unforgiving

The session's "question record" was created in two different shapes depending on call type:

```js
// Bootstrap call
{ deferred, kind: "bootstrap", bootstrapCap }

// Regular call
{ deferred, kind: "call" }
// or sometimes
{ deferred, kind: "call", resultsReader, extract }
```

V8 transitions hidden classes when properties are added. Three different shapes meant `#handleReturn`'s `q.extract` access site was polymorphic. Couldn't be inlined into the fast path. The deopt cost ~1 µs on every Return.

Fix: factory function that always emits the same shape with `undefined` in unused slots:

```js
function makeQ(deferred, kind, bootstrapCap, resultsReader, extract) {
  return { deferred, kind, bootstrapCap, resultsReader, extract };
}
```

Cap-passing case flipped from 0.95× of capnweb to 1.02× (we beat it now).

**Lesson**: in V8, "always create with the same fields in the same order" is a perf-relevant invariant, not just a style nit. Same shape every time → monomorphic inline cache → JIT inlines aggressively. This is true for SpiderMonkey and HotSpot too. Uniformity at object creation pays off at every read site.

## Trap 4: GC was 16% of CPU during burst workloads

After all the above, profile a 1000-call burst: 2.5 µs per call, but 16% of total CPU was in the GC. The hottest allocator was the per-call question record (referenced from a `Map` until `#handleReturn` deletes it, then garbage).

Fix: simple freelist, capped at 256 entries.

```js
const Q_POOL = [];
function makeQ(...) {
  const q = Q_POOL.pop();
  if (q) { /* reset fields */ return q; }
  return { /* fresh */ };
}
function recycleQ(q) {
  if (Q_POOL.length >= 256) return;
  /* null out fields */
  Q_POOL.push(q);
}
```

Burst 1000 dropped from 2.76 µs → 2.48 µs per call. The young-gen GC stopped firing in the bench loop entirely.

**Lesson**: Promise/object/buffer pools are still relevant in 2026 if your workload allocates the same shape thousands of times per second. V8's GC is fast but it's not free.

## Trap 5: Skip the wasm boundary when you already know the bytes

A `Finish` frame is a fixed-shape Cap'n Proto message. 44 bytes, identical for every question except for the questionId at byte 36 (LE u32). We were calling `cpp_rpc_build_finish(id)` for every reply: a wasm boundary crossing, a `MallocMessageBuilder` placement-new, a serialize, a memcpy. ~300 ns of work to produce an output we could have hand-coded.

Fix:

```js
const FINISH_TEMPLATE = new Uint8Array([
  0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // length prefix
  0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,  // segment table
  0x00, 0x00, 0x00, 0x00,                          // padding
  0x01, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00,  // root pointer
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // rpc.Message which=4 (finish)
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,                          // questionId @ byte 36
  0x00, 0x00, 0x00, 0x00,                          // releaseResultCaps
]);
function buildFinishFrame(questionId) {
  const out = new Uint8Array(FINISH_TEMPLATE);
  out[36] = questionId & 0xff;
  out[37] = (questionId >>> 8) & 0xff;
  out[38] = (questionId >>> 16) & 0xff;
  out[39] = (questionId >>> 24) & 0xff;
  return out;
}
```

This is the same shape as DNS replies (mostly canned), TCP ACK packets (mostly canned), HTTP/2 SETTINGS frames (mostly canned). When most of your bytes are already known, don't run code to produce them.

## Trap 6: a bench that flattered us. Codegen had a per-instance alloc

Late in the run I added a runtime-schema reader (`capnwasm/dynamic`). Schema is plain JS data, no codegen step, useful for tenant-uploaded schemas and admin tools. Wrote a bench comparing it against the codegen path on the conformance schema's 13-field `Primitives` struct. The numbers were strange:

```
read all 13 fields    codegen ~745 ns   dynamic ~511 ns/call    (dynamic 0.69×)
```

Dynamic *faster* than codegen. Even though codegen has the offsets baked as integer literals at the call site and dynamic does a Map lookup + switch. The natural reaction to this shape of result is "great, it's a feature, ship it." I almost did. Then I re-read the bench, ran it in subprocess isolation to make sure V8 IC carryover wasn't doing it, used a sink to defeat dead-code elimination. Same result.

Then I read the codegen output for the float fields:

```js
get f32() {
  const u = this._exp.cpp_any_uint32_at(32, 0) >>> 0;
  if (!this._f32buf) {
    this._f32buf = new ArrayBuffer(4);
    this._f32u32 = new Uint32Array(this._f32buf);
    this._f32f32 = new Float32Array(this._f32buf);
  }
  this._f32u32[0] = u;
  return this._f32f32[0];
}
```

Lazy-init on the reader instance. Each new reader paid an `ArrayBuffer` alloc + 2 typed-array allocs the first time you read `f32` (and again for `f64`). The bench creates a new reader per iteration, so every iteration paid the alloc on every float field. The `_F32_VIEW_*` shared buffers were declared at module scope at the top of the same file. They just weren't being used in the per-field getters.

Hoist the buffers, regenerate, re-bench:

```
read all 13 fields    codegen ~456 ns   dynamic ~534 ns/call    (codegen 1.17× faster)
batched pick(3)       codegen ~494 ns   dynamic ~429 ns/call    (dynamic 1.15× faster)
build with 13 fields  codegen ~835 ns   dynamic ~1343 ns/call   (codegen 1.61× faster)
```

The result: codegen wins per-field reads (offset literals beat Map lookups), batched picks are a wash (one wasm boundary call regardless of access path), codegen wins writes by a wider margin. Dynamic is "fast enough for the cases it exists for". Sub-microsecond per field on a tenant-uploaded schema is fine.

**Lesson 1**: a flattering benchmark is the most dangerous kind. If the result contradicts what the abstraction layer should cost (Map lookup + switch can't be free), check what the *other* side is doing wrong. The "fast" thing was actually the slow thing wearing makeup.

**Lesson 2**: per-instance lazy init is a smell. The whole point of the lazy was to avoid the cost in cases where f32 is never accessed; in practice the cost-of-the-check at the call site lost to the cost-of-the-alloc-when-it-fires, and the reader instances were short-lived enough that "first call ever" was effectively "every call." Module-scope shared buffers are the correct shape. One alloc per process, reused forever.

**Lesson 3**: when you publish a perf claim that surprises you, make it cheap to retract. The original bench script was committed under `bench/dynamic_bench.mjs`. The retraction needed a new isolated bench (`dynamic_bench_isolated.mjs`), an updated README, and a doc note. Cheaper than letting the wrong number propagate into a blog post.

**Coda**: the same "per-instance lazy alloc" pattern was hiding in the codegen *builders* too. Every i64/f32/f64 setter did `const dv = new DataView(this._u8.buffer);` per call. Cached in the constructor; codegen build paths got 11% faster across every generated `.gen.mjs`, not just the bench schema. Both fixes (read-side ArrayBuffer hoist, write-side DataView cache) are wins independent of the bogus dynamic-vs-codegen claim that surfaced them. Sometimes the wrong question still extracts the right answer. But only if you ask it carefully and notice when the answer surprises you.

## The SIMD experiment, with a negative result

The natural next thing to try after all of the above: enable wasm SIMD and let the compiler auto-vectorize what it can.

Tried two configurations:

| build | wasm gz | tiny u8 | 256B text | 4KB text | 64KB text |
|---|---|---|---|---|---|
| baseline (`-Oz`, no SIMD) | 41.0 KB | 8.96 µs | 5.0 µs | 16.9 µs | 96.0 µs |
| `-Oz -msimd128` | 41.2 KB | 8.85 µs | 4.67 µs | 16.84 µs | 98.65 µs |
| `-O3 -msimd128 -mrelaxed-simd` | 49.7 KB | 8.25 µs | 5.26 µs | 15.07 µs | 96.15 µs |

Numbers are all within run-to-run noise (±5%) except for `-O3` showing modest 8-10% wins on tiny u8 and 4KB text. But those came with a 22% bundle-size increase, and they're pure CPU savings under 2 µs per call that disappear behind any real network.

**Why SIMD doesn't help here**: the work breakdown of an RPC round-trip after the optimizations above is now:

- JS↔wasm boundary crossings (~17 calls × 6 ns)
- Microtask scheduling (3 boundaries × ~250 ns)
- `Map.set` / `Map.delete` for question tracking
- C++ pointer-following (Cap'n Proto wire navigation. Branchy, sequential)
- Per-field integer load/store (single instruction each)
- `memcpy` of frame bytes (already vectorized via wasm `memory.copy`)
- `TextDecoder.decode` / `TextEncoder.encodeInto` (already SIMD inside V8)
- GC pressure

Everything that *would* benefit from SIMD is **already SIMD-accelerated by V8 internals**. The remaining hot work is sequential integer ops where SIMD has nothing to parallelize. Cap'n Proto's wire format intentionally has no compression, no checksum, no math. It's "random-access reads on raw bytes." That's the source of its perf, but it's also why SIMD has nothing to chew on.

**Lesson**: SIMD wins on workloads that look like ML or graphics. Vector dot products, image filters, audio mixing, hash functions, video frame transforms. It doesn't win on RPC-shaped work, where the bottlenecks are call-graph latency (boundary, microtask, GC) rather than parallel arithmetic. Reverted the change. The negative result is more useful than a slightly-faster build with a 22% size penalty.

## Trap 7: typed-array reads beat DataView, but only if you don't pay for them

The dense-iteration bench (500 rows × 2-field full read) sat at ~67 µs vs JSON.parse's ~43 µs. JSON.parse winning by 1.5× is the kind of "we lose to the C++ baseline" result you accept until someone asks "so why didn't the typed schema help?"

The honest answer: every primitive field read was going through `DataView.getXxx(off, true)`. Cap'n Proto wire format is little-endian and the layout compiler aligns primitive struct fields at their element-size boundaries — exactly the conditions for typed-array reads (`Uint32Array[i]` ≈ 1 ns) to be valid. We were paying ~5-7 ns per field instead of ~1 ns, on a typed schema where the alignment guarantee was already in the hand we were holding.

Codegen change: emit `this._u32[(this._dataPtr + off) >>> 2]` for `UInt32` fields, similarly for `UInt16`/`Int16`/`Int32`/`Float32`/`Float64`. `Bool`/`UInt8`/`Int8` already used direct `_u8[]` reads (it was easier to write, so we did). The shifted index works because capnp's offsets are aligned; for unaligned offsets we'd corrupt reads silently. We don't have those.

Naive first attempt: cache `_u16`, `_i16`, `_u32`, `_i32`, `_f32`, `_f64` views as instance fields on every Reader, set them in the constructor next to `_u8` and `_dv`. Bench result on dense: **125 µs**, almost 2× slower than baseline. List went 88% slower too.

The reads themselves got faster. The constructor did six extra view assignments. Each `list.at(i)` allocates a fresh element Reader, so on a 500-row dense bench we paid 500 × 6 typed-view-getter chains × ~5 ns each = ~15 µs of pure setup cost per iteration. The typed-view getters on the cpp instance check `buffer.detached` on every access (so they refresh after `memory.grow`), which V8 doesn't fully inline. We were running the boundary-detached check 3000 times per iteration to set up reads that would only fire 1000 times.

Fix: pass the parent reader directly. Element reader copies the typed-view fields off the parent's instance (which validated them once when the root opened), not from the cpp getters. The hot path is now `this._u32 = parent._u32` — a hidden-class slot read followed by a slot write, V8 inlines that to two ops.

Bench result on dense: **53 µs**. **22% faster than baseline.** List dropped from 136 µs → 103 µs. Conformance suite + hostile-input fuzz still pass.

**Lesson**: when you have a typed schema, the wire format aligned at element-size boundaries, and the bytes living in `WebAssembly.Memory.buffer`, the natural read primitive is a typed-array index, not `DataView.get`. But the boundary-detached check on every getter call is a real per-access cost that V8's optimizer doesn't always inline. If you're allocating short-lived readers in a loop, fetch views once on the long-lived owner (root reader, parent reader) and propagate them down. The win shifts from "faster per-field reads" to "fewer boundary-detach checks at allocation time," which is where the time was actually being spent.

The same pattern almost certainly applies to other JS-on-wasm libraries that hand back per-element wrappers. We just happened to notice it because we had a bench that pinned the regression on a single change.

## Trap 8: capnp on `WebAssembly.Memory` unlocks things JSON literally can't do

The reframe that surfaced Trap 7: capnwasm isn't "a library that reads wasm memory from JS." It's "a wire format that already matches an aligned typed buffer that we expose to the runtime." Once you treat `wasm.memory.buffer` as a first-class typed buffer instead of an opaque source the JS wraps, the API design questions change.

Things this enables that no JSON parser can do:

- **Typed-array views over primitive lists.** A `List(Float64)` can return a `Float64Array` subarray over wasm memory. Zero copy. JSON parses arrays into JS `Array<number>` boxed values; capnwasm hands back a contiguous typed buffer the JIT can vectorize over.
- **Direct GPU upload.** A `Float32Array` view of `wasm.memory.buffer` is a valid source for `GPUDevice.queue.writeBuffer` or `WebGLBuffer.bufferData`. No copy from JS heap to GPU staging buffer. JSON has to materialize JS objects, then iterate them into a fresh `Float32Array`, then upload.
- **SharedArrayBuffer hand-off across Worker threads.** If the wasm instance was created with shared memory, two Worker threads can read the same capnp message at the same byte addresses with no IPC and no copy. JSON.parse always materializes per-isolate JS objects.
- **In-place text matching without decoding.** For tag/enum-style strings, `bytesEqual(uint8Slice, "important")` is ~10 ns; `TextDecoder.decode` + string compare is ~100 ns. No need to ever produce a JS string when you only want to compare.
- **Streaming reads while bytes are still arriving.** capnp's wire format is random-access; if `_msgEnd` advances as bytes land, a reader can read field 0 before bytes 8-N have arrived. Typed-array views don't have to be re-fetched (same buffer). JSON.parse is one-shot — you wait for the whole document.

We don't have all of these implemented. They're the architectural opportunities the wire-format-on-wasm-memory model creates. The cost of *not* exposing them is "capnwasm is fine for sparse access and binary blobs and loses on everything else, just like any RPC library." The cost of exposing them is API surface that breaks the "every reader is independent" contract — and that's where Trap 7's fix landed: keep the safe contract, just plumb the views down internally so the user doesn't pay for re-validation on every element.

## Final scoreboard vs. capnweb

In-process bench, both peers in the same Node process via a memory transport pair:

| workload | capnweb | capnwasm | speedup |
|---|---|---|---|
| tiny u8 echo | 14.0 µs | 8.5 µs | 1.7× |
| 16 B text echo | 8.0 µs | 6.4 µs | 1.3× |
| 256 B text echo | 8.5 µs | 4.6 µs | 1.9× |
| 4 KB text echo | 27.0 µs | 16.9 µs | 1.6× |
| 64 KB text echo | 365 µs | 96 µs | 3.8× |
| burst 1000 / call | 7.9 µs | 2.5 µs | 3.2× |
| 5 MB binary asset | 6.6 MB on wire | 5.0 MB on wire | 1.3× / no base64 |

| | capnwasm | capnweb |
|---|---|---|
| Bundle gz (Workers deploy limit) | 41 KB | 21 KB |
| Bundle br (browser on-wire via Cloudflare/Vercel/Netlify) | **35 KB** | **18 KB** |
| Cold start | ~3 ms | ~0.2 ms |
| Multi-language wire interop | yes | no |
| OpenAPI client codegen | yes | structurally no |
| Schema requirement | yes | no |

The frame: **capnweb keeps Cap'n Proto-style RPC semantics in a compact JS-only package with a JSON-shaped wire. capnwasm keeps the Cap'n Proto binary wire too, by paying for a wasm runtime.** For workloads where the wire matters (binary data, sparse reads, sustained throughput), the binary wire can win by a lot. For workloads where the wire doesn't matter (small JSON-shaped payloads in a JS-only stack), capnweb's 18 KB brotli bundle and fast cold start are the better tradeoff.

Neither one is wrong. They're optimized for different things. capnweb intentionally favors a small JS-only bundle and a JSON-shaped wire that feels natural in JavaScript apps. capnwasm explores the opposite choice: keep the binary Cap'n Proto wire and pay the wasm/runtime cost. The useful result is the boundary between those choices: capnweb is better for tiny JS-shaped traffic and bundle budgets; capnwasm becomes interesting when the workload is binary-heavy, large, or sparse.

## OpenAPI ↔ Cap'n Proto work

Separate from the RPC perf work, this repo now has a manifest pipeline that moves between OpenAPI, TypeScript REST interfaces, and Cap'n Proto schemas: `manifest`, `emit-capnp`, `emit-openapi`, `lock`, `compat`, `probe`, `emit-codec`, and `emit-agents` / `mcp`. The tradeoff is the same theme as the rest of the repo: JSON/OpenAPI is best for public docs, partner APIs, and tiny text payloads; Cap'n Proto becomes interesting when binary payloads, sparse reads, or explicit schema evolution matter.

## Reproducing

```bash
git clone https://github.com/teamchong/capnwasm
cd capnwasm
pnpm install
bash cpp/build.sh       # builds wasm + inlined.mjs
pnpm test               # 400+ tests; installs Playwright Chromium on first run if missing
node bench/rpc_bench.mjs # in-process RPC bench
node bench/realistic.mjs # burst throughput, wire bytes, sparse access
```

For the SIMD experiment specifically, edit `cpp/build.sh` to add `-msimd128 -mrelaxed-simd` and switch `-Oz` to `-O3`, then re-run `bash cpp/build.sh && node bench/rpc_bench.mjs`. Numbers come out within 10% of baseline. Confirm or refute on your hardware.
