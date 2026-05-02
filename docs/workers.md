# capnwasm in Cloudflare Workers

capnwasm runs in Workers via the **slim wasm + precompiled-Module** pattern shown below. Workers blocks dynamic code generation (`WebAssembly.compile(bytes)` at runtime), so the default `import "capnwasm"` entry (which decompresses bytes + compiles them at load time) does NOT work in Workers. Use `import wasmModule from "capnwasm/capnp.slim.wasm"` so Wrangler precompiles the `.wasm` into a `WebAssembly.Module` at deploy time, then pass the module to `CapnCpp.load(module)`.

Three transport shapes work on top of that. Pick by the request pattern:

- **HTTP batch** (`capnwasm/http-batch`): stateless POST/response. Cheapest Worker billing, plays with HTTP/2 multiplexing, no upgrade dance. Use this when the browser is making request/response calls. See [transports.md](transports.md).
- **HTTP stream** (`capnwasm/http-stream`): POST returns a streaming response body the server keeps writing into. Use this for subscriptions and capability streams.
- **WebSocket** (the example below): full-duplex, long-lived. Use this when both ends need to initiate calls or you need long-lived caps across many round-trips.

The WebSocket pattern (the most general):

```js
// worker.js
import wasmModule from "capnwasm/capnp.slim.wasm";   // wrangler imports as a compiled WebAssembly.Module
import { CapnCpp } from "capnwasm/browser";          // CapnCpp without the inlined wasm blob (saves ~50 KB gz)
import { RpcSession, InterfaceRegistry } from "capnwasm/rpc";
import { wsTransport } from "capnwasm/rpc";
import { MyAPIRegistry, EchoBuilder, EchoReader } from "./my_api.gen.mjs";

// Cache the compiled wasm Instance across requests in the same isolate.
// Each instance is ~25 MB of linear memory; one per Worker is enough.
let cppPromise;

export default {
  async fetch(req, env, ctx) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 400 });
    }
    const cpp = await (cppPromise ??= CapnCpp.load(wasmModule));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    new RpcSession(cpp, wsTransport(server), MyAPIRegistry, {
      bootstrap: env.MY_DURABLE_OBJECT,   // or a plain JS object
    });
    return new Response(null, { status: 101, webSocket: client });
  },
};
```

## Why the precompiled-Module pattern is required

Workers' V8 isolate disables dynamic code generation. Anything that produces wasm bytes at runtime. Fetch + `WebAssembly.compile(bytes)`, `DecompressionStream` + `WebAssembly.compile(bytes)`, base64 → `Uint8Array` → `WebAssembly.compile(bytes)`. Is blocked. The only allowed path is to import the `.wasm` file as source, which Wrangler statically bundles AND precompiles into a `WebAssembly.Module` at deploy time. The runtime then hands you that pre-compiled module to `WebAssembly.instantiate(module, imports)`, which is link-only and doesn't trigger the codegen ban.

That's why Workers users **must** use `capnwasm/browser` (which exposes `CapnCpp.load(module)`) plus `import wasmModule from "capnwasm/capnp.slim.wasm"`, not the default `import "capnwasm"` (which inlines the wasm as base64 + decompresses + compiles at runtime. The exact pattern Workers blocks).

`CapnCpp.load()` accepts five kinds of source for non-Workers environments too: `Uint8Array`, `ArrayBuffer`, URL/string, `Response`, and `WebAssembly.Module`. Workers is the one platform that can ONLY use the last form.

For the WebSocket side, `wsTransport(ws)` works against any object that exposes `addEventListener("message")` and `send()`. Which is exactly what the `server` half of `new WebSocketPair()` exposes in Workers. No adapter needed.

## Wrangler config

Tell wrangler about the wasm asset import in `wrangler.toml`:

```toml
name = "my-capnwasm-worker"
main = "worker.js"
compatibility_date = "2025-04-01"

[wasm_modules]
# Wrangler needs to know the .wasm file is a module asset. The path is
# relative to the wrangler.toml file.
CAPNP_WASM = "./node_modules/capnwasm/dist/capnp.slim.wasm"
```

Then the `import wasmModule from "capnwasm/capnp.slim.wasm"` in `worker.js` resolves to that bundled asset.

> **Wrangler 3+** can usually pick up `.wasm` imports without the `[wasm_modules]` block thanks to the bundler. If you're on an older Wrangler or have a custom esbuild step, the explicit binding above is the reliable fallback.

## Serving binary assets from R2

This is where capnwasm pulls clearly ahead of capnweb on Workers. Capnweb has to base64-encode every binary blob through JSON; capnwasm ships the raw bytes.

```js
// Schema (assets.capnp):
//   struct Asset {
//     name @0 :Text;
//     mime @1 :Text;
//     bytes @2 :Data;
//   }

import wasmModule from "capnwasm/capnp.slim.wasm";
import { CapnCpp, RpcSession, InterfaceRegistry, wsTransport } from "capnwasm";
import { AssetBuilder } from "./assets.gen.mjs";

const ASSETS_IFC = 0xa55e7c0ffeec0ffen;

let cppPromise;

const registry = new InterfaceRegistry();
registry.register(ASSETS_IFC, 0, async (target, ctx) => {
  // target is the R2 bucket binding (env.ASSETS).
  const params = ctx.openParams(/* GetParams reader */);
  const key = params.key;

  const obj = await target.get(key);
  if (!obj) throw new Error(`asset not found: ${key}`);
  const bytes = new Uint8Array(await obj.arrayBuffer());

  // JSON.stringify-shaped: pass an object, get a typed message.
  // Same wire bytes as setting fields one-by-one, fewer lines.
  ctx.beginResults(AssetBuilder).fromObject({
    name: key,
    mime: obj.httpMetadata?.contentType ?? "application/octet-stream",
    bytes,                                  // raw binary on the wire. No base64
  });
});

export default {
  async fetch(req, env) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const cpp = await (cppPromise ??= CapnCpp.load(wasmModule));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    new RpcSession(cpp, wsTransport(server), registry, { bootstrap: env.ASSETS });
    return new Response(null, { status: 101, webSocket: client });
  },
};
```

For a 5 MB image asset, the wire bytes are:

| | wire bytes |
|---|---|
| capnweb (base64 in JSON) | ~6.6 MB |
| capnwasm (binary) | 5.0 MB |

That's **24% fewer bytes on the wire** for a single asset shape.

### Where the savings actually go

A note on accounting: **Cloudflare R2 egress to the public internet is zero-rated** (and has been since R2's launch in 2022), so the wire-byte savings here do *not* translate into a smaller Cloudflare bill. What you do get on Cloudflare:

- **Faster time-to-first-byte for the user**. 1.6 MB less data over a 10 Mbps mobile link is ~1.3 s of wall-clock time.
- **Lower client-side CPU**. The browser doesn't run a base64 decode loop on a 5 MB string.
- **Less Worker CPU on the codegen path**. `Builder.from(cpp, obj)` outputs binary bytes faster than `JSON.stringify` outputs text for typical responses (codegen is straight-line setter calls; JSON.stringify is V8-internal but pays for string-building).

If you deploy on **AWS S3** ($0.09/GB egress) or **GCP Storage** ($0.12/GB), the same 24% savings does translate into money. About $0.108/M-requests on AWS for the example above. But on Cloudflare, the win is UX and Worker-CPU-time, not the bill.

## Durable Objects

Same shape. DO is just a Worker that's pinned to one instance. Put `cppPromise` on `this` instead of module scope:

```js
export class GameSession {
  constructor(state, env) {
    this.state = state;
    this.cppPromise = null;
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const cpp = await (this.cppPromise ??= CapnCpp.load(wasmModule));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    new RpcSession(cpp, wsTransport(server), gameRegistry, { bootstrap: this });
    return new Response(null, { status: 101, webSocket: client });
  }
}
```

`state.acceptWebSocket(server)` (instead of plain `server.accept()`) gives you DO's hibernation API for free. The WebSocket survives Worker eviction.

## Cold start cost

Workers are cold-start sensitive. capnwasm's wasm compile is ~3 ms in our Node bench (faster in V8 cold-start because the runtime keeps a compiled-wasm cache). For Workers specifically:

- **First request after deploy or eviction**: ~5–10 ms wasm compile + 0.1 ms instantiate
- **Subsequent requests in the same isolate**: 0 ms. `cppPromise` is cached in module scope, instantiate is skipped via the `await` returning the same instance
- **Across isolates**: each cold isolate pays the compile once

For comparison, capnweb has no wasm compile so it starts ~5 ms sooner per cold isolate. That gap is real but small relative to typical Worker cold-start variance (10–50 ms). After warm-up they're identical.

If your Worker is heavily cold-start sensitive (e.g., a once-per-day scheduled task), capnweb is a reasonable choice for that specific case. For anything that gets sustained traffic, the cold-start cost amortizes across thousands of requests and the per-request perf wins dominate.

## What you don't need

- **No `capnwasm/cf-worker` subpath.** The default package works.
- **No special build flag.** Wrangler bundles `.wasm` automatically.
- **No CSP changes** beyond what any wasm-using Worker already needs.
- **No streaming-compile shim.** `CapnCpp.load(wasmModule)` skips compile entirely (the module is already compiled).
