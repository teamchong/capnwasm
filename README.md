# capnwasm

Compile the actual Cap'n Proto C++ library to WebAssembly via `zig cc`
(statically linked, **no emscripten**), and benchmark the result against
Cloudflare's [capnweb](https://github.com/cloudflare/capnweb).

## Build

```
bash cpp/build.sh        # vendor sources + zig c++ -> wasm + wasm-opt -Oz
node bench/runner.mjs    # Playwright bench in headless Chromium
```

Requires:
- `zig` 0.16+ (uses bundled clang 21 + libc++ for `wasm32-wasi-musl`)
- `wasm-opt` (Binaryen)
- `node` + `playwright`
- A sibling clone of `capnweb` and `capnproto` at `../`

## Build pipeline

```
upstream capnproto/c++/src/{kj,capnp}/      # latest from
   │                                          github.com/capnproto/capnproto
   │   capnp compile -oc++ schema.capnp     # generates schema.capnp.{c++,h}
   ▼
cpp/vendor/{kj,capnp}/                       # local patches for wasm32-wasi
   │ + cpp/{schema.capnp,wrapper.cpp,eh_runtime.cpp}
   │
   │   zig c++ -target wasm32-wasi-musl -O3 -fexceptions -fno-rtti
   │           -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN
   │           ... (full flag list in cpp/build.sh)
   ▼
zig-out/capnp_cpp.wasm                       # 3.6 MB  raw output
   │
   │   wasm-opt -Oz --converge --strip-debug --strip-producers
   ▼
zig-out/capnp_cpp.opt.wasm                   #  92 KB  raw  (35 KB gzip)
```

The browser side wires in `js/cpp_wasi_shim.mjs` to satisfy the five WASI
imports the wasm pulls in (`args_get`, `args_sizes_get`, `fd_write`,
`proc_exit`, `fd_close`) — about 30 lines of JS.

## Patches to upstream capnproto

All in `cpp/vendor/`, marked with `__wasi__` / `__wasm__` guards:

- **`kj/exception.c++`** — wrap `printStackTraceOnCrash`, `resetCrashHandlers`,
  and the POSIX `crashHandler` so they no-op on wasm (no signals on the platform).
- **`kj/exception.h`** — define `KJ_RETURN_ADDRESS()` to a null pointer on wasm
  (LLVM doesn't implement `__builtin_return_address` for wasm).
- **`kj/miniposix.h`** — skip `using ::pipe` on wasi (no `pipe()` syscall).
- **`capnp/message.h`** — set `arenaSpacePadding = 19` for wasm (matches the
  Emscripten case; `MutexGuarded<void*>` size differs from glibc).

`cpp/eh_runtime.cpp` provides Itanium ABI exception entry points
(`__cxa_allocate_exception`, `__cxa_throw`, `__cxa_rethrow`,
`__cxa_begin_catch`, `__cxa_end_catch`) since Zig's libc++abi for
`wasm32-wasi-musl` ships `cxa_noexception.o` instead of the throw-capable
variant. Throws end up calling `std::terminate()` — the documented
no-EH-runtime semantics. KJ throws only on malformed input, which terminates
the wasm instance; the JS host catches `proc_exit` from the WASI shim.

## Honest bench result

| Fixture | cpp enc (µs) | cwb enc (µs) | cpp dec (µs) | cwb dec (µs) | cpp wire | cwb wire |
|---|---|---|---|---|---|---|
| small-call | 6.15 | 0.70 | 1.00 | 0.90 | 192 | 68 |
| medium-payload | 9.60 | 3.85 | 11.70 | 2.20 | 3144 | 1720 |
| wide-payload | 139.0 | 60.0 | 194.5 | 63.5 | 60744 | 28464 |
| large-array | 81.0 | 25.5 | 91.0 | 43.0 | 50448 | 10934 |
| **binary-blob** | 62.5 | 9.5 | **9.0** | 31.5 | 65616 | 87409 |
| **deep-pipeline** | 4.45 | 0.95 | **1.15** | 1.45 | 576 | 241 |
| pull | 3.45 | 0.05 | 0.20 | 0.15 | 40 | 12 |
| release | 3.45 | 0.10 | 0.25 | 0.20 | 56 | 17 |

Bundle size: capnp_cpp.opt.wasm is **35 KB gzip** vs capnweb's 21 KB —
**1.68x larger** on the wire.

## Honest conclusions

The original hypothesis was: *real capnproto compiled to wasm should beat
capnweb's pure JS on size and serialize/deserialize speed.* The data
**refutes** this for typical RPC workloads:

- **Size**: capnp_cpp is 1.68x larger than capnweb gzipped. Bundle wars
  punish wasm because the Cap'n Proto + KJ runtime is ≥35 KB, while
  capnweb's JSON wrapper is just 21 KB.
- **Encode speed**: capnp_cpp loses on every fixture. The wasm boundary
  (memory copy + tape walk in JS) plus capnp's general-purpose
  MessageBuilder overhead exceed `JSON.stringify`'s native code path.
- **Decode speed**: capnp_cpp loses on most fixtures. V8's `JSON.parse`
  is exceptionally optimized for the "build a JS object tree" workload.
- **Wins are real but narrow**: capnp_cpp's binary wire format **wins
  on binary-blob decode (3.5x faster)** because it skips the
  base64-roundtrip capnweb requires, and **on deep-pipeline decode
  (1.26x faster)** because Cap'n Proto pointer chasing is cheaper than
  recursive JSON parsing of nested arrays.

Cap'n Proto's actual design strength is **lazy field access from binary
wire format**. The bench's "decode + materialize the whole tree" workload
is the worst case for it. A real-world Cap'n Proto consumer would access
specific fields without paying full materialization — that benchmark is
not yet implemented for the C++ build.
