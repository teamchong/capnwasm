# capnwasm vs gRPC-Web

A fair question that comes up: gRPC-Web exists, has Google's name on it, and is the obvious choice for "binary RPC in the browser." When does capnwasm make sense instead?

## Quick answer

**Choose gRPC-Web when**: your backend already speaks gRPC; you want to reuse existing `.proto` files and Envoy/grpcwebproxy infrastructure; your team is already trained on protobuf semantics and tooling.

**Choose capnwasm when**: you don't have a gRPC backend already; you want zero-copy reads (read 5 fields out of 100 without decoding the rest); you want first-class capability passing (return an interface from a method, the client calls back into it); you want one toolchain that targets browsers, Node, Workers, and any other runtime with a 44 KB bundle budget.

The detail is below.

## Wire format

| | capnwasm | gRPC-Web |
|---|---|---|
| Encoding | Cap'n Proto binary | Protobuf binary (with base64 framing in the `text` variant) |
| Self-describing | No (schema required to read) | No (schema required to read) |
| Field tags / IDs | Yes, in the schema | Yes, in the schema |
| Backwards compat | Append-only fields/methods | Append-only fields/methods |
| Zero-copy reads | **Yes** — read fields from the buffer in place | No — protobuf has no random-access on lazy fields |
| Bidirectional streaming | Yes (in-band, framed) | Limited (server streaming only over fetch; bidi requires WebTransport or hacks) |
| Capabilities | **First-class** | None |

The zero-copy bit is the structural difference. Cap'n Proto's wire format is a fixed-layout struct with pointer offsets to variable-length tails — you can read field 32 without having parsed fields 0–31. Protobuf is a sequence of tag-length-value records; to find field 32, the decoder walks forward through every preceding field. That's why the [perf table on the landing page](https://teamchong.github.io/capnwasm/) shows 12× speedups on sparse-field reads.

## Stack diagram

```
gRPC-Web                              capnwasm
─────────                             ────────
browser:                              browser:
  grpc-web JS client (~50 KB)          capnwasm/browser (44 KB JS+wasm)
       │                                    │
       │ HTTP/1.1 framed                    │ WebSocket binary frames
       ▼                                    ▼
  Envoy / grpcwebproxy                  any WS server
  (translates to HTTP/2)                (Node, Workers, Deno, ...)
       │
       │ gRPC over HTTP/2
       ▼
  gRPC server (Go, Java, Python, ...)  RPC server (any wsTransport peer)
```

gRPC-Web requires a **proxy** because browsers can't speak HTTP/2 trailers. That proxy is a deployment dependency: another binary, another config file, another piece of infrastructure to monitor. capnwasm is a WebSocket client — any WS server speaks the protocol natively, no proxy in the path.

## Bundle size

| | gzip |
|---|---|
| capnwasm/browser (44 KB) | 44 KB |
| gRPC-Web (`@grpc/grpc-js` + generated code, typical) | 80–120 KB |
| capnweb (the lighter capnwasm cousin) | 21 KB |

`grpc-web` numbers vary heavily with what you import — strip down to one service and a runtime and it can be smaller, but realistic deployments end up in the 80+ KB range once retry/auth/streaming code lands. capnwasm is fixed at 44 KB regardless of how many services you generate against it (the runtime is shared; codegen output is per-service typed accessors only).

## Capabilities

This is the load-bearing capnwasm feature gRPC-Web doesn't have:

```js
// capnwasm: server returns a capability the client can call back into
const session = await connectWebSocket(cpp, "wss://api.example.com");
const root = session.bootstrap();

const r = root.callBuilder(API, GET_USER, GetUserParamsBuilder);
r.params.id = "u123";
const result = await r.send().promise;
const userCap = result.cap;        // a typed handle to a server-held User object

// Subsequent calls on userCap stay routed to the *same* server-side User
// instance — useful for streaming updates, transactions, anything stateful.
await userCap.subscribe(callback).promise;
```

In gRPC-Web you'd model this with explicit user IDs and per-call lookups — the client passes "u123" on every call, the server re-fetches state every time, you hand-roll cancellation tokens and subscription handles. That's protobuf's data-only model. Capabilities solve the same problem with one fewer abstraction layer.

If your design doesn't use capabilities, this is a feature you're paying for and not using — gRPC-Web fits cleanly in that case.

## Schema interop

A `.capnp` schema is wire-compatible with C++, Rust, Go, Python, and other Cap'n Proto implementations. A `.proto` schema is wire-compatible with the gRPC ecosystem. They're not interchangeable.

If your server is already Cap'n Proto on the wire (often the case in storage / data-pipeline systems where CapnProto's seek-on-read is decisive), capnwasm is the browser/Node client that costs you nothing extra to add. If your server is already gRPC, gRPC-Web is the analogous answer.

For a greenfield project: which schema language you prefer is a real factor. Protobuf has more tooling, more years of bug fixes, more Stack Overflow answers. Cap'n Proto has fewer but generally cleaner semantics — no Any-type runtime gymnastics, no oneof-vs-optional confusion, fewer footguns around default values.

## Streaming model

gRPC's bidirectional streaming requires HTTP/2; gRPC-Web tops out at server streaming over HTTP/1.1 (chunked transfer) or fetch streaming. capnwasm's streaming is in-band on the same WebSocket frame format as regular calls — it's a small extension on top of `rpc.capnp` rather than a separate code path. Not a feature gap, but a structural difference: capnwasm's streaming is wire-cheap (no extra framing), gRPC-Web's is HTTP-bound.

Today capnwasm's streaming chunk queue is unbounded. See the [deployment guide](deployment.md#backpressure) — gRPC has flow control built into HTTP/2; capnwasm doesn't yet.

## Tooling and DX

| | capnwasm | gRPC-Web |
|---|---|---|
| Codegen step | `npx capnwasm gen schema.capnp` | `protoc --js_out=...` + `protoc-gen-grpc-web` plugin |
| Vite/dev integration | `capnwasm/vite-plugin` (regen on save) | manual `protoc` script + watch |
| Browser dev console inspector | One-line `import` from CDN | None (gRPC-Web Inspector is a separate Chrome extension) |
| TypeScript types from `.capnp` | Yes, automatic | Yes, via plugin |
| REST output from same source | Yes (`@rest` directives or OpenAPI) | No — separate transport |
| Runtime-schema reader | Yes (`capnwasm/dynamic`) | No (proto reflection requires `protoc`'s own runtime) |

Codegen ergonomics matter when you're iterating. The Vite plugin difference isn't fundamental — anyone can write a similar plugin for protoc — it just doesn't ship with gRPC-Web today.

## When NOT to use capnwasm

- **You have a gRPC backend already** and your team's day-to-day is `protoc`, `buf`, gRPC interceptors. Switching to a different schema language has a real cost; gRPC-Web removes the browser barrier without making you re-train.
- **You need cross-vendor interop with services that only speak protobuf**, like a third-party ML inference API. Run gRPC-Web; the proxy is fine.
- **You want the official-Google-blessing reassurance** for an enterprise procurement process. Cap'n Proto is open-source but not Google-backed.

For new builds, the schema interop and bundle-size argument has held up — a 44 KB type-safe binary RPC client that talks to anything (Node, Workers, browsers, C++ peers) without a proxy in the path is a real deployment win.
