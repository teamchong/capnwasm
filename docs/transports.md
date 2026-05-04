# Transports

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time, but the current 0.0.x runtime still uses fixed scratch buffers, rejects messages larger than scratch capacity, ties readers to mutable wasm linear memory, and does not zero scratch memory after use. Treat it as a controlled demo, experiment, and small/medium payload prototype while production hardening continues.

capnwasm RPC speaks the Cap'n Proto wire format over a pluggable Transport. A Transport is just `{ send(bytes), onMessage(handler), onClose(handler), close() }`. Anything that can move framed bytes back and forth qualifies.

Three transports ship in the box. Pick by the request shape, not by the runtime.

## At a glance

| transport | shape | server state | use it for |
|---|---|---|---|
| WebSocket (`capnwasm/rpc` → `wsTransport`) | full-duplex, long-lived | per-connection RpcSession | bidirectional RPC with server push, streams, long-lived caps |
| HTTP batch (`capnwasm/http-batch`) | POST → response body | none - fresh session per request | request/response RPC, stateless Workers, HTTP/2-multiplexed |
| HTTP stream (`capnwasm/http-stream`) | POST → streaming response body | per-request RpcSession that lives until the stream ends | subscriptions, capability streams, server push without a WebSocket |
| postMessage (`capnwasm/postmessage`) | full-duplex, in-process | per-port RpcSession | Worker ↔ main thread, iframe ↔ host, SharedWorker, MessageChannel |

## WebSocket

Full bidirectional. The browser uses `new WebSocket(url)`; the server (Worker, Node) uses `wsTransport(server)` over the upgraded socket. One session per connection, lasts as long as the socket. Server-initiated calls and capability streams work naturally because both sides can send frames at any time.

```js
import { connectWebSocket } from "capnwasm/rpc";
const session = await connectWebSocket(cpp, "wss://api.example.com/rpc", { registry });
const cap = session.bootstrap();
const r = await cap.call(IFC, METHOD, paramsBytes).promise;
```

## HTTP batch. Stateless POST/response

The typed-proxy one-liner over HTTP batch (same shape as `connectWebSocket` / `connectHttpStream`):

```js
import { typedClient } from "capnwasm/typed";
import { MyApi_INTERFACE } from "./my_api.gen.mjs";

const api = await typedClient("https://api.example.com/rpc", MyApi_INTERFACE);
const r   = await api.someMethod({ arg: 1 });
```

Or the lower-level version when you need direct cap access:

```js
// Client
import { connectHttpBatch } from "capnwasm/http-batch";
const session = connectHttpBatch(cpp, "/rpc", { registry });
const cap = session.bootstrap();
const r = await cap.call(IFC, METHOD, paramsBytes).promise;

// Server (Worker)
import { createHttpBatchHandler } from "capnwasm/http-batch";
const handler = createHttpBatchHandler(cpp, registry, { bootstrap: env.MY_BINDING });
export default { fetch(req) { return handler(req); } };
```

Each POST is one fresh server-side `RpcSession`. The session is destroyed after the response body is flushed, so no per-session state survives between requests. **Promise pipelining works within a single batch**. The server processes inbound frames in order and produces all the corresponding Returns in one response. Multiple `cap.call()` invocations in the same JS tick on the client are coalesced into one POST (microtask-batched).

What's filtered: the client suppresses `Finish` and `Release` frames over this transport. They're no-ops against a stateless server-side session and would otherwise generate a wasted round-trip carrying nothing but cleanup.

What this transport doesn't do:
- **No server push**. The response body is one batched envelope; once flushed, the connection is done.
- **No long-lived caps across requests**. Capabilities returned in a response can't be invoked in a *later* request, because the export table doesn't survive.

If you need either of those, use HTTP stream or WebSocket.

### Worker billing

HTTP batch is friendly to Workers' billing model: handler runs, returns, and you stop paying. WebSocket holds an open connection; depending on plan and traffic that can cost more. For request/response shapes, batch is just cheaper.

## HTTP stream. Server push over a long response body

```js
// Client
import { connectHttpStream } from "capnwasm/http-stream";
const session = connectHttpStream(cpp, "/feed", { registry });
const cap = session.bootstrap();
// One subscribe call kicks off the stream; the server keeps pushing
// frames into the response body until the client aborts.
for await (const event of cap.subscribeMethod(...)) {
  render(event);
}

// Server (Worker)
import { createHttpStreamHandler } from "capnwasm/http-stream";
const handler = createHttpStreamHandler(cpp, registry, {
  bootstrap: env.MY_BINDING,
  // endOnIdle: true,   // close the stream once all initial calls finish
});
export default { fetch(req) { return handler(req); } };
```

The client POST carries the initial batch (subscribes, calls). The server returns a `Response` whose body is a `ReadableStream` of length-prefixed binary frames. The session stays alive. And the response body stays open. Until either the server's `idle()` resolves (only when `endOnIdle: true`) or the client aborts the fetch.

Use it for: subscriptions, capability streams, progress feeds, anything where the server has more to say than fits in one response.

### Limitation: one-shot client → server

After the initial POST body is sent, additional client→server frames over this transport are dropped. The reason is browser support: fetch with a streaming request body requires HTTP/2 and isn't reliable across browsers. If you need round-trip RPC where the client makes more calls *after* the subscription is established, use WebSocket.

This is the same constraint MCP's "Streamable HTTP" pulls a session-id around to work around. They use a separate POST per client→server message and correlate by `Mcp-Session-Id`. capnwasm doesn't ship that yet; if you need it, WebSocket is the answer today.

## postMessage / MessageChannel

For browser shapes that don't involve the network. Worker ↔ main thread, iframe ↔ host, SharedWorker, paired `MessageChannel` ports.

```js
import { postMessageTransport, createMessageChannelTransportPair } from "capnwasm/postmessage";
import { RpcSession, InterfaceRegistry } from "capnwasm/rpc";

// In the main thread:
const worker = new Worker("worker.js", { type: "module" });
const transport = postMessageTransport(worker);
const session = new RpcSession(cpp, transport);
const cap = session.bootstrap();

// In worker.js:
const transport = postMessageTransport(self);
new RpcSession(cpp, transport, registry, { bootstrap: env });
```

For an in-process pair (typically tests, but also iframe-shaped patterns where both ends share a realm):

```js
const { a, b } = createMessageChannelTransportPair();
const client = new RpcSession(cppA, a);
const server = new RpcSession(cppB, b, registry, { bootstrap });
```

When the message bytes come from wasm scratch memory, the transport copies them into a fresh ArrayBuffer before transferring. Wasm memory can't be safely transferred (it'd detach the entire wasm instance). For hot paths where you've already copied bytes, pass `{ transfer: false }` to skip the second copy.

For window-to-window postMessage with origin checks:

```js
const transport = postMessageTransport(otherWindow, {
  targetOrigin: "https://expected.example.com",
  acceptOrigin: "https://expected.example.com",
});
```

## Choosing

```
Need server push?
├─ no  → use HTTP batch (cheapest, statelessest, plays with HTTP/2)
└─ yes
   ├─ Push only after a subscribe call?  → use HTTP stream
   └─ Server initiates calls, or caps live across requests?
        → use WebSocket
```

For the API gateway pattern in [api-gateway-pattern.md](api-gateway-pattern.md), HTTP batch is usually the right pick. The gateway is a request/response surface, not a push pipe. Streaming kicks in when you start exposing event feeds.

## Common Transport interface

All three transports implement the same shape, so anything built against `RpcSession` works regardless of how the bytes move:

```ts
interface Transport {
  send(bytes: Uint8Array): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  onClose(handler: (err?: unknown) => void): void;
  close(): void;
}
```

If you have an existing channel that doesn't fit (a `MessageChannel`, a Node `net.Socket`, a custom binary RTC data channel). Implement these four methods and pass it to `new RpcSession(cpp, transport, registry, opts)`. The session doesn't care.
