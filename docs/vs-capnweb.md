# capnwasm vs capnweb vs REST/JSON

Numbers from in-process Node bench (Apple Silicon, M-series, Node 22). Run `node bench/rpc_bench.mjs`, `node bench/realistic.mjs`, and `node bench/http_batch_bench.mjs` to reproduce. Last refreshed 2026-04-30 against capnweb HEAD checked out at `../capnweb`.

## Where capnwasm wins (WebSocket, in-process)

5-run medians.

| workload | capnwasm | capnweb | win |
|---|---|---|---|
| Burst 1000 calls (per-call) | **2.67 µs** | 7.4 µs | 2.8× faster |
| Burst 100 calls (per-call) | **2.97 µs** | 6.8 µs | 2.3× faster |
| 64 KB text echo (round-trip) | **90 µs** | 362 µs | 4.0× faster |
| 4 KB text echo | **17.9 µs** | 26 µs | 1.5× faster |
| 256 B text echo | **5.1 µs** | 8.2 µs | 1.6× faster |
| 16 B text echo | **6.6 µs** | 8.2 µs | 1.2× faster |
| Single tiny call (u8 echo) | **8.3 µs** | 14 µs | 1.7× faster |
| Wire bytes, 64 KB binary blob | **65.9 KB** | 468 KB | 7.1× smaller |
| Wire bytes, 4 KB text | **4.5 KB** | 8.3 KB | 1.9× smaller |
| Sparse field access (read 3 of 32) | 27 µs | 26 µs | tied (within noise) |
| Cap-passing (`getChild` + echo) | 13 µs | 12 µs | capnweb 1.1× faster |

**This pass shaved 32% off tiny-call latency.** The compounding boundary-call reductions (cached DataView per session, combined `cpp_rpc_decode` + per-kind summary write, cached aux pointers, `cpp_rpc_begin_call/begin_return` returning the data section pointer instead of just success, empty-params Call frame template caching keyed on (target, ifc, method)) dropped per-RPC wasm crossings from ~9 to ~5. Burst N=1000 dropped 7%. The remaining floor on tight loops is dominated by JS-side Promise scheduling — past microsecond cuts there require either an awaitable-batch API change or skipping `async` framing on sync-handler dispatch.

capnwasm consistently beats capnweb on:
- **Throughput** — once you batch calls (which most apps do), capnwasm pulls 2-3× ahead.
- **Big payloads** — binary wire skips the base64-in-JSON tax entirely.
- **Wire size** — for binary data of any kind, capnwasm sends the bytes; capnweb base64-encodes.

capnweb wins or ties on:
- **Cap-passing fast path** — ~5% slower in capnwasm. Doesn't matter unless you're chaining caps deep.
- **Sparse field access** — within noise.

## Where capnwasm wins (HTTP batch transport)

| workload | capnwasm | capnweb | win |
|---|---|---|---|
| Single sequential call (tiny) | **44 µs** | 1310 µs | **30× faster** |
| 10 KB string echo (sequential) | **67 µs** | 1330 µs | **20× faster** |
| Burst of 100 calls in 1 tick | **18 µs** | 20 µs | 1.13× faster |

The 29× sequential gap is structural, not implementation: capnweb's `BatchClientTransport` waits for a `setTimeout(0)` macrotask before sending so multiple in-tick calls coalesce into one POST. That gives every sequential `await` ~1 ms of macrotask delay before any bytes hit the wire. capnwasm uses `queueMicrotask`, so a single `await` round-trips fast. Burst workloads amortize the macrotask cost — that's the regime where capnweb catches up.

## Where capnwasm loses

These are real, not handwave-able-away.

### 1. Bundle size: 2.0–2.6× larger depending on what you import

All sizes minified-then-gzipped (the `dist/` build that ships in npm).

| scenario | capnweb | capnwasm | ratio |
|---|---|---|---|
| Whole library, RPC-ready | **21 KB** (everything in `dist/index.js`) | — | — |
| Wasm runtime only (read capnp messages) | n/a | **38 KB** | — |
| WebSocket RPC (transport + sessions + caps) | **21 KB** | **43 KB** | 2.0× |
| Typed proxy + HTTP-batch transport (typical browser shape) | **21 KB** | **46 KB** | 2.2× |
| All four transports + typed + dynamic | **21 KB** | **52 KB** | 2.5× |

38 KB of every capnwasm scenario is the wasm runtime — a real Cap'n Proto C++ implementation. The JS code itself is small after minification (rpc.mjs is 5.2 KB gz, each transport is 0.6–1.5 KB gz, the typed proxy is 1 KB). The slim browser wasm dropped 3 KB by moving the tape codec (used only by `capnwasm/tape`, the capnweb-shape compatibility layer) out of the production build.

If your bundle budget is tight and you don't need binary wire interop, **capnweb is the smaller choice**. There is no way for capnwasm to reach 21 KB without giving up the wasm runtime, which is what makes the rest of the wins possible.

### 2. Cold start: now essentially tied in Node, still slower in the browser

Time-to-first-result, fresh Node 22 process, mean of 8 runs.

| | import | load (compile + link) | total |
|---|---|---|---|
| capnweb | 1.5 ms | 0.4 ms | **1.9 ms** |
| capnwasm (inlined bundle) | 1.0 ms | 0.8 ms | **1.8 ms** |
| capnwasm (slim, separate wasm) | 0.4 ms | 0.6 ms | **1.0 ms** |

Earlier releases pegged capnwasm's init at ~11 ms because the loader did `instanceof Response`, which lazy-initializes Node's built-in undici fetch (~10 ms). The fix is duck-typing: never reach for `Response` unless the source is clearly a URL/string.

Browser is a different story. With an empty HTTP cache the first visit pays network + streaming compile — about **20–25 ms** on a desktop with localhost-served wasm; warm reloads (V8 code-cache hit) drop to **2–4 ms**. capnweb's 21 KB JS parses in ~1–3 ms either way. So on a fresh tab capnwasm is still measurably slower because the wasm bytes are larger; once the bundle is cached, the gap is small.

If you're optimizing for a single first request from an empty browser cache, **capnweb starts replying sooner**. In Node, in long-running processes, or after the first cache hit in the browser, the cold-start gap is gone.

### 3. Schema friction

capnwasm requires a Cap'n Proto schema — even when generating a TypeScript-only client you go through `npx capnwasm gen`. capnweb works on arbitrary JS values: you call methods, JSON-shaped data goes over the wire, no schema step.

If you control both ends and never want to define a schema, **capnweb is friction-free**. If you want types, IDE completion, wire-format stability across versions, and interop with C++/Rust/Go peers, the schema is the price you pay for that.

### 4. Cap-passing micro-overhead

| | capnwasm | capnweb |
|---|---|---|
| `getChild → call` round-trip | 13 µs | 12 µs |

Roughly tied — capnwasm is ~5% slower on the cap-passing fast path. Doesn't matter unless you're doing very deep cap chains; both are dominated by network RTT in any real deployment.

### 5. Single-call latency over real network: invisible

The 8.5 µs vs 14 µs gap on tiny calls only matters if the network adds < 5 µs of latency, which essentially never happens. Over a real WebSocket on the same continent (typically 5–50 ms RTT), you cannot tell capnwasm and capnweb apart on a single tiny call.

The win shows up in **bursts** (parallel calls) and **payload size** (decode/encode work).

## API ergonomics

Both libraries support a typed-method-proxy pattern. The shape:

```js
// capnweb
import { newHttpBatchRpcSession } from "capnweb";
const api = newHttpBatchRpcSession<MyApi>("https://api.example.com/rpc");
const r = await api.someMethod({ arg: 1 });

// capnwasm (with typedClient)
import { typedClient } from "capnwasm/typed";
import { MyApi_INTERFACE } from "./my_api.gen.mjs";
const api = await typedClient("https://api.example.com/rpc", MyApi_INTERFACE);
const r = await api.someMethod({ arg: 1 });
```

Two lines either way. The differences:

- **capnweb gets types from a TypeScript generic** — your `MyApi` interface is a TS type that lives only in source.
- **capnwasm gets types from codegen output** — `MyApi_INTERFACE` is a real runtime value emitted from your `.capnp` schema by `npx capnwasm gen`. The same schema is portable to other Cap'n Proto implementations (C++, Rust, Go, Python, …).

If your stack is JS-only and the schema is "whatever shape my methods happen to have," capnweb's TS-generic approach is more direct. If your schema is a contract that other languages need to consume, capnwasm's codegen artifact is the lever.

## Transport coverage

| transport | capnweb | capnwasm |
|---|---|---|
| WebSocket | yes | yes |
| HTTP batch (request/response, stateless) | yes | yes (`capnwasm/http-batch`) |
| HTTP streaming (server-push response body) | yes | yes (`capnwasm/http-stream`) |
| postMessage / MessageChannel | yes | yes (`capnwasm/postmessage`) |

The two HTTP transports cover the most common Worker shapes:

- **HTTP batch** is for stateless RPC: each request is a fresh server-side session, the response is a batch of frames, then teardown. Cheaper Worker billing (no idle WebSocket connection), no upgrade dance, plays with HTTP/2 multiplexing. Use this when the browser is making request/response calls with no need for server push.
- **HTTP streaming** is for server push: client posts an initial batch, server keeps the response body open and streams subsequent frames as length-prefixed binary chunks. Use this for subscriptions, capability streams, and progress feeds. Limitation: this transport is one-shot client→server (after the initial POST, additional client→server calls require a new POST) — fetch upload streaming is HTTP/2-only and isn't reliable across browsers.

For full bidirectional, long-lived RPC where either side can initiate, use WebSocket.

## Where REST/JSON loses to both

For completeness — neither library is competing with raw `fetch()` on the protocol axis, but it's worth showing what JSON-without-RPC costs:

- **No type safety** without runtime validation (zod/ajv etc)
- **No bidirectional streaming** without inventing your own protocol
- **No capability passing** — every request needs an auth token
- **No promise pipelining** — sequential awaits cost you N round-trips
- **Bytes**: 64 KB binary becomes ~88 KB after base64 + JSON escaping

If your app fits inside "fetch some data, render it, occasionally POST" then plain REST is fine and probably what you should use. Both capnweb and capnwasm are for apps that need RPC semantics — capability-secure objects, pipelining, streaming, wire-compatible types.

## When to choose what

**Choose REST/JSON when:**
- Your app is request/response only, no real-time state
- Your team knows REST and the docs/tooling matter more than the wire
- You're integrating with a third-party API that publishes OpenAPI/Swagger

**Choose capnweb when:**
- Pure JS-to-JS, all-text-shaped payloads
- You want the smallest possible bundle (21 KB gz)
- You don't need wire interop with non-JS peers
- Schema friction is a deal-breaker

**Choose capnwasm when:**
- You're moving binary data (images, audio, ML models, embeddings)
- You sustain many concurrent calls (capnwasm pulls 3x ahead under burst)
- Payloads are routinely > 1 KB (binary wire crushes JSON for any non-trivial size)
- You want one schema language and one codegen toolchain for both internal and third-party APIs
- You need wire compatibility with C++/Rust/Go services
- You can absorb the 23 KB extra bundle and 5–50 ms first-load cost

## Methodology / reproducibility

- In-process numbers: `node bench/rpc_bench.mjs` and `node bench/realistic.mjs`
- Both use a paired in-memory transport, same workload runner.
- "vs capnweb" assumes capnweb is checked out at `../capnweb` (sibling repo).
- All wins reported are median of multiple runs; outliers from GC pauses excluded.
- Bundle sizes measured on `dist/inlined.mjs` (capnwasm) and `../capnweb/dist/index.js`
  (capnweb) post-gzip-9.

End-to-end browser numbers (fetch → decode → render to DOM) are forthcoming in
`bench/browser-e2e/` — those are the numbers that matter for actual browser apps.
