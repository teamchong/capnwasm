# capnwasm

Typed RPC for the browser, with a real Cap'n Proto C++ runtime in 38 KB gz (32 KB brotli) for the wasm-only path; **46 KB gz** for the typical typed-proxy + HTTP-batch shape. Talks to non-JS services. Beats capnweb 1.7-3.7× on real workloads, 29× on sequential HTTP-batch calls.

```js
// 1. Write a schema:           user.capnp
//      struct User { id @0 :UInt64; name @1 :Text; email @2 :Text; }

// 2. One CLI command, or a Vite plugin in vite.config.ts:
//      npx capnwasm gen user.capnp

// 3. Use it:
import { load } from "capnwasm";
import { UserBuilder, openUser } from "./user.capnp.gen.mjs";

const cpp = await load();

// JSON.stringify-shaped — pass any JS object whose keys match the schema:
const bytes = UserBuilder.from(cpp, {
  id: 42n,
  name: "Alice",
  email: "alice@example.com",
}).toBytes();                   // binary wire — schema-versioned, no JSON tax

const r = openUser(cpp, bytes);
console.log(r.name);            // "Alice" — read by walking 8 bytes; rest of the message untouched
```

That's the whole core API. Same shape for RPC (`session.callBuilder(IFC, METHOD, BuilderClass)`), REST clients (auto-generated from `@rest` TypeScript interfaces or OpenAPI specs), runtime-schema reads (no codegen needed at all). Three audiences, one toolchain:

- **Cap'n Proto schemas** → typed reader/builder + RPC client/server, wire-compatible with C++/Rust/Go peers
- **TypeScript interfaces with `@rest` directives** → typed `fetch`-based REST client
- **OpenAPI 3.x specs** → typed REST client (works against Stripe, GitHub, anything that publishes a spec)

Real upstream Cap'n Proto C++ is statically compiled to WebAssembly via `zig cc` — no `capnp` binary, no version skew, no `emscripten`. The schema compiler itself runs in wasm, including in the browser.

```bash
npm install capnwasm
```

**Docs:**
[Zero to RPC](docs/zero-to-rpc.md) ·
[Dynamic (no codegen)](docs/dynamic.md) ·
[Cloudflare Workers](docs/workers.md) ·
[API gateway pattern](docs/api-gateway-pattern.md) ·
[Transports (WS / HTTP batch / HTTP stream)](docs/transports.md) ·
[Vite plugin](docs/vite-plugin.md) ·
[DevTools inspector](docs/inspect.md) ·
[Production deployment](docs/deployment.md) ·
[vs gRPC-Web](docs/grpc-web-comparison.md) ·
[vs capnweb](docs/vs-capnweb.md) ·
[Schema truth & conformance](docs/schema-truth-and-conformance.md)

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

**Plus: operation manifest + generated contract test harness** — the same internal model that drives codegen, surfaced as canonical JSON, then chained into a runnable test file that exercises every operation end-to-end:

```bash
# 1) Canonical manifest from any input format
npx capnwasm manifest user.capnp                  # → user.manifest.json

# 2) Generate a Node --test contract harness from it
npx capnwasm harness user.manifest.json --gen ./user.gen.mjs
                                                  # → user.contract.test.mjs

# 3) Run it — capnp methods exercise an in-process mock by default
node --test user.contract.test.mjs
# Or point at a real endpoint:
CAPNWASM_HARNESS_TARGET=ws://staging.example.com/rpc node --test ...
```

The harness asserts each operation is callable and its response decodes against the declared schema — the safety net that catches "you renamed a field and forgot to update an SDK consumer" before code review does. See [Schema truth & conformance](docs/schema-truth-and-conformance.md) for how this fits the broader "schema → all surfaces" pipeline.

---

## What's in the box

All entry-point sizes are minified-then-gzipped (the `dist/` build that ships in the npm package). Picking one transport is the typical browser shape; "everything" pulls every transport for the rare app that wants WS + HTTP-batch + HTTP-stream + postMessage in one bundle.

| | what | gzip | brotli |
|---|---|---|---|
| `import "capnwasm"` | full runtime: capnp wire, RPC, codegen helpers (Node-friendly, single-file, base64-inlined wasm) | 68 KB | 63 KB |
| `import "capnwasm/browser"` | wasm-only path: shim + loader + slim wasm. Read capnp messages, no RPC. | **38 KB** | **32 KB** |
| `+ "capnwasm/rpc"` | adds the RPC layer (sessions, caps, streaming, all wire-conformance handlers) | **43 KB** | **37 KB** |
| `+ "capnwasm/typed" + "capnwasm/http-batch"` | typed proxy + HTTP-batch transport — the typical browser app shape | **46 KB** | **39 KB** |
| All four transports + typed + dynamic | every transport (WS, HTTP-batch, HTTP-stream, postMessage) + typed proxy + dynamic-schema reader | **52 KB** | **44 KB** |
| `import "capnwasm/rest"` | REST client runtime (auth, retries, pagination, ...) | 2.6 KB | 2.4 KB |
| `import "capnwasm/dynamic"` | runtime-schema reader — schema is data, no codegen step ([docs](docs/dynamic.md)) | 3.9 KB | 3.6 KB |
| `import "capnwasm/codegen"` | wasm-built capnp schema compiler — runs in browser | 356 KB | — |
| `import "capnwasm/vite-plugin"` | Vite plugin: schemas regenerate on save, no manual `npx capnwasm gen` ([docs](docs/vite-plugin.md)) | dev-only | dev-only |

Subpath imports also work standalone (`capnwasm/http-batch` alone is 1.3 KB gz, `capnwasm/postmessage` is 0.6 KB) — pull only what you use.

**Wire inspector** for debugging — not bundled in the package, hosted as a single file. Paste this into DevTools when you want to see decoded capnp bytes ([docs](docs/inspect.md)):

```js
const cw = await import("https://teamchong.github.io/capnwasm/inspect.js");
cw.inspect(fetch("/api/user.capnp"));   // expandable tree in the console
```

**Live three-way playground** at [teamchong.github.io/capnwasm](https://teamchong.github.io/capnwasm/) — REST/JSON vs capnweb vs capnwasm side-by-side, fetching the same fixtures and rendering to DOM in your browser. Plus a [WebSocket RPC bench](https://teamchong.github.io/capnwasm/rpc.html) that runs burst, pipelining, and 64 KB binary-echo workloads against a real RPC server (capnwasm wins ~5× on burst). Source in [`web/`](web/) — `cd web && npm run dev` to run it locally.

**End-to-end render bench** at [teamchong.github.io/capnwasm/render-bench.html](https://teamchong.github.io/capnwasm/render-bench.html) — capnweb × capnwasm × WS × HTTP-batch × small/medium/large × cold/warm, all in one page. Measures the full pipeline (request → wire → decode → field reads → DOM mutation → forced layout). **Both libraries win some, lose some**: capnwasm leads on binary blobs and sparse reads, capnweb leads on re-read storms and large-list rendering. The page shows every cell — no averages, no cherry-picking. See [`docs/vs-capnweb.md`](docs/vs-capnweb.md) for the writeup or click through to the live page to run it yourself.

For browsers, prefer `capnwasm/browser`: a tiny JS shim + a separately-fetched 38 KB `dist/capnp.slim.wasm`. No base64 inflation, and `WebAssembly.instantiateStreaming` compiles the wasm while it's still being downloaded. Add `capnwasm/typed` and one transport (`capnwasm/http-batch`, `capnwasm/http-stream`, `capnwasm/postmessage`, or the WS path via `capnwasm/rpc`) for end-to-end RPC at ~46 KB gz total.

For comparison: capnweb is ~21 KB gzip. We're roughly 2× larger because we ship a real Cap'n Proto wasm runtime; that buys us things capnweb structurally can't have (binary wire, zero-copy field access, true sparse-read perf, multi-language interop).

---

## Why this exists / when to choose it

Microsecond per-call differences vanish behind any real network. The cases where capnwasm matters at user-perceived scale:

| workload | capnweb (JSON) | capnwasm (binary) | win |
|---|---|---|---|
| **Decode 1000 records, read 5 fields each** (sparse access) | 20.4 ms | 1.7 ms | **12× faster** |
| **5 MB binary asset** over 10 Mbps link | 5.33 s | 4.00 s | **1.33 s saved per asset** (no base64 bloat) |
| **10K-msg/s telemetry stream decode** | 1.0 M msgs/sec | 3.3 M msgs/sec | **3.2× throughput** |
| **In-process RPC, 64 KB text echo** | 352 µs | 93.5 µs | **3.77× faster** |
| **In-process RPC, 4 KB text echo** | 26.8 µs | 17.2 µs | **1.56× faster** |
| **In-process RPC, 256 B text echo** | 8.05 µs | 4.84 µs | **1.66× faster** |
| **In-process RPC, single tiny call** | 14.17 µs | 7.93 µs | **1.79× faster** |
| **In-process RPC, burst 1000 calls (per-call)** | 7.47 µs | 2.67 µs | **2.80× faster** |
| **HTTP batch, sequential single call** | 1187 µs | 43.8 µs | **27× faster** |
| **HTTP batch, burst of 100 calls** | 19.5 µs | 13.2 µs | **1.48× faster** |

Choose capnwasm when:
- You're moving binary data (images, audio, models, embeddings) and want raw bytes on the wire
- You return more data than the client reads (sparse-access workloads)
- You want one schema language and one codegen toolchain for *both* internal and third-party APIs
- You want wire compatibility with non-JS Cap'n Proto peers (C++/Rust/Go services)

Choose capnweb when:
- Pure JS-to-JS, all-text payloads, and you want the smallest bundle possible
- You don't need wire interop with non-JS peers
- Your hot path is **re-reading** the same payload many times after one fetch (animation loops, framework re-render). capnweb's eager-decode is pure JS reads after the first parse; capnwasm pays a wasm crossing per re-read unless the app caches.

The honest framing — neither is "the winner." Each owns a different region of the workload space. The [end-to-end render bench](https://teamchong.github.io/capnwasm/render-bench.html) puts both libraries side by side across 4 transports × 5 workloads × 3 sizes so you can see exactly which region your traffic falls into.

---

## Three small helpers for the common app shape

The lower-level RPC API is everything you need; these three wrap the most common patterns. [Live chat demo](https://teamchong.github.io/capnwasm/chat.html) uses all three.

```js
import { createClient, subscribeQuery, optimistic } from "capnwasm/client";

// 1. One-line connect — load wasm + open WebSocket + bootstrap.
const { cap } = await createClient("wss://api.example.com/rpc");

// 2. Subscribe to a server-driven stream with an unsubscribe handle.
const sub = subscribeQuery(cap, IFC, METHOD_WATCH, EMPTY_PARAMS);
for await (const chunk of sub.updates) render(decode(chunk));
sub.unsubscribe();   // sends Finish + tears down the iterator

// 3. Apply locally, send to server, revert on failure.
await optimistic({
  apply:  () => state.messages.push(msg),
  send:   () => cap.call(IFC, METHOD_POST, encode(msg)).promise,
  revert: () => state.messages.pop(),
});
```

`subscribeQuery` composes with `AbortSignal` (pass `{ signal }` and either side firing tears the stream down) and `maxQueueSize` (memory cap for slow consumers). `optimistic` swallows `revert()` errors so the original `send()` rejection is what surfaces.

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

## Runtime-schema reader

When the schema is *only* known at runtime — multi-tenant SaaS where each tenant uploads their own schema, admin tools that pretty-print arbitrary Cap'n Proto messages, GraphQL-fragment-shaped data — the codegen path doesn't fit. `capnwasm/dynamic` accepts a schema descriptor as plain data and reads messages without a build step.

```js
import { load } from "capnwasm";
import { defineSchema, openDynamic } from "capnwasm/dynamic";

const cpp = await load();

const User = defineSchema({
  name:   { kind: "text",   slot: 0 },
  email:  { kind: "text",   slot: 1 },
  age:    { kind: "uint32", offset: 0 },
  active: { kind: "bool",   bitOffset: 32 },
});

const reader = openDynamic(cpp, User, bytes);
reader.toObject();              // { name, email, age, active }
reader.pick(["name", "age"]);   // one wasm round trip, only the fields you ask for
reader.fields.email;            // Proxy access for ergonomic single-field reads
```

The descriptor is wire-compatible with what `npx capnwasm gen` emits (`SomeReader._FIELDS`). A build step that strips a generated reader to its `_FIELDS` object can feed it directly to `openDynamic`. Supported field kinds: `text`, `data`, `uint8/16/32`, `int8/16/32`, `int64`, `uint64`, `float32/64`, `bool`, plus `listUint8/16/32/64`, `listInt8/16/32/64`, `listFloat32/64`, `listBool`, `listText`, `listData`, plus `{ kind: "struct", slot, schema }` for nested structs and `{ kind: "listStruct", slot, element }` for lists of structs.

For the write side, pass the struct's wire-format dimensions and use `buildDynamic`:

```js
import { defineSchema, buildDynamic } from "capnwasm/dynamic";

const User = defineSchema({
  id:     { kind: "uint64", offset: 0 },
  active: { kind: "bool",   bitOffset: 64 },
  name:   { kind: "text",   slot: 0 },
}, { dataWords: 2, ptrWords: 1 });

const b = buildDynamic(cpp, User);
b.set("id", 42);
b.set("active", true);
b.set("name", "Alice");
const bytes = b.finalize();   // framed Cap'n Proto bytes, wire-compatible with codegen
```

Builders cover primitives + text + data. Lists and nested-struct builders aren't in this pass — codegen still wins for those write paths.

**How fast?** Bench on Node 22, conformance schema's 13-field Primitives struct, isolated subprocesses (`npm run bench:dynamic`):

```
read all 13 fields           codegen ~476 ns,  dynamic ~531 ns/call    (codegen 1.12× faster)
batched pick(3 fields)       codegen ~489 ns,  dynamic ~443 ns/call    (dynamic 1.10× faster)
build with 13 fields         codegen ~744 ns,  dynamic ~1299 ns/call   (codegen 1.75× faster)
```

Per-field reads: codegen wins because field offsets are baked as integer literals at the call site. Batched `pick(...)` slightly favors dynamic — both paths do the same single wasm boundary call, dynamic's `DynamicReader` constructor allocates one fewer hidden class. Writes: codegen wins by a wider margin because the dynamic builder dispatches by field type for every `set()`. For tenant-uploaded schemas and admin tools, the dynamic path is fast enough — sub-microsecond per field read, ~1.3 µs to build a 13-field struct.

When to choose dynamic:

- **You don't control the schemas at build time** (tenant-supplied schemas, admin tooling)
- **You want to avoid the `npx capnwasm gen` step** in early prototyping
- **You only need a subset of fields** that varies per request — `pick(names)` is one wasm call regardless of which fields you ask for

When to choose codegen instead: stable schemas, hot loops, ergonomic builder API, list/struct/union support.

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
