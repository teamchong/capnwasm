# Cap'n Proto in `WebAssembly.Memory`

> Status: **design doc, in progress**. capnwasm 0.0.x ships the safe-by-default reader path described in [Step 1](#step-1-safe-readers-managed-webassemblymemory) below. The full ABI described in this document lands across milestones M1–M9 and will be published as capnwasm 0.1.0.
>
> This is a working document, not a marketing page. It is honest about what is built, what is not, and the prior art.

## Why

JS↔WebAssembly communication is the recurring blocker for high-performance wasm modules in browsers, Workers, and Node. Today the options are:

- `wasm-bindgen` and similar tools, which copy values across the boundary for any non-trivial shape ([wasm-bindgen issue #2741](https://github.com/rustwasm/wasm-bindgen/issues/2741)).
- The WebAssembly Component Model (WIT / interface types), which is the official cross-language story but uses a lift/lower copy model rather than zero-copy access through linear memory.
- Hand-rolled struct layouts over `SharedArrayBuffer` / `Atomics`, which are powerful but not typed and not portable.

Cap'n Proto's wire format is already an in-memory layout: word-aligned segments, fields at fixed offsets in the data section, pointer-encoded text/data/lists/structs. A Cap'n Proto message sitting in `WebAssembly.Memory` can be read **byte-for-byte from JS** (`DataView`/`Uint8Array` over `memory.buffer`) and **byte-for-byte from wasm** (raw pointers) with no marshalling layer in between. There is no parse step on either side.

The bet: use Cap'n Proto as the typed, zero-copy ABI between JS and any wasm module, with capnwasm as the reference implementation.

## Prior art

- [WebAssembly/design#1274](https://github.com/WebAssembly/design/issues/1274) explicitly proposed Cap'n Proto as the inter-language binding format. The proposal sat dormant.
- [couchand/rust-wasm-capnproto-example](https://github.com/couchand/rust-wasm-capnproto-example) is a small Rust+wasm+JS demo. Never grew into a library.
- The WebAssembly Component Model went a different direction.
- Several capnp-* implementations exist per language but none frame themselves as a wasm bridge.

The idea is not new. The execution gap is. capnwasm closes it because the foundation already exists: real upstream Cap'n Proto C++ statically compiled to wasm, generated typed readers/builders for JS, eight-language Cap'n Proto wire compatibility.

## How JS reads Cap'n Proto from `WebAssembly.Memory`

Cap'n Proto messages in linear memory are:

- An optional 8-byte segment table: u32 segment count followed by u32 word counts per segment, padded to 8-byte alignment.
- One or more segments of word-aligned data.
- Inside segments, structs with a fixed-size data section followed by a pointer section.
- Pointers are 8 bytes encoding either a struct offset (with data/ptr word counts), a list offset (with element type and count), or a far pointer to another segment.

Once the bytes sit in `WebAssembly.Memory`, JS reads them through views over `memory.buffer`:

- **Primitive struct fields** (int, float, bool) live at fixed byte offsets in the data section. JS does `dv.getUint32(dataPtr + off, true)` and that is the value. No wasm boundary call.
- **Text and Data fields** are pointers. Read the 8-byte pointer at `dataPtr + ptrSection + i*8`, decode the offset/length, then read the bytes via `TextDecoder.decode(u8.subarray(start, end))` for Text or `u8.slice(...)` for Data.
- **Lists** are pointers encoding element type, element width, and count. JS walks elements at known stride.
- **Nested structs** are pointers; chase them to the next data section and read primitives the same way.

In capnwasm 0.0.x, JS does primitive reads itself with `DataView` (zero wasm boundary cost) and crosses into wasm only for pointer-chasing (text/list/nested struct) because pointer decoding has fiddly edge cases (far pointers, multi-segment, defaults) that are easier to keep in upstream C++.

The 0.1.0 ABI adds a pure-JS pointer decoder so foreign wasm modules without the C++ runtime can participate.

## Architecture

### Step 1. Safe readers, managed `WebAssembly.Memory`

**Status: shipped in 0.0.3.**

Each `openFoo(cpp, bytes)` allocates a wasm-memory region, copies the input bytes in once, and opens the upstream C++ Cap'n Proto reader over that region.

- JS holds a `{ ptr, len }` handle.
- A `FinalizationRegistry` releases the region when the JS handle becomes unreachable.
- A generation token on the `CapnCpp` instance lets safe readers re-bind their cursor to their own region when another decode happens, so they survive across calls.
- An explicit `openFooUnsafe(cpp, bytes)` keeps the old shared-scratch fast path for measured hot loops; unsafe readers throw `StaleReaderError` instead of silently corrupting.

This is correctness-only. The C++ side still has one live `any_reader` slot; JS multiplexes by re-binding on demand. That is honest and works, but it is not yet "each reader has its own native cursor."

### Step 2. Production ABI

The 0.1.0 architecture replaces the rebind plumbing with native multi-reader support and adds the public ABI surface.

**Single-segment messages on the ABI surface.** Cap'n Proto allows multi-segment messages. Multi-segment in linear memory is awkward and not what we want for the hot path. The ABI requires single-segment; the build path forces a large enough first segment; the read path validates and rejects multi-segment input.

**Per-`CapnCpp` bump arena.** Replaces `std::malloc` for the common case. Reset between message groups. Falls back to a separate allocator for outsized one-offs.

**Native multi-reader slot pool.** The C++ side promotes `any_reader` to a fixed pool (default 8 slots, configurable). JS readers carry a slot index. Each reader's getter calls `cpp_any_use_slot(idx)` once when it crosses into wasm, instead of re-binding the cursor. This is the change that turns "auto-rebind" into "each reader has a live native cursor."

**Explicit lifetime.** `reader.dispose()` and TC39 `using`. `withReader(cpp, bytes, ReaderClass, fn)` for scoped use. `FinalizationRegistry` becomes a backstop only.

**Pure-JS pointer decoder.** Conformance-tested against the C++ decoder. Lets foreign wasm modules without the C++ runtime participate in the ABI.

**Public C ABI.** Header `cpp/capnwasm_abi.h`. C contract is `(ptr, len)` in, `(ptr, len)` out, plus a small set of arena helpers. A Rust crate `capnwasm-abi` wraps this for foreign Rust wasm modules. JS-side helper `callWasm(module, method, ParamsBuilder, args, ResultsReader)` builds the message, calls the export, opens the result reader against the same arena.

**Hardening.** Fuzz corpus on framed input. Bounds-check audit. Optional arena zeroing. Worker concurrency tests.

**Benchmarks.** Honest comparison vs `wasm-bindgen`, JSON, and Component Model on equivalent shapes. Cross-language demo: Rust wasm and JS host reading the same Cap'n Proto messages.

## What this is and is not

**It is.** A safe, language-agnostic ABI that uses Cap'n Proto messages in `WebAssembly.Memory` as the wire format between JS and any wasm module. Zero-copy reads from either side. Built on upstream Cap'n Proto, with eight-language interop already established.

**It is not.** A replacement for the WebAssembly Component Model. The Component Model is a broader story that includes resource types, async streams, and instance composition. capnwasm's ABI is narrower: typed messages over linear memory. Use the Component Model when you need its full feature set; use this when you want zero-copy and a wire format that already speaks Rust/Go/Python/Java/C++/JS.

**It is not.** A claim of novelty in the idea. The idea has been on record since [WebAssembly/design#1274](https://github.com/WebAssembly/design/issues/1274). The novelty is in the production execution.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| Step 1 | Safe-by-default readers, managed `WebAssembly.Memory`, generation token, `*Unsafe` escape hatch | Shipped 0.0.3 |
| Pre-M1 | Cleanup: dead fallback paths, inner-list rebind hazard, explicit RPC reader contract, removal of bench-only LazyReader / openFromStream / capnwasm/tape from the production surface, rename of cpp_lazy_aux_* to cpp_scratch_aux_* | Shipped 0.0.4 |
| M1 | Single-segment ABI surface, builder constraint, validation, tests | Pending |
| M2 | Per-`CapnCpp` bump arena replacing `malloc`/`free`, reset API, stress test | Pending |
| M3 | Native multi-reader slot pool on the C++ side, JS readers carry slot index, drop rebind plumbing | Pending |
| M4 | Explicit lifetime: `dispose`, `using`, `withReader` | Pending |
| M5 | Pure-JS pointer decoder for foreign wasm modules + conformance tests | Pending |
| M6 | Public C ABI header, Rust crate stub, `callWasm` helper, end-to-end Rust+JS example | Pending |
| M7 | Hardening: fuzzing, hostile corpus, optional zeroing, concurrency tests | Pending |
| M8 | Benchmarks + write-up referencing prior art | Pending |
| M9 | Release 0.1.0 with revised production-readiness scope | Pending |

## Working principles

1. Each milestone lands as its own commit with passing tests. No combined drops.
2. Performance regressions are acceptable if they buy lifetime safety, ABI stability, or language-agnostic interoperability. Acceptable, not invisible: the bench in M8 measures all of them.
3. The repo never claims more than it ships. Production-readiness language tracks the actual milestone state.
4. Prior art ([WebAssembly/design#1274](https://github.com/WebAssembly/design/issues/1274)) is acknowledged in the README and the M8 write-up.
5. Public API additions (`openFooUnsafe`, `dispose`, `using`, `withReader`, `callWasm`, `capnwasm-abi`) are stable from the milestone in which they land.

## Constraints worth being explicit about

- **Single-writer / multi-reader.** The ABI is single-writer per message region. Multi-reader is fine because Cap'n Proto reads are pure. Concurrent writers to the same region are not supported.
- **Endianness.** Cap'n Proto and wasm are both little-endian. No conversion.
- **Alignment.** 8-byte aligned. Both sides agree.
- **Wasm linear memory does not shrink.** A single very large message permanently sets the high-water mark of `WebAssembly.Memory`. Mitigated by the bump arena and a separate large-allocation path.
- **Cross-instance sharing.** Two wasm modules cannot share linear memory unless one imports the other's `Memory`. The ABI assumes shared memory or a host-mediated copy at the boundary; the JS host arbitrates.

## What to read next

- [`docs/decode-model.md`](decode-model.md) for how generated readers cross the boundary today.
- [`docs/workers.md`](workers.md) for Cloudflare Workers integration.
- [`docs/transports.md`](transports.md) for the RPC transport layer that sits on top of this read/write story.
