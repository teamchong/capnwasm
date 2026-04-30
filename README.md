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

## Two import paths, your choice

```js
// Default: small JS bundle (~6 KB gzip), wasm fetched separately and cached.
import { CapnCpp } from "capnwasm";
const cpp = await CapnCpp.load("/path/to/capnp_cpp.opt.wasm");

// Single-file: wasm inlined as base64. One fetch, larger bundle.
import { load } from "capnwasm/inlined";
const cpp = await load();
```

Honest size comparison (gzip):

| Path | JS | wasm | total |
|---|---|---|---|
| `capnwasm` (split) | **6 KB** | 39 KB (separate, cacheable, parallel) | 45 KB |
| `capnwasm/inlined` | 54 KB (single file) | — | 54 KB |
| capnweb | 21 KB | — | 21 KB |

The JS-glue alone (6 KB gzip) is smaller than capnweb. The wasm is the
~33 KB bulk because it bundles the full Cap'n Proto + KJ runtime.
Splitting wins for HTTP/2 parallel fetch and long-term caching of the
wasm across app updates; inlining wins for setups that can't ship a
separate `.wasm` asset.

## CLI: `npx capnwasm`

One package, one CLI, library import all share the name:

```bash
npx capnwasm gen user.capnp -o user.gen.mjs   # codegen from .capnp
npx capnwasm gen user.ts    -o user.gen.mjs   # codegen from TS interfaces
npx capnwasm user.capnp                        # shorthand for gen
npx capnwasm build                             # rebuild the wasm
npx capnwasm bench                             # run the Playwright bench
```

The CLI accepts either format. Web devs who don't want to learn the
`.capnp` grammar can just write TypeScript interfaces:

```ts
export interface User {
  // @capnp UInt64
  id: number;
  // @capnp UInt32
  age: number;
  active: boolean;
  name: string;
  email: string;
}
```

Default mapping: `string`→Text, `boolean`→Bool, `bigint`→Int64,
`Uint8Array`→Data, `number`→Float64. Use `// @capnp Type` on the line
above a field to override (typically for integer subtypes). Capitalised
type names that match another `interface` in the same file are treated
as struct references.

Anything outside this subset (methods, generics, mapped types) raises
an explicit error — never silently produces a half-broken reader.

Library import from the same package:
```js
import { CapnCpp } from "capnwasm";
```

`gen` emits a typed reader class per struct. Field access is a normal JS
property — V8-inlinable, no Proxy traps, no string lookup:

```js
import { CapnCpp } from "capnwasm";
import { UserReader, openUser } from "./user.gen.mjs";

const cpp = await CapnCpp.load("/capnp_cpp.opt.wasm");
const reader = openUser(cpp, bytesFromServer);
console.log(reader.id, reader.email);   // direct getter, integer-offset wasm call
```

The generated getters look like:
```js
get id()    { return this._cpp._exports.cpp_any_int64_at(0, 0n); }
get email() { return decodeAscii(/* cpp_any_text_at(1) result */); }
```

Each getter knows its field's offset because the `.capnp` schema told the
codegen at build time. Same wire format as any other Cap'n Proto language
binding — server emits bytes, browser consumes them, schema is the source
of truth.

**Bench (typed schema, 32 named string fields):**

| Workload | cpp wasm | capnweb | result |
|---|---|---|---|
| Encode | 21.6 µs | 13.7 µs | capnweb 1.6x |
| **Decode + read 3 fields** | **1.35 µs** | 2.50 µs | **cpp 1.85x** |
| Decode + read all 32 fields | 11.85 µs | 3.10 µs | capnweb 3.8x |

The lazy-access workload — read few fields out of many — is where Cap'n Proto's
wire format actually delivers, and it does. capnweb pays full `JSON.parse`
either way; we pay parse-once + cheap field walks. The `reader.field0` API
is identical between the two.

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
