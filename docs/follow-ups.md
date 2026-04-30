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

**Update (2026-04-30):** AbortSignal support landed for `call`,
`callBuilder.send`, and `callStream`. Pass `{ signal }` and on abort the
deferred/iterator rejects with `signal.reason` and a Finish frame is
dispatched (best-effort). Six tests in `test/rpc.test.mjs` cover both the
pre-aborted and mid-call paths. Same fix surfaced and patched a latent
unhandled-rejection on session close: bootstrap's internal deferred is
never directly awaited, so its rejection on close was leaking. Added a
defensive no-op `catch` in `RpcSession.close()`.

**Update (2026-04-30, third pass):** added `{ maxQueueSize }` option to
`callStream`. Default is unbounded for back-compat. When set, a queue
that grows past the cap ends the iterator with `stream queue overflow`
and clears buffered chunks — a memory safety valve for slow consumers.
Surfaced and fixed a related bug: a natural late StreamEnd was clobbering
an earlier failure (e.g., the overflow), so the iterator looked like it
completed cleanly. `end()` is now idempotent — first call wins.

Still on the list if anyone uses streams hard:

- **True flow control**: per-stream credits/window so the server doesn't
  send chunks the client can't keep up with. Needs a wire protocol
  extension. The bounded queue above is a safety valve, not flow control.
- **Server-side break detection**: when the client breaks out of for-await
  early, the server keeps yielding (the test documents this). A return
  signal from client → server would let the handler stop.

## 6. Capability lifecycle under failure — partly addressed

**Update (2026-04-30):** the immediate hang is fixed. Transport gained an
optional `onClose(cb)` hook; `wsTransport` wires it to ws close + error
events, and `createMemoryTransportPair` propagates close across the pair.
`RpcSession` subscribes and triggers its own `close()`, which now drains
both `#questions` (existing) and `#streamQuestions` (added in #5). Pending
calls and stream iterators reject with `session closed` instead of hanging.

**Update (2026-04-30, second pass):** the cleanup parts also done.
`RpcSession.close()` now:

- Fans out `Release` for every still-imported cap *before* the transport
  tears down, so the peer's export table is accurate immediately rather
  than waiting on the next major GC.
- Clears `#imports`, `#answers`, and `#localCaps` so a long-lived process
  that churns through many sessions doesn't accumulate Map entries.

`test/rpc.test.mjs` now asserts that close fans out at least one Release
frame after a call that returned multiple caps.

Still on the list:

- **Half-close detection on a slow peer.** `wsTransport` reacts to the
  WebSocket's close/error events; it does not detect a peer that's stopped
  reading our sends but isn't yet closed. A heartbeat / write-stalled
  watchdog would catch that case.

## 7. Documentation gaps — done

**Update (2026-04-30):** all three landed.

- `docs/zero-to-rpc.md` — schema → codegen → server → client walkthrough.
- `docs/deployment.md` — auth, backpressure, error handling, reverse proxy,
  cold start, observability, schema versioning.
- `docs/grpc-web-comparison.md` — wire format, stack diagram, capabilities,
  schema interop, when to choose each.

Linked from the README's documentation index.

## 8. Bundle-size headline

44 KB gz vs capnweb's 21 KB. Could shave another 5–8 KB by stripping more KJ
debug strings (the data section has assertion expression text), splitting the
WASI shim further, replacing some C++ inner loops with WAT.

Diminishing returns; below ~35 KB there's nothing major to grab without
rewriting the wasm in hand-tuned WAT — a lot of maintenance for a couple of KB.

## 9. CI / publishing automation — scaffolded

**Update (2026-04-30):** three workflows landed under `.github/workflows/`.

- `test.yml` — runs `npm test` on every push/PR to main.
- `publish.yml` — `npm publish` on `v*` tag push (also manual-dispatchable).
  Verifies the tag matches `package.json`'s version before publishing.
  Uses npm provenance.
- `pages.yml` — builds `web/` and deploys to GitHub Pages on every push
  to main.

Required one-time repo configuration before the workflows actually fire:

- Settings → Secrets → Actions → `NPM_TOKEN` (npm automation token with
  publish access to the `capnwasm` package).
- Settings → Pages → Source set to "GitHub Actions".
- If the Pages URL is `https://<user>.github.io/capnwasm/` rather than a
  custom domain, set `base: "/capnwasm/"` in `web/vite.config.ts`.

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
