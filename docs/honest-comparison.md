# Honest comparison: capnwasm vs capnweb vs REST/JSON

Numbers from in-process Node bench (Apple Silicon, M-series). Run `node bench/rpc_bench.mjs`
and `node bench/realistic.mjs` to reproduce. End-to-end browser numbers will land in
`bench/browser-e2e/` once the harness is in place.

## Where capnwasm wins

| workload | capnwasm | capnweb | REST/JSON | win |
|---|---|---|---|---|
| Burst 1000 calls (per-call) | **2.5 µs** | 7.9 µs | n/a | 3.2x faster than capnweb |
| 64 KB text echo (round-trip) | **96 µs** | 365 µs | n/a | 3.8x faster |
| 4 KB text echo | **17 µs** | 26 µs | n/a | 1.5x faster |
| 256 B text echo | **4.6 µs** | 8.6 µs | n/a | 1.9x faster |
| Single tiny call | **8.5 µs** | 14 µs | n/a | 1.7x faster |
| Wire bytes for 64 KB binary blob | **65.9 KB** | 468 KB | ~88 KB (base64 JSON) | 7x less than capnweb |
| Sparse field access (read 3 of 32) | 26 µs | 26 µs | — | tied |

capnwasm consistently beats capnweb on:
- **Throughput** — once you batch calls (which most apps do), capnwasm pulls 3x ahead.
- **Big payloads** — binary wire skips the base64-in-JSON tax entirely.
- **Wire size** — for binary data of any kind, capnwasm sends the bytes; capnweb base64-encodes.

## Where capnwasm loses

These are real, not handwave-able-away.

### 1. Bundle size: 2.1x larger

| | gzip | brotli |
|---|---|---|
| capnweb | **21 KB** | ~19 KB |
| capnwasm/browser | 44 KB | 41 KB |

40 of those 44 KB is the wasm runtime — a real Cap'n Proto C++ implementation. Hard to shrink further without dropping wire compatibility with non-JS peers.

If your bundle budget is tight and you don't need binary wire interop, **capnweb is the smaller choice**. There is no way for capnwasm to reach 21 KB without giving up the wasm runtime, which is what makes the rest of the wins possible.

### 2. Cold start: ~15x slower in Node

| | init | first call | total time-to-first-result |
|---|---|---|---|
| capnweb | 0.03 ms | 0.16 ms | **0.18 ms** |
| capnwasm | 2.37 ms | 0.35 ms | **2.72 ms** |

In a browser the wasm compile is faster (streaming compile parses bytes during fetch) but it's still measurable on first page load — somewhere in the 5–50 ms range depending on CPU and whether the wasm is already cached.

If you're optimizing for a single first request and nothing else, **capnweb starts replying sooner**. If you make any meaningful number of requests after that, capnwasm catches up and overtakes within milliseconds.

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
