# capnwasm follow-ups

Ranked list of work that's been thought about but not done. Captured here so
it survives session-context compaction. **Order is the working priority** —
the user picked cold-start first, then the eight gaps below it in the order
they ranked them.

## 1. Cold-start work

The biggest remaining honest-loss in the perf table. Wasm compile + first-call
init is ~3 ms in Node and ~5–50 ms in the browser. capnweb is ~0.2 ms total.

What's worth trying:

- **Streaming compile + bytes optimization**. We already use
  `WebAssembly.instantiateStreaming` when given a URL/Response. Worth measuring
  whether brotli on the wire (in addition to gzip) shortens the parse window
  on slow connections.
- **Smaller wasm**. Stripping more KJ debug strings, splitting the WASI shim
  further, replacing some C++ hot inner loops with hand-tuned WAT. See
  follow-up #8 below — diminishing returns past ~35 KB without a rewrite.
- **Compile-time vs first-use tradeoff**. We currently compile + link + run
  `_start` synchronously inside `load()`. If the caller doesn't make a wasm
  call right away, we can defer some of this. Probably small gain.
- **Pre-warm with `WebAssembly.compile(source)`**. Some apps could
  `await import("./capnp.slim.wasm?compile")` ahead of first use. That's a
  user-side pattern, not a library change — but worth documenting.

Cost: 1–2 days of profiling + targeted shrinkage. Don't expect to beat 21 KB.
Aim for ~35 KB gz wasm and ~1 ms node init.

## 2. Dynamic-schema reader (`capnwasm/dynamic`)

Cap'n Proto's wire format supports schemaless reading; we only expose codegen.
Today the answer to "my schema is defined at runtime" is "use capnweb." For
multi-tenant SaaS, admin tools, GraphQL-fragment-shaped data, this is a real
loss.

Cost: ~2 days. The wasm-side `cpp_any_*` API already does the work; the gap
is a JS wrapper that takes a schema loaded as data instead of a codegen-
generated reader class.

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

## 5. Streaming response handling is undertested

`callStream` works for the basic case. Real streaming has surprises:
backpressure, mid-stream errors, peer disconnect, abort signals. Our test
suite has one streaming test; production use will probably surface bugs.

Cost: ~half a day for adversarial tests. Worth doing the moment someone tries
to use streaming for real.

## 6. Capability lifecycle under failure

`FinalizationRegistry`-driven `Release` messages are best-effort. If a peer
disconnects mid-conversation, the surviving side leaks its import table.
Production-grade RPC has a session-teardown sweep that releases everything.

Cost: ~1 day. Matters for long-lived connections; nobody using this for
short-lived browser sessions will notice.

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
