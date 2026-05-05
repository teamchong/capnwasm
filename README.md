# capnwasm

Real Cap'n Proto C++ compiled to WebAssembly, with generated JS readers and builders that read and write directly out of `WebAssembly.Memory`. JS sees the message bytes through `DataView` over `memory.buffer`; C++ sees them through raw pointers. The bytes live once.

> **Production-readiness:** capnwasm is **not production-ready yet**. The 0.0.x stream ships the safe-by-default reader path, the 32-slot reader pool, explicit lifetime APIs, the pure-JS pointer decoder for Text / Data / primitive lists / `List<Struct>`, the per-instance bump arena, and a hostile-input fuzz pass. What it doesn't yet have: a public foreign-language ABI, large-message streaming, and the broader hardening that 0.1.0 would need. Use it for experiments and benchmarks, not for shipping things you can't tolerate breaking.

## Quickstart

```bash
pnpm add capnwasm
```

```capnp
# user.capnp
struct User {
  id    @0 :UInt64;
  name  @1 :Text;
  email @2 :Text;
}
```

```bash
npx capnwasm gen user.capnp -o user.gen.mjs
```

```js
import { load } from "capnwasm";
import { buildUser, openUser } from "./user.gen.mjs";

const cpp = await load();

const bytes = buildUser(cpp).fromObject({
  id: 42n, name: "Alice", email: "alice@example.com",
}).toBytes();

using r = openUser(cpp, bytes);     // TC39 `using` (Node 22+, Chrome 134+, Safari 18.4+)
console.log(r.name);                // "Alice" — read directly from WebAssembly.Memory
```

`openUser` acquires a wasm reader slot and copies the bytes into linear memory once. Field reads then go through one of two paths:

- **Primitives + Text + Data + primitive lists + `List<Struct>`**: pure JS, via `DataView` over `cpp.memory.buffer`. No wasm boundary call.
- **Multi-segment / FAR pointers / capabilities**: opened by the upstream Cap'n Proto C++ runtime via `FlatArrayMessageReader`. JS fast paths apply inside segment 0; cross-segment / FAR cases automatically fall back to C++.

`using` runs the reader's `dispose` at scope exit. On older runtimes, call `r.dispose()` explicitly or use `withReader(cpp, bytes, openUser, (r) => ...)`.

Prior art: [WebAssembly/design#1274](https://github.com/WebAssembly/design/issues/1274) proposed Cap'n Proto as the inter-language binding format for wasm and went dormant. capnwasm is one execution of the same idea, scoped narrowly to JS↔C++-in-wasm.

## Size

Numbers are minified-then-compressed. The `gzip` column is what Cloudflare Workers measures against the deploy bundle limit; the `brotli` column is what modern browsers receive over the wire on Cloudflare / Vercel / Netlify.

| import                              | gzip   | brotli |
|---|---|---|
| `capnwasm`                          | 38 KB  | 36 KB  |
| `capnwasm/browser`                  | 33 KB  | 28 KB  |
| `+ capnwasm/rpc`                    | 39 KB  | 33 KB  |
| `+ capnwasm/typed + capnwasm/http-batch` | 41 KB | 35 KB  |

`capnwasm` is the Node-friendly single-file inlined bundle. `capnwasm/browser` loads the slim wasm via `WebAssembly.instantiateStreaming` against a separately-fetched `dist/capnp.slim.wasm`; this is the entry point Cloudflare Workers use (the inlined bundle relies on `WebAssembly.compile(bytes)`, which Workers blocks).

## Performance

Honest read of where capnwasm wins, where it loses, where it ties:

- **Sparse access (read 5 fields out of 256)**: capnwasm is ~49× faster than `JSON.parse` because Cap'n Proto reads only the fields you ask for; JSON.parse decodes the whole document either way.
- **Binary blobs**: capnwasm is ~6× faster on a 32 KB blob round-trip. JSON.parse pays decode + base64-decode; capnwasm hands back a `Uint8Array.slice` of `WebAssembly.Memory`.
- **List and dense full-iteration**: capnwasm runs at ~83-85% of `JSON.parse` speed. V8's internal C++ JSON parser is heavily optimized for parse-then-iterate-arrays; capnwasm pays a per-row reader allocation but offsets it with typed-array reads on primitive fields (~1 ns vs DataView's ~7 ns).
- **Small flat structs**: `JSON.parse` wins by ~2×. On a single 80-byte payload, slot-pool open/dispose overhead exceeds the parse savings.
- **Wire bytes**: capnwasm is ~25% smaller than JSON on text-heavy shapes and 33% smaller on binary blobs (no base64 inflation).

Reproducible Node-side bench: `node bench/m8_attribution.mjs`. Numbers and analysis live in [`docs/vs-capnweb.md`](docs/vs-capnweb.md). The browser-side end-to-end bench is at [capnwasm.teamchong.net/render-bench](https://capnwasm.teamchong.net/render-bench).

## When to use capnwasm

- You're moving binary data (images, audio, embeddings) and want raw bytes on the wire.
- You return more data than the client reads (sparse access wins clearly).
- You want runtime-schema reads as a first-class option (`capnwasm/dynamic`).

## When *not* to use capnwasm

- Pure JS-to-JS, all-text payloads, smallest-bundle priority. [capnweb](https://github.com/cloudflare/capnweb) is the better fit at 18 KB brotli.
- Your hot path is "parse once, iterate every field of every row." JSON.parse-then-iterate is V8-native and ~20% faster on that shape than capnwasm's lazy-decode model.
- You want a battle-tested, production-ready library today. capnwasm isn't there yet.

## Build from source

```bash
bash cpp/build.sh    # builds runtime wasm + dist/inlined.mjs
pnpm test            # 540+ tests, including a 10k-iteration hostile-input fuzz
node bench/m8_attribution.mjs   # bench
```

Requires `zig` 0.16+ (provides clang 21 + libc++ for `wasm32-wasi-musl`), `wasm-opt` (Binaryen), Node 22+.

## License

MIT (see `LICENSE.txt`).

`cpp/vendor/capnp/` and `cpp/vendor/kj/` are vendored from [capnproto/capnproto](https://github.com/capnproto/capnproto) and ship inside the wasm binaries. That code stays under its original MIT license; the upstream copyright is preserved in `cpp/vendor/LICENSE`.

## Not affiliated

This is an independent personal project. It is **not affiliated with, endorsed by, or sponsored by** Cloudflare, Inc., the Cap'n Proto project, or any other organization. The author works at Cloudflare; this repo is unrelated to that employment and was built on personal time. References to capnweb and Cap'n Proto are made because those projects are public, MIT-licensed, and the natural points of comparison; nothing in this repo represents Cloudflare or speaks for it. Bug reports, feature requests, and pull requests should be filed against this repository, not against either upstream.
