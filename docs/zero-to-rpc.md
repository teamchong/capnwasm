# Zero to working RPC in 5 minutes

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time, but the current 0.0.x runtime still uses fixed scratch buffers, rejects messages larger than scratch capacity, ties readers to mutable wasm linear memory, and does not zero scratch memory after use. Treat it as a controlled demo, experiment, and small/medium payload prototype while production hardening continues.

A concrete walkthrough: schema → codegen → server → client → live call. Node on both sides; the same client code runs in browsers without changes once you serve the wasm asset.

## 1. Install

```sh
npm i capnwasm ws
```

`ws` is the WebSocket server library; you can use any other transport that exposes `send()` and `addEventListener("message")`. See [`docs/workers.md`](workers.md) for the Cloudflare Workers variant.

## 2. Define the schema

Cap'n Proto schemas describe wire-stable types. One file is enough.

```capnp
# echo.capnp
@0xfe9c8e6e1f5e1234;

struct EchoRequest {
  message @0 :Text;
}

struct EchoResponse {
  message @0 :Text;
  receivedAt @1 :Int64;
}

interface Echo {
  echo @0 (req :EchoRequest) -> (res :EchoResponse);
}
```

The interface ID (`@0xfe9c8e...`) and method ordinals (`@0` on `echo`) are part of the wire format. Once written and shipped, don't change them. Only add new fields and methods.

## 3. Generate the typed client and server

```sh
npx capnwasm gen echo.capnp -o echo.gen.mjs
```

This produces `echo.gen.mjs` with:

- `EchoRequestReader` / `EchoRequestBuilder`. Typed accessors for the request struct
- `EchoResponseReader` / `EchoResponseBuilder`. Same for the response
- `EchoRegistry`. An `InterfaceRegistry` you register your handler on
- The interface ID and method ordinals as named constants

You don't have to commit `echo.gen.mjs`. The Vite plugin (`capnwasm/vite-plugin`) regenerates it on save, and a `prepare` script can do the same in CI. Treat `echo.capnp` as the source of truth.

## 4. Write the server

```js
// server.mjs
import { WebSocketServer } from "ws";
import { load, RpcSession, wsTransport } from "capnwasm";
import { EchoRegistry, EchoResponseBuilder } from "./echo.gen.mjs";

const cpp = await load();

// One InterfaceRegistry per service; same registry can be reused across
// every connection (it's stateless once handlers are registered).
const registry = new EchoRegistry();
registry.echo(async (params) => {
  // params is an EchoRequestReader. Build a response in one expression.
  const out = EchoResponseBuilder.write(cpp, (b) => {
    b.message = `you said: ${params.message}`;
    b.receivedAt = BigInt(Date.now());
  });
  return out;  // bytes. Capnwasm ships them as the Return frame
});

const wss = new WebSocketServer({ port: 8765 });
wss.on("connection", (ws) => {
  // Each connection gets its own RpcSession. The bootstrap target is the
  // capability the peer sees when it calls session.bootstrap(). Here it's
  // a plain `{}` because the only thing we expose is the Echo interface,
  // which the registry routes by interface ID.
  new RpcSession(cpp, wsTransport(ws), registry, { bootstrap: {} });
});

console.log("RPC listening on ws://127.0.0.1:8765");
```

Run it: `node server.mjs`.

## 5. Write the client

```js
// client.mjs
import { load, connectWebSocket } from "capnwasm";
import { ECHO_INTERFACE_ID, ECHO_METHODS, EchoRequestBuilder, EchoResponseReader } from "./echo.gen.mjs";

// Node 22+ has built-in WebSocket; in older runtimes pass `opts.WebSocket`.
const cpp = await load();
const session = await connectWebSocket(cpp, "ws://127.0.0.1:8765");

const cap = session.bootstrap();

// callBuilder lets you write parameters directly into the wasm memory the
// frame will be sent from. No intermediate JS object, no extra serialize.
const r = cap.callBuilder(ECHO_INTERFACE_ID, ECHO_METHODS.echo, EchoRequestBuilder);
r.params.message = "hello";

// .send() sends the Call. The promise resolves when the Return arrives.
// .send({ extract }) lets you read fields out of the Result frame
// synchronously, before the promise settles, with no JS allocation.
const result = await r.send({
  extract: (reader) => ({
    msg: reader.message,
    at: reader.receivedAt,
  }),
}).promise;

console.log(result);  // { msg: "you said: hello", at: 17... }
session.close();
```

Run it (with the server running): `node client.mjs`.

## 6. What's actually happening

```
client                                                      server
                              .---------- ws ----------.
 cap.callBuilder              |                        |
   ├ stage params in wasm     |                        |
   ├ build Call frame         |                        |
   ├ send bytes ─────────────►│                        │
                              │                        ├ frame arrives
                              │                        ├ dispatch by interface+method
                              │                        ├ handler runs
                              │                        ├ write Result frame
   ◄──── send bytes ──────────│                        │
 deserialize Result            |                        |
 resolve promise               |                        |
                              '------------------------'
```

One TCP write per direction. Cap'n Proto's wire format is the bytes you see going over the socket. Same as a C++ or Rust peer would send for the same schema. If you wireshark the connection you can decode the bytes with any other Cap'n Proto reader, including [`/inspect.js`](https://capnwasm.teamchong.net/inspect.js) in DevTools.

## 7. From here

- **Multiple methods**: add more `interface`s and `methods`; the codegen produces one register-handler per method.
- **Capabilities (interface returned from a method)**: `interface` types are first-class in Cap'n Proto. Return one from a method, the client gets a typed handle and can call it back. See [`test/rpc.test.mjs`](../test/rpc.test.mjs) for a worked example.
- **Streaming responses**: see `cap.callStream()` and `registry.registerStream()`. Async generators on the server, async iterables on the client.
- **Browser client**: replace `connectWebSocket` with the same call against your hosted server's wss:// endpoint. The wasm fetches as a separate asset (42 KB gzip).
- **REST instead of RPC**: write a TypeScript interface with `@rest` directives and use `npx capnwasm gen` against it. See the [REST runtime section](../README.md#rest-runtime-details).
