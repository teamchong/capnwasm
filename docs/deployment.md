# Production deployment

What changes between `node server.mjs` on your laptop and a real production server. Patterns that have come up in actual use.

## Pick a transport

| environment | transport | notes |
|---|---|---|
| Cloudflare Workers | `WebSocketPair` + `wsTransport(server)` | See [`workers.md`](workers.md). Sync wasm instantiate, no fetch on cold path. |
| Node + reverse proxy | `ws` package + `wsTransport(ws)` | Most common. Nginx/Caddy upgrade-passthrough on the path. |
| Same-process bench / test | `createMemoryTransportPair` | No network, microtask delivery. |
| Custom stream | anything implementing `{ send, onMessage, close, onClose? }` | `RpcSession` doesn't care. |

`onClose` is optional but **strongly recommended**. Without it, a peer that goes away mid-call leaves a `RpcSession` parked on a question forever. `wsTransport` already wires it up.

## Auth

Cap'n Proto RPC has no auth layer of its own. Two patterns:

### Connection-time auth (token)

Authenticate at WebSocket upgrade. Reject the upgrade if the token is bad; never construct an `RpcSession`.

```js
wss.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://x").searchParams.get("token");
  if (!validateToken(token)) {
    ws.close(1008, "unauthorized");
    return;
  }
  const userId = userFor(token);
  new RpcSession(cpp, wsTransport(ws), registry, {
    bootstrap: makeUserScopedBootstrap(userId),
  });
});
```

The `bootstrap` value is per-connection. Use it to thread auth context (user id, tenant id, role) into your handlers — the registry handler signature is `(params, ctx) => {...}` where `ctx.bootstrap` is whatever you returned here.

### Per-call auth (token in params)

Add an auth field to each method's request schema:

```capnp
struct CallContext { token @0 :Text; }
struct EchoRequest {
  ctx @0 :CallContext;
  message @1 :Text;
}
```

Less efficient — the token rides on every Call — but works behind transports that don't carry connection-time metadata (gRPC-Web bridges, raw HTTP).

## Backpressure

The streaming chunk queue (`cap.callStream`) accepts a `maxQueueSize` cap. When the cap is exceeded the iterator rejects with `stream queue overflow` — a memory safety valve, not real flow control:

```js
const r = cap.callStream(IFC, METHOD, params, { maxQueueSize: 256 });
try {
  for await (const chunk of r.chunks) await handle(chunk);
} catch (e) {
  if (/stream queue overflow/.test(e.message)) {
    // Slow consumer; consider paging instead of streaming for this method.
  } else throw e;
}
```

Pick `maxQueueSize` so worst-case memory (`maxQueueSize × max chunk size`) stays within budget. There is no protocol-level flow control yet — server-side keeps sending until it sees the resulting Finish, so chunks already in flight at overflow time will arrive after the iterator has rejected; they're silently dropped.

Until per-stream credits land, design streaming methods around bounded result sets:

- Page the result instead of streaming: a method that returns up to N records per call, plus a cursor for the next page.
- For genuinely large server-driven streams, have the consumer signal progress on a return-channel cap; the producer waits for that before yielding the next batch.

## Error handling

`InterfaceRegistry` handlers can throw. The thrown error becomes a Cap'n Proto `exception` Return; on the client, the awaited promise rejects with an `Error` carrying the original message. **Server-side stack traces are not shipped** — only the message string and the exception type code (FAILED, OVERLOADED, DISCONNECTED, UNIMPLEMENTED).

Use the type code to drive client retry behavior:

```js
import { RpcException } from "capnwasm/rpc";

try {
  await cap.call(IFC, METHOD, params).promise;
} catch (e) {
  if (e instanceof RpcException && e.type === "OVERLOADED") {
    // server says try again later; backoff + retry
  } else {
    throw e;
  }
}
```

Map your domain errors to these four types in the handler — don't leak internal exceptions across the wire.

## Reverse proxy / load balancer

WebSocket upgrades need explicit handling. Sample nginx:

```nginx
location /rpc {
  proxy_pass http://backend;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 1d;   # streams may sit idle
}
```

`proxy_read_timeout` matters: long-lived RPC sessions look idle to the proxy if there's no traffic. Either bump it (above) or have a server-side ping handler that the client periodically calls.

## Cold start

- **Node**: ~1 ms total time-to-first-result on a fresh process. See [`vs-capnweb.md`](vs-capnweb.md). No tuning needed.
- **Cloudflare Workers**: the wasm Module is cached across requests in the same isolate. First request in an isolate pays ~5 ms; subsequent requests in that isolate skip wasm compile entirely.
- **Browser fresh tab, empty cache**: ~20 ms to fetch + streaming compile 82 KB of wasm raw / 28 KB brotli over the wire from a brotli-capable host (Cloudflare Pages, Vercel, Netlify, CloudFront). Cache-Control + immutable URLs make warm reloads ~2–4 ms.

If you serve `dist/capnp.slim.wasm` yourself, set `Cache-Control: public, max-age=31536000, immutable` on the asset and version-hash the URL. The default Vite plugin and the `capnwasm/browser` entrypoint already do the right thing.

## Observability

`RpcSession` emits no metrics today. For a per-request timer the practical pattern is to wrap your handler:

```js
function instrumented(name, handler) {
  return async (params, ctx) => {
    const t0 = performance.now();
    try {
      const out = await handler(params, ctx);
      metrics.histogram(`rpc.${name}.ms`, performance.now() - t0);
      return out;
    } catch (e) {
      metrics.counter(`rpc.${name}.errors`).inc({ type: e.type ?? "FAILED" });
      throw e;
    }
  };
}

registry.echo(instrumented("echo", echoHandler));
```

For wire-level inspection — *what bytes are flowing* — load `https://teamchong.github.io/capnwasm/inspect.js` and call `cw.inspect(framedBytes)`. Documented in [`docs/inspect.md`](inspect.md).

## What can go wrong

| symptom | likely cause |
|---|---|
| Calls hang forever after a peer crash | Transport doesn't have `onClose` wired up. `wsTransport` does; custom transports must implement it. |
| `Error: input larger than scratch buffer` | Default scratch is 1 MB. For larger payloads, size up via the wasm build (`cpp/wrapper.cpp`'s `SCRATCH_CAP`) and rebuild, or split the payload across calls. |
| `unknown method` rejection | Client and server are on different schemas. Don't change interface IDs or method ordinals once shipped. |
| Memory grows over a long-lived session | Likely an unbounded stream chunk queue (see Backpressure, above), or an import table that the FinalizationRegistry hasn't gotten to yet. The session's `close()` purges both. |

## Versioning the schema

Cap'n Proto's wire format is forward-and-backward compatible **if** you only add fields and methods, never reuse a field number, never change a type's interface ID. Treat `.capnp` files as append-only. If you need to remove a field, mark it deprecated in a comment and stop reading it; don't reuse the slot.

For breaking changes (rare), add a v2 interface with a fresh `@0x...` ID and route the old ID to a thin adapter for as long as v1 clients exist in the wild.
