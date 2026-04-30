# capnwasm follow-ups

Ranked list of work that's been thought about but not done. Captured here so
it survives session-context compaction. **Order is the working priority** —
the user picked cold-start first, then the eight gaps below it in the order
they ranked them.

## 1. Cold-start work — mostly done

**Update (2026-04-30):** big surprise, the dominant cost was the JS loader,
not the wasm. Profiling showed `WebAssembly.compile` + `instantiate` of the
109 KB slim wasm takes only ~0.5 ms in Node. The loader's dispatch was
sitting at ~11 ms because `instanceof Response` triggered Node's lazy undici
init. Switched to duck-typing (`source.arrayBuffer && source.headers`) and
the cold path dropped from ~11 ms to ~0.6 ms. See `js/cpp_loader.mjs`.

Where we are now:
- **Node fresh process**: 0.4 ms import + 0.6 ms load = ~1.0 ms total.
- **Browser empty cache, fresh tab**: 20–25 ms (network + streaming compile).
- **Browser warm code cache**: 2–4 ms.
- **capnweb (Node)**: 1.5 ms import + 0.4 ms first call = ~1.9 ms total.

Node is essentially tied with capnweb. Browser warm reload is close. Browser
empty-cache visit still loses because 109 KB wasm > 21 KB JS over the wire.
That last gap is now a function of bundle size — see follow-up #8.

What's still worth trying if cold start matters more:

- **Smaller wasm**. The leftover 5–10 ms of browser cold start is
  proportional to wasm bytes. See #8.
- **Brotli on the wire** (in addition to gzip). Reduces both transfer time
  and the parse window on slow connections. User-side pattern (HTTP server),
  not a library change, but worth documenting.
- **Pre-warm with `WebAssembly.compile(source)`**. Some apps could
  `await import("./capnp.slim.wasm?compile")` ahead of first use. User-side.

## 2. Dynamic-schema reader (`capnwasm/dynamic`) — done

**Update (2026-04-30):** landed as `js/dynamic.mjs`. Schema is plain data —
the same `_FIELDS` shape codegen emits. `defineSchema()` validates it,
`openDynamic(cpp, schema, bytes)` returns a reader with three access modes:
`pick(names)` (batched, one wasm call), `get(name)` (single field), and a
Proxy-style `reader.fields.name`.

Supported kinds: text, data, uint8/16/32, int8/16/32, int64, uint64,
float32/64, bool. Tests round-trip against the codegen reader for the
conformance schema's Primitives type.

Still a follow-up if anyone needs it: lists and nested structs. The wasm
exposes `cpp_any_enter_struct` and `cpp_any_enter_list_at` already; the JS
wrapper would build on the same descriptor format. ~half a day.

## 3. RPC pipelining is implemented but not pipelined under `await`

The implementation handles `r.cap.call(...)` chained on an unresolved question
(classic pipelining). But sequential user code (`await getUser(); await
getOrders()`) still pays two round-trips because we yield to the microtask
queue between calls.

Real Cap'n Proto pipelining sends both calls in one frame even with an
`await` between them, because the second call only depends on the capability
the first one returns. Needs a `LazyPromise` / `Pipeline` abstraction in the
API surface.

Cost: ~3–4 days. Real win for chained RPC patterns. Probably overkill until
someone writes the use case down.

## 4. DAG batching, not just same-microtask batching

`Promise.all([a(), b(), c()])` already batches into one microtask send.
`await a(); await b()` does not. Some users will hit pattern (1) and be
happy; others will hit pattern (2) and be confused.

Less important than #3. Documentation can paper over it: "use `Promise.all`
for batched calls."

## 5. Streaming response handling — adversarial tests added

**Update (2026-04-30):** added 5 adversarial cases to `test/stream.test.mjs`:
session-closed-mid-stream, client breaks-out-early, concurrent streams,
empty chunks, 500 tiny chunks in order. The first one exposed a real bug —
`RpcSession.close()` didn't reject pending stream iterators, so any
for-await loop running when the session closed would hang forever. Fixed
in `js/rpc.mjs`: close now drains `#streamQuestions` with `session closed`
errors.

Still on the list if anyone uses streams hard:

- **Backpressure**: today the chunk queue is unbounded. A fast server +
  slow client lets memory grow without limit. Needs a high-water mark on
  the queue and a flow-control signal back to the server.
- **Server-side break detection**: when the client breaks out of for-await
  early, the server keeps yielding (the test documents this). A return
  signal from client → server would let the handler stop.
- **Abort signals**: `callStream` has no AbortSignal parameter. Adding one
  would let callers tear down a stream cleanly.

## 6. Capability lifecycle under failure — partly addressed

**Update (2026-04-30):** the immediate hang is fixed. Transport gained an
optional `onClose(cb)` hook; `wsTransport` wires it to ws close + error
events, and `createMemoryTransportPair` propagates close across the pair.
`RpcSession` subscribes and triggers its own `close()`, which now drains
both `#questions` (existing) and `#streamQuestions` (added in #5). Pending
calls and stream iterators reject with `session closed` instead of hanging.

What's still on the list:

- **Explicit `#imports` / `#answers` / `#localCaps` cleanup on close.**
  Today these are left for GC. Memory cost is small but a long-lived
  process that opens and tears down many sessions accumulates the
  per-session FinalizationRegistry registrations until the next major GC.
- **Session-teardown sweep that explicitly fires Release for every still-
  imported cap.** Currently relies on JS GC eventually firing the
  FinalizationRegistry; immediate close-time release would be cleaner.
- **Half-close detection on a slow peer.** `wsTransport` reacts to the
  WebSocket's close/error events; it does not detect a peer that's stopped
  reading our sends but isn't yet closed. A heartbeat / write-stalled
  watchdog would catch that case.

## 7. Documentation gaps

- No "from zero to working RPC" tutorial that walks schema → codegen →
  server → client end-to-end.
- No production-deployment guide (auth integration, backpressure patterns,
  error handling).
- No comparison page to gRPC-Web. People will ask "why not gRPC-Web?" — fair
  question we don't answer.

Cost: each one is half a day. Discoverability + credibility, not technical.

## 8. Bundle-size headline

44 KB gz vs capnweb's 21 KB. Could shave another 5–8 KB by stripping more KJ
debug strings (the data section has assertion expression text), splitting the
WASI shim further, replacing some C++ inner loops with WAT.

Diminishing returns; below ~35 KB there's nothing major to grab without
rewriting the wasm in hand-tuned WAT — a lot of maintenance for a couple of KB.

## 9. CI / publishing automation

No release workflow. `npm publish` is manual, docs site deploy is manual, the
inspector URL is hand-coded. For a serious project this matters; for an
internal-blog-post project it doesn't.

Cost: half a day to wire up GitHub Actions for `npm publish` on tag push and
`web/dist` → GitHub Pages on main push.

---

## Notes for whoever picks this up

- The biggest leverage items are **#1 (cold start)** and **#2 (dynamic
  schema)** — those address real user-visible pain. The rest are quality
  improvements rather than capability gaps.
- **#3 / #4** are interesting but speculative until someone writes a use
  case where they matter.
- **#7 / #9** unlock everything else by making the project legible to people
  who aren't already in the codebase.
- The site at `web/` is the main public surface now — six pages, three
  benches, all reproducible. Any new feature should land with a
  corresponding playground demo or honest comparison row.
