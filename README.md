# capnwasm

> **When this matters:** you're moving binary data (no base64 tax), doing sparse reads on large payloads, or talking to non-JS services over the Cap'n Proto wire. If your traffic is pure JS-to-JS text and you want the smallest possible bundle, capnweb is the right call.

I built this to learn how Cloudflare's [capnweb](https://github.com/cloudflare/capnweb) works under the hood and to understand the tradeoffs it makes. capnweb deliberately dropped Cap'n Proto's binary wire format to fit a 21 KB JS-only bundle; I wanted to see what the inverse experiment looks like, keep the binary wire and statically compile the upstream Cap'n Proto C++ to wasm, and measure what that costs and what it buys.

The bundle story is **two-tier**:

- **`capnwasm/reader`** (read-only path) — **21.1 KB gzip / 18.0 KB brotli**, slightly smaller than capnweb in both compressions. Use this when your client only consumes capnwasm responses (the common case): `openX()` + `draft()` projections, no message building, no RPC client.
- **`capnwasm` / `capnwasm/browser`** (full path) — **~33 KB gzip / ~28 KB brotli** for wasm + read; **~39 KB / ~33 KB** with RPC; **~41 KB / ~35 KB** for the typical typed-proxy + HTTP-batch shape. Use this when you also build messages, send requests, or open RPC sessions. Full path is ~2× capnweb because you carry a real wasm runtime, the message builder, and the RPC client.

Both points on the curve are valid. The numbers below are findings from this exploration, not a scoreboard.

```js
// 1. Write a schema:           user.capnp
//      struct User { id @0 :UInt64; name @1 :Text; email @2 :Text; }

// 2. One CLI command, or a Vite plugin in vite.config.ts:
//      npx capnwasm gen user.capnp

// 3. Use it:
import { load } from "capnwasm";
import { UserBuilder, openUser } from "./user.capnp.gen.mjs";

const cpp = await load();

// JSON.stringify-shaped. Pass any JS object whose keys match the schema:
const bytes = UserBuilder.from(cpp, {
  id: 42n,
  name: "Alice",
  email: "alice@example.com",
}).toBytes();                   // binary wire. Schema-versioned, no JSON tax

const r = openUser(cpp, bytes);
console.log(r.name);            // "Alice". Read by walking 8 bytes; rest of the message untouched
```

That's the whole core API. Same shape for RPC (`session.callBuilder(IFC, METHOD, BuilderClass)`), REST clients (auto-generated from `@rest` TypeScript interfaces or OpenAPI specs), runtime-schema reads (no codegen needed at all). Three audiences, one toolchain:

- **Cap'n Proto schemas** → typed reader/builder + RPC client/server, wire-compatible with C++/Rust/Go peers
- **TypeScript interfaces with `@rest` directives** → typed `fetch`-based REST client
- **OpenAPI 3.x specs** → typed REST client (works against Stripe, GitHub, anything that publishes a spec)

Real upstream Cap'n Proto C++ is statically compiled to WebAssembly via `zig cc`. No `capnp` binary, no version skew, no `emscripten`. The schema compiler itself runs in wasm, including in the browser.

```bash
pnpm add capnwasm
```

**Docs:**
[Zero to RPC](docs/zero-to-rpc.md) ·
[Dynamic (no codegen)](docs/dynamic.md) ·
[Decode model (how reads actually work)](docs/decode-model.md) ·
[Cloudflare Workers](docs/workers.md) ·
[API gateway pattern](docs/api-gateway-pattern.md) ·
[Transports (WS / HTTP batch / HTTP stream)](docs/transports.md) ·
[Vite plugin](docs/vite-plugin.md) ·
[DevTools inspector](docs/inspect.md) ·
[Production deployment](docs/deployment.md) ·
[vs gRPC-Web](docs/grpc-web-comparison.md) ·
[vs capnweb](docs/vs-capnweb.md) ·
[Schema checks & conformance limits](docs/schema-truth-and-conformance.md) ·
[Notes from the trenches](docs/notes-from-the-trenches.md)

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

> **Reader-only client?** If your client never builds messages or opens RPC sessions, swap `import { load } from "capnwasm"` for `import { load } from "capnwasm/reader"`. Same generated `openUser` works against the smaller `dist/capnp.reader.wasm`. Bundle drops to 21.1 KB gzip / 18.0 KB brotli — slightly under capnweb. Calling `buildUser` against this smaller runtime throws because the builder exports aren't shipped; pick the right entry point for what your code actually does.

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

**Optional: manifest → compatibility diff → contract harness → probe**. The same internal model that drives codegen can also produce checks. This is intentionally modest: it does not prove business behavior is correct. It answers two narrower classes of questions: did the contract change in a way that can break existing generated clients, and does a live runtime still look compatible with the current schema?

```bash
# 1) Canonical manifest from any input format (.capnp, .ts @rest, OpenAPI)
npx capnwasm manifest user.capnp                  # → user.manifest.json

# 2) Compare old/new manifests before release. This produces stable
#    fingerprints plus a breaking/non-breaking changeset.
npx capnwasm compat old.manifest.json user.manifest.json

# 3) Generate a Node --test contract harness from it. Capnp methods run
#    against an in-process mock by default (zero infra); REST methods
#    need CAPNWASM_HARNESS_REST_TARGET=https://... to run.
npx capnwasm harness user.manifest.json --gen ./user.gen.mjs
node --test user.contract.test.mjs

# 4) Probe a live target and write a per-operation report.
#    Exit code 2 when observable drift is found.
npx capnwasm probe user.manifest.json --target ws://staging/rpc \
                                       --rest-target https://staging
```

In plain English, `compat` is the old-contract vs new-contract check: removed operations, changed paths, newly-required params, removed fields, changed field types, and ordinal shifts are reported as breaking; additions are usually non-breaking. `probe` is the current-schema vs current-runtime check: for REST it records status, content-type, observed top-level JSON keys, and missing/extra keys when the manifest has a known object shape; for Cap'n Proto RPC it records call/decode success and which declared result fields were readable. Both are useful for catching drift early, but neither replaces product tests, examples, rollout policy, or human review. See [Schema checks & conformance limits](docs/schema-truth-and-conformance.md) for the longer framing and limits.

---

## What's in the box

All entry-point sizes are minified-then-gzipped (the `dist/` build that ships in the npm package). The reader-only row is the right pick if your client only consumes capnwasm responses (no message building, no RPC sessions); it ships a smaller wasm via `#ifdef CW_READER_ONLY` plus a self-contained JS shim with no LazyReader and a no-op WASI fd_write. Everything below it is the full path with builder + RPC + lazy reader + tape codec.

| | what | gzip | brotli |
|---|---|---|---|
| `import "capnwasm/reader"` | **read-only path**: bundle-size minimum for clients that only project capnwasm responses via `draft()` / per-field getters. No message builder, no RPC client, no lazy reader, no tape codec. **Now slightly smaller than capnweb in both compressions** (capnweb: 21.1 KB gz / 18.1 KB br). | **21.1 KB** | **18.0 KB** |
| `import "capnwasm/browser"` | full wasm path: shim + loader + slim wasm. Read capnp messages and use the dynamic builder, no RPC. **Workers-compatible** when paired with `import wasm from "capnwasm/capnp.slim.wasm"` (Wrangler bundles + precompiles the .wasm). | **33 KB** | **28 KB** |
| `+ "capnwasm/rpc"` | adds the RPC layer (sessions, caps, streaming, all wire-conformance handlers) | **39 KB** | **33 KB** |
| `+ "capnwasm/typed" + "capnwasm/http-batch"` | typed proxy + HTTP-batch transport - the typical browser app shape | **41 KB** | **35 KB** |
| `import "capnwasm"` | full runtime: capnp wire, RPC, codegen helpers (Node-friendly, single-file, brotli+base64-inlined wasm). Requires Chrome 124+ / FF 126+ / Safari 18+ / Node 18+ for `DecompressionStream("brotli")`. Older runtimes: use `capnwasm/browser`. **Not Workers-compatible at runtime** - uses `WebAssembly.compile(bytes)` which Workers blocks (dynamic codegen). | **38 KB** | **36 KB** |
| All four transports + typed + dynamic | every transport (WS, HTTP-batch, HTTP-stream, postMessage) + typed proxy + dynamic-schema reader | **46 KB** | **40 KB** |

The gzip column is what Cloudflare Workers measures against the deploy bundle limit (1 MB Free / 10 MB Paid, per `wrangler deploy`). The brotli column is what modern browsers actually receive over the wire (Cloudflare/Vercel/Netlify all serve `Content-Encoding: br` automatically).
| `import "capnwasm/rest"` | REST client runtime (auth, retries, pagination, ...) | 2.6 KB | 2.4 KB |
| `import "capnwasm/dynamic"` | runtime-schema reader - schema is data, no codegen step ([docs](docs/dynamic.md)) | 3.9 KB | 3.6 KB |
| `import "capnwasm/codegen"` | wasm-built capnp schema compiler - runs in browser | 257 KB | 254 KB |
| `import "capnwasm/vite-plugin"` | Vite plugin: schemas regenerate on save, no manual `npx capnwasm gen` ([docs](docs/vite-plugin.md)) | dev-only | dev-only |

Subpath imports also work standalone (`capnwasm/http-batch` alone is 1.3 KB gz, `capnwasm/postmessage` is 0.6 KB). Pull only what you use.

**Operational add-ons** (each ships as its own subpath; default bundle untouched):

| import | what it does |
|---|---|
| `capnwasm/reconnect` | auto-reopen WebSocket on drop, exp backoff, `onReconnect` hook |
| `capnwasm/router` | gateway dispatches inbound calls by interface ID to backend caps |
| `capnwasm/sturdyref` | persistable cap handles (`save()` / `restore()`); pluggable store |
| `capnwasm/handoff` | three-party handoff: introducer mints token, recipient redeems |
| `capnwasm/pipeline` | batch N dependent calls in one round-trip; optional shape-validator hook |
| `capnwasm/metrics` | in-memory aggregator for `session.onMetric()` events |
| `capnwasm/mcp` | convert a manifest into Anthropic / MCP tool definitions |
| `capnwasm/capnweb-wire` | client that speaks capnweb's JSON wire - drop into existing capnweb deployments |

**Build-time emitters** (Node-only; never imported from browser code, so the slim runtime stays untouched):

| import / CLI | what it does |
|---|---|
| `capnwasm/emit-openapi` / `npx capnwasm emit-openapi` | manifest → canonical OpenAPI 3.x. Round-trip lossless from an OpenAPI source. |
| `capnwasm/emit-capnp` / `npx capnwasm emit-capnp` | manifest → canonical `.capnp`. Hand-off into the upstream capnp generator ecosystem (capnp-rust / -python / -go / -cxx / -java). |
| `capnwasm/emit-agents` / `npx capnwasm emit-agents` | manifest → AGENTS.md / skill.md / llms.txt. |
| `capnwasm/emit-codec` / `npx capnwasm emit-codec` | manifest → JSON ↔ capnp wire-bytes converters per top-level struct. |
| `capnwasm/adapter` / `npx capnwasm adapt` | detect-and-adapt for pagination + error envelopes per operation. |
| `capnwasm/lock` / `npx capnwasm lock` | field-ID / op-ID lock file engine. Pins capnp `@N` ordinals across schema edits. Optional rename detection via `--detect-renames`. |
| `capnwasm/run-pipeline` / `npx capnwasm pipeline` | one-shot manifest → adapt → lock → emit-capnp → emit-openapi → emit-agents driven by `capnwasm.config.json`. |
| `capnwasm/harness/snapshot` / `npx capnwasm harness --replay` | failure-replay snapshots for the contract harness. |
| `capnwasm/manifest.schema.json` | published JSON Schema for the manifest IR. Lets non-JS consumers validate manifests without the runtime. |
| `capnwasm/compat` / `npx capnwasm compat` | manifest fingerprint + conservative breaking/non-breaking changeset between two schema versions. |

**Wire inspector** for debugging. Not bundled in the package, hosted as a single file. Paste this into DevTools when you want to see decoded capnp bytes ([docs](docs/inspect.md)):

```js
const cw = await import("https://teamchong.github.io/capnwasm/inspect.js");
cw.inspect(fetch("/api/user.capnp"));   // expandable tree in the console
```

**Live three-way playground** at [teamchong.github.io/capnwasm](https://teamchong.github.io/capnwasm/). REST/JSON vs capnweb vs capnwasm side-by-side, fetching the same fixtures and rendering to DOM in your browser. Plus a [WebSocket RPC bench](https://teamchong.github.io/capnwasm/rpc.html) that runs burst, pipelining, and 64 KB binary-echo workloads against the same Worker endpoints used after deploy. Source in [`web/`](web/). `pnpm dev` runs the Wrangler-backed local server.

**End-to-end render bench** at [teamchong.github.io/capnwasm/render-bench.html](https://teamchong.github.io/capnwasm/render-bench.html). Capnweb × capnwasm × WS × HTTP-batch × small/medium/large × cold/warm, all in one page. Measures the full pipeline (request → wire → decode → field reads → DOM mutation → forced layout). **Both libraries win some, lose some**: capnwasm leads on binary blobs and sparse reads, capnweb leads on re-read storms and large-list rendering. The page shows every cell. No averages, no cherry-picking. See [`docs/vs-capnweb.md`](docs/vs-capnweb.md) for the writeup or click through to the live page to run it yourself.

For browsers, prefer `capnwasm/browser`: a tiny JS shim + a separately-fetched 33 KB `dist/capnp.slim.wasm`. No base64 inflation, and `WebAssembly.instantiateStreaming` compiles the wasm while it's still being downloaded. Add `capnwasm/typed` and one transport (`capnwasm/http-batch`, `capnwasm/http-stream`, `capnwasm/postmessage`, or the WS path via `capnwasm/rpc`) for end-to-end RPC at ~41 KB gz total.

**On the wire over a brotli-capable host** (Cloudflare Pages/Workers, Vercel, Netlify, AWS CloudFront. They all auto-serve `Content-Encoding: br` to modern browsers):

| | capnwasm | capnweb |
|---|---|---|
| **Read-only client** (consume capnwasm responses, no RPC, no builder) | **18.0 KB br** | 18.1 KB br |
| Decode capnp messages + dynamic builder, no RPC | **28 KB br** | n/a |
| + RPC (sessions, caps, streaming) | **33 KB br** | 18 KB br |
| + typed proxy + HTTP-batch (typical browser app) | **35 KB br** | 18 KB br |

For consume-only clients (the common case) the read path is now a hair *under* capnweb on bytes-on-the-wire — by ~150 bytes, not a meaningful UX delta, but the "wasm RPC libraries are always larger than pure JS" framing no longer holds for the read direction. Apps that also build messages, send requests, or open RPC sessions ship the full path and pay roughly 2× capnweb because they carry a real Cap'n Proto C++ runtime, the message builder, and the RPC client. The extra bytes there buy: binary wire, zero-copy field reads, sparse-access perf, raw bytes for binary blobs (capnweb has to base64-encode → +33% wire bytes per blob), and wire compatibility with C++/Rust/Go peers. Things capnweb structurally can't have.

GitHub Pages / plain nginx without brotli fall back to the gzip column in the table above.

---

## Findings: where each approach wins

These are measurements from the exploration above, not a competition. Microsecond per-call differences vanish behind any real network; what shows up at user-perceived scale are the cases where the binary-wire-plus-wasm approach buys something concrete. The workloads below are where that's true:

| workload | capnweb (JSON) | capnwasm (binary) | win |
|---|---|---|---|
| **Decode 1000 records, read 5 fields each** (sparse access) | 21.6 ms | 1.4 ms | **15.4× faster** |
| **5 MB binary asset** over 10 Mbps link | 5.33 s | 4.00 s | **1.33 s saved per asset** (no base64 bloat) |
| **10K-msg/s telemetry stream decode** (32 fields, read 3) | 1.01 M msgs/sec | 1.67 M msgs/sec | **1.65× throughput** |
| **In-process RPC, 64 KB text echo** | 358 µs | 96.2 µs | **3.72× faster** |
| **In-process RPC, 4 KB text echo** | 27.6 µs | 20.0 µs | **1.38× faster** |
| **In-process RPC, 256 B text echo** | 8.53 µs | 6.51 µs | **1.31× faster** |
| **In-process RPC, single tiny call** | 18.05 µs | 9.22 µs | **1.96× faster** |
| **In-process RPC, burst 1000 calls (per-call)** | 7.26 µs | 2.95 µs | **2.46× faster** |
| **HTTP batch, sequential single call** | 1206 µs | 46.1 µs | **26.2× faster** |
| **HTTP batch, burst of 100 calls** | 18.6 µs | 16.3 µs | **1.14× faster** |
| **HTTP batch, 10 KB string echo (sequential)** | 1210 µs | 63.5 µs | **19.1× faster** |

Choose capnwasm when:
- You're moving binary data (images, audio, models, embeddings) and want raw bytes on the wire
- You return more data than the client reads (sparse-access workloads)
- You want one schema language and one codegen toolchain for *both* internal and third-party APIs
- You want wire compatibility with non-JS Cap'n Proto peers (C++/Rust/Go services)

Choose capnweb when:
- Pure JS-to-JS, all-text payloads, and you want the smallest bundle possible
- You don't need wire interop with non-JS peers
- Your hot path is **re-reading** the same payload many times after one fetch (animation loops, framework re-render). capnweb's eager-decode is pure JS reads after the first parse; capnwasm pays a wasm crossing per re-read unless the app caches.

The honest framing. Neither is "the winner." Each owns a different region of the workload space. The [end-to-end render bench](https://teamchong.github.io/capnwasm/render-bench.html) puts both libraries side by side across 4 transports × 5 workloads × 3 sizes so you can see exactly which region your traffic falls into.

---

## Three small helpers for the common app shape

The lower-level RPC API is everything you need; these three wrap the most common patterns. [Live chat demo](https://teamchong.github.io/capnwasm/chat.html) uses all three.

```js
import { createClient, subscribeQuery, optimistic } from "capnwasm/client";

// 1. One-line connect. Load wasm + open WebSocket + bootstrap.
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

## RPC. Full Cap'n Proto pillars

```js
import { load } from "capnwasm";
import { RpcSession, InterfaceRegistry, connectWebSocket, auth } from "capnwasm/rpc";

const cpp = await load();
// Connect to a server speaking standard Cap'n Proto rpc.capnp wire:
const session = await connectWebSocket(cpp, "wss://api.example.com/rpc");
const root = session.bootstrap();
```

What's there:

- **Zero-copy**. Builder writes directly into the RPC message's arena via `cap.callBuilder(IFC, METHOD, BuilderClass)`; Reader reads directly out of `rpc_reader` via the synchronous-extractor pattern. Single-digit-byte-per-call JS heap allocation regardless of payload size.
- **Promise pipelining**. `r1.cap.call(...)` chains a follow-up onto an unresolved answer. Multiple Calls hit the wire before any Return. Tested at 3-level deep chains.
- **Capability passing**. Handler returns `{ caps: [target] }`; client receives a working `RpcCap` it can call methods on. Round-trip confirmed including `senderHosted` CapDescriptor encoding.
- **Auto-release**. `RpcCap` GC fires `FinalizationRegistry`, sends `Release` to peer, server's `localCaps` shrinks. No leaks.
- **Streaming**. `cap.callStream(...)` returns `AsyncIterable<Uint8Array>`; server registers an async generator handler. Custom STREAM_CHUNK frame extension. Server-push, no per-chunk round-trip.
- **Microtask batching**. Multiple calls fired in the same tick coalesce into one `transport.send` at the next microtask boundary. Always on; the latency cost (≤ one microtask, ~1 µs) is invisible behind any network. Call `session.flush()` to force a send before the boundary if you need it.
- **Nested groups, unions, lists of structs**. Codegen emits typed accessors for all of them.

---

## Runtime-schema reader

When the schema is *only* known at runtime. Multi-tenant SaaS where each tenant uploads their own schema, admin tools that pretty-print arbitrary Cap'n Proto messages, GraphQL-fragment-shaped data. The codegen path doesn't fit. `capnwasm/dynamic` accepts a schema descriptor as plain data and reads messages without a build step.

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

Builders cover primitives + text + data. Lists and nested-struct builders aren't in this pass. Codegen still wins for those write paths.

**How fast?** Bench on Node 22, conformance schema's 13-field Primitives struct, isolated subprocesses (`pnpm bench:dynamic`):

```
read all 13 fields           codegen ~476 ns,  dynamic ~531 ns/call    (codegen 1.12× faster)
batched pick(3 fields)       codegen ~489 ns,  dynamic ~443 ns/call    (dynamic 1.10× faster)
build with 13 fields         codegen ~744 ns,  dynamic ~1299 ns/call   (codegen 1.75× faster)
```

Per-field reads: codegen wins because field offsets are baked as integer literals at the call site. Batched `pick(...)` slightly favors dynamic. Both paths do the same single wasm boundary call, dynamic's `DynamicReader` constructor allocates one fewer hidden class. Writes: codegen wins by a wider margin because the dynamic builder dispatches by field type for every `set()`. For tenant-uploaded schemas and admin tools, the dynamic path is fast enough. Sub-microsecond per field read, ~1.3 µs to build a 13-field struct.

When to choose dynamic:

- **You don't control the schemas at build time** (tenant-supplied schemas, admin tooling)
- **You want to avoid the `npx capnwasm gen` step** in early prototyping
- **You only need a subset of fields** that varies per request. `pick(names)` is one wasm call regardless of which fields you ask for

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

The schema compiler ships as `dist/codegen.mjs` (one file, base64-embedded wasm). All standard schemas (`/capnp/c++.capnp`, `schema.capnp`, etc.) are baked into the wasm binary. Zero host filesystem reads:

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
pnpm dev                     # build web/ and run Wrangler locally at http://127.0.0.1:8787
pnpm test                     # 400+ tests; installs Playwright Chromium on first run if missing
```

Requires:
- `zig` 0.16+ (provides clang 21 + libc++ for `wasm32-wasi-musl`)
- `wasm-opt` (Binaryen)
- `node` 22+ (for `--test`)
- `playwright` (for browser tests; `pnpm test` installs Chromium on first run if missing)

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

MIT (see `LICENSE.txt`).

`cpp/vendor/capnp/` and `cpp/vendor/kj/` are vendored from
[capnproto/capnproto](https://github.com/capnproto/capnproto) and ship inside
the wasm binaries we distribute. That code stays under its original MIT
license; the upstream copyright notice is preserved in `cpp/vendor/LICENSE`.

## Not affiliated

This is an independent personal project. It is **not affiliated with, endorsed
by, or sponsored by** Cloudflare, Inc., the Cap'n Proto project, or any other
organization. The author works at Cloudflare; this repo is unrelated to that
employment and was built on personal time. References to capnweb
(github.com/cloudflare/capnweb) and Cap'n Proto (github.com/capnproto/capnproto)
are made because those projects are public, MIT-licensed, and the natural
points of comparison; nothing in this repo represents Cloudflare or speaks for
it. Bug reports, feature requests, and pull requests should be filed against
this repository, not against either upstream.
