# capnwasm

**One typed-client toolchain for any backend** — write or import a schema, get a fast typed client back.

- Cap'n Proto schemas → zero-copy typed reader/builder + RPC client/server
- TypeScript interfaces with `@rest` directives → typed REST client
- OpenAPI 3.x specs → typed REST client (works against Stripe, GitHub, anything that publishes a spec)

Real upstream Cap'n Proto C++ is statically compiled to WebAssembly via `zig cc`. The schema *compiler* is also wasm — no `capnp` binary, no version skew, no `emscripten`.

```bash
npm install capnwasm
```

```js
import { load } from "capnwasm";       // runtime (capnp wire + RPC)
import { auth } from "capnwasm/rest";  // REST client runtime
```

---

## Three quickstarts

**1. Cap'n Proto schema → typed JS reader/builder**

```bash
npx capnwasm gen user.capnp -o user.gen.mjs
```
```js
import { load } from "capnwasm";
import { openUser, buildUser } from "./user.gen.mjs";
const cpp = await load();

const b = buildUser(cpp);
b.id = 42n; b.name = "Alice";
const bytes = b.toBytes();

const r = openUser(cpp, bytes);
console.log(r.id, r.name);   // typed getters; V8-inlinable
```

**2. TypeScript interface → typed REST client (your own backend)**

```ts
// my_api.ts
interface User { id: number; name: string; }
interface CreateUserParams { name: string; }

// @rest baseUrl=https://api.myservice.com
// @auth bearer
interface MyAPI {
  // @get /users/{id}
  getUser(id: number): Promise<User>;

  // @post /users
  // @body body
  createUser(body: CreateUserParams): Promise<User>;
}
```
```bash
npx capnwasm gen my_api.ts -o my_api.gen.mjs
```
```js
import { createMyAPIClient } from "./my_api.gen.mjs";
import { auth } from "capnwasm/rest";
const api = createMyAPIClient({ auth: auth.bearer(token) });
const u = await api.getUser(42);
```

**3. OpenAPI 3.x spec → typed REST client (any third-party API)**

```bash
npx capnwasm openapi stripe.yaml -o stripe.gen.mjs
```
```js
import { createStripeClient } from "./stripe.gen.mjs";
import { auth } from "capnwasm/rest";
const stripe = createStripeClient({ auth: auth.bearer(STRIPE_KEY) });
const charge = await stripe.retrieveCharge("ch_abc123");
for await (const event of stripe.listEvents()) console.log(event.id);
```

---

## What's in the box

| | what | gzip | brotli |
|---|---|---|---|
| `import "capnwasm"` | full runtime: capnp wire, RPC, codegen helpers (Node-friendly, single-file, base64-inlined wasm) | 68 KB | 63 KB |
| `import "capnwasm/browser"` | **browser-optimized: tiny JS shim + wasm fetched as a separate asset (streaming compile)** | **44 KB** | **41 KB** |
| `import "capnwasm/rest"` | REST client runtime (auth, retries, pagination, ...) | small | small |
| `import "capnwasm/rpc"` | full RPC layer (sessions, caps, streaming) | small | small |
| `import "capnwasm/tape"` | optional capnweb-shape `serialize`/`deserialize` helpers | small | small |
| `import "capnwasm/codegen"` | wasm-built capnp schema compiler — runs in browser | 356 KB | — |
| `import "capnwasm/stream"` | helper to stream `fetch` bytes straight into wasm | small | small |

For browsers, prefer `capnwasm/browser`: 44 KB gzip / 41 KB brotli (counting both the JS shim and the separately-fetched `dist/capnp.slim.wasm`, which excludes the bench/test helpers baked into the default wasm). Without the 33% base64 inflation, and with `WebAssembly.instantiateStreaming` so the wasm starts compiling while it's still being downloaded.

For comparison: capnweb is ~21 KB gzip. We're roughly 2x larger because we ship a real Cap'n Proto wasm runtime; that buys us things capnweb structurally can't have (binary wire, zero-copy field access, true sparse-read perf).

---

## Why this exists / when to choose it

Microsecond per-call differences vanish behind any real network. The cases where capnwasm matters at user-perceived scale:

| workload | capnweb (JSON) | capnwasm (binary) | win |
|---|---|---|---|
| **Decode 1000 records, read 5 fields each** (sparse access) | 20.4 ms | 1.7 ms | **12x faster** |
| **5 MB binary asset** over 10 Mbps link | 5.33 s | 4.00 s | **1.33 s saved per asset** (no base64 bloat) |
| **10K-msg/s telemetry stream decode** | 1.0 M msgs/sec | 3.3 M msgs/sec | **3.2x throughput** |
| **In-process RPC, 64 KB text echo** | 365 µs | 96 µs | **3.8x faster** |
| **In-process RPC, 4 KB text echo** | 26 µs | 17 µs | **1.5x faster** |
| **In-process RPC, single tiny call** | 15 µs | 8.5 µs | **1.75x faster** |
| **In-process RPC, burst 1000 calls (per-call)** | 7.9 µs | 2.5 µs | **3.2x faster** |

Choose capnwasm when:
- You're moving binary data (images, audio, models, embeddings) and want raw bytes on the wire
- You return more data than the client reads (sparse-access workloads)
- You want one schema language and one codegen toolchain for *both* internal and third-party APIs
- You want wire compatibility with non-JS Cap'n Proto peers (C++/Rust/Go services)

Choose capnweb when:
- Pure JS-to-JS, all-text payloads, and you want the smallest bundle possible
- You don't need wire interop with non-JS peers

---

## RPC — full Cap'n Proto pillars

```js
import { load } from "capnwasm";
import { RpcSession, InterfaceRegistry, connectWebSocket, auth } from "capnwasm/rpc";

const cpp = await load();
// Connect to a server speaking standard Cap'n Proto rpc.capnp wire:
const session = await connectWebSocket(cpp, "wss://api.example.com/rpc");
const root = session.bootstrap();
```

What's there:

- **Zero-copy** — Builder writes directly into the RPC message's arena via `cap.callBuilder(IFC, METHOD, BuilderClass)`; Reader reads directly out of `rpc_reader` via the synchronous-extractor pattern. Single-digit-byte-per-call JS heap allocation regardless of payload size.
- **Promise pipelining** — `r1.cap.call(...)` chains a follow-up onto an unresolved answer. Multiple Calls hit the wire before any Return. Tested at 3-level deep chains.
- **Capability passing** — handler returns `{ caps: [target] }`; client receives a working `RpcCap` it can call methods on. Round-trip confirmed including `senderHosted` CapDescriptor encoding.
- **Auto-release** — `RpcCap` GC fires `FinalizationRegistry`, sends `Release` to peer, server's `localCaps` shrinks. No leaks.
- **Streaming** — `cap.callStream(...)` returns `AsyncIterable<Uint8Array>`; server registers an async generator handler. Custom STREAM_CHUNK frame extension — server-push, no per-chunk round-trip.
- **Microtask batching** — multiple calls fired in the same tick coalesce into one `transport.send` at the next microtask boundary. Always on; the latency cost (≤ one microtask, ~1 µs) is invisible behind any network. Call `session.flush()` to force a send before the boundary if you need it.
- **Nested groups, unions, lists of structs** — codegen emits typed accessors for all of them.

---

## REST runtime details

The generated REST clients run on `js/rest_runtime.mjs`:

- All HTTP methods, path/query/header parameters
- Bodies: JSON, multipart, form-encoded, raw
- Auth: `auth.bearer(token)`, `auth.apiKey(key, {in:"header"|"query", name})`, `auth.basic(u, p)`, `auth.custom(applyFn)`
- Retries with configurable exponential/linear backoff + Retry-After honoring
- Cancellation via AbortSignal (composes with timeout)
- `RestError` typed exception with status, parsed body, response headers
- Async iterable pagination (cursor- or page-based)
- Request/response/error interceptors
- Auto Content-Type + content negotiation

---

## Browser-side codegen

The schema compiler ships as `dist/codegen.mjs` (one file, base64-embedded wasm). All standard schemas (`/capnp/c++.capnp`, `schema.capnp`, etc.) are baked into the wasm binary — zero host filesystem reads:

```js
import { CapnpCompiler } from "capnwasm/codegen";
const cc = await CapnpCompiler.load();
const model = await cc.compileToModel("user.capnp", schemaSource);
```

Verified end-to-end via headless Chromium tests.

---

## Build from source

```bash
bash cpp/build.sh             # builds runtime wasm + dist/inlined.mjs (full + slim)
bash cpp/build_capnpc.sh      # builds compiler wasm
node js/build_codegen_inlined.mjs   # builds dist/codegen.mjs (inlined compiler)
npm test                      # 77 tests across runtime, RPC, REST, OpenAPI, browser
```

Requires:
- `zig` 0.16+ (provides clang 21 + libc++ for `wasm32-wasi-musl`)
- `wasm-opt` (Binaryen)
- `node` 22+ (for `--test`)
- `playwright` (for the browser tests)

For development against capnweb comparison benches, also needs sibling clones of `../capnweb` and `../capnproto`.

---

## Architecture

```
.capnp / .ts / OpenAPI yaml
        │
        ▼
   bin/capnwasm.mjs (CLI)
        │
        ├─ .capnp ──→ dist/codegen.mjs (wasm-built capnp schema compiler)
        │                   ↓
        │              CodeGeneratorRequest (Cap'n Proto bytes)
        │                   ↓
        │              JS walker → struct model → emit typed Reader/Builder
        │
        ├─ .ts (capnp interfaces) ──→ JS parser → struct model → emit
        │
        ├─ .ts (REST interfaces) ──→ method+type model → emit fetch-based client
        │
        └─ OpenAPI yaml/json ──→ openapi parser → method+type model → same path
                                                            ↓
                                              dist/inlined.mjs (capnp runtime)
                                              + js/rest_runtime.mjs
                                              + js/rpc.mjs
                                              + ...
```

All wasm modules are built from one vendored copy of Cap'n Proto's C++ source tree (`cpp/vendor/capnp/`). Runtime and compiler can never disagree about wire format.

---

## License

MIT.
