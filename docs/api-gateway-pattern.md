# One typed public API across many internal services

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time. Normal readers now keep message bytes in managed `WebAssembly.Memory`, but 0.0.x still needs hardening around allocator lifecycle, large payloads, hostile inputs, concurrency, and secure memory hygiene.

This is the problem capnweb doesn't solve and was never built to solve. capnweb is a JSON-RPC transport with a 1:1 client/server pairing. Both sides are JS, both sides import the same module, and the wire format is JSON. If you have five internal services in three languages with mixed contracts (gRPC, OpenAPI, REST without a spec), capnweb gives you exactly one option: stand up a sixth service that re-implements all of it in JS, and then call that from the browser.

capnwasm gives you the three pieces that compose into a gateway:

1. **Codegen from heterogeneous inputs.** `npx capnwasm` reads `.capnp` schemas, TypeScript interfaces with `@rest` directives, and OpenAPI 3.x specs. And emits one consistent client style for all three.
2. **A REST runtime that handles the messy parts.** Retries, auth, pagination, timeouts, and `AbortSignal` cancellation are in `capnwasm/rest`, not in your gateway code.
3. **An RPC server inside the Worker.** `capnwasm/rpc` + your `.capnp` schema gives the browser one typed surface; what's behind it is your gateway's problem, not the browser's.

This page is the worked example. The shape is: three internal services with three contract types, one Worker that fans out, one public `.capnp` schema, one typed browser SDK.

## The architecture

```
              ┌──────────────────────────────────────────────────┐
              │ Browser                                          │
              │   import { createClient } from "capnwasm/client" │
              │   client.searchProducts({ query: "shoes" })      │
              └────────────────────┬─────────────────────────────┘
                                   │  WebSocket, capnp wire
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │ Cloudflare Worker (the gateway)                  │
              │   InterfaceRegistry → maps capnp method →        │
              │     async fn(ctx) {                              │
              │       const a = await catalogClient.search(...)  │
              │       const b = await pricingClient.quote(...)   │
              │       const c = await inventoryClient.stock(...) │
              │       return assemble(a, b, c)                   │
              │     }                                            │
              └─┬───────────────┬──────────────────┬─────────────┘
                │               │                  │
       OpenAPI ▼      @rest TS ▼          gRPC-Web ▼  (hand-written)
       Catalog        Pricing             Inventory
       (Java)         (Go REST)           (Rust gRPC)
```

The browser sees a single `.capnp` interface. The Worker translates each method into one or more upstream calls. Generated REST clients handle the per-upstream protocol details. The schema you publish (the `.capnp` file) is the contract. It is decoupled from any individual upstream's contract.

## Step 1: define the public surface

`public_api.capnp` is what you ship to consumers. Keep it thin. Only fields and shapes the public actually needs, regardless of what each upstream returns.

```capnp
@0xb7c4f9d9a6e15a31;

struct Money {
  amount @0 :UInt64;        # cents
  currency @1 :Text;
}

struct ProductCard {
  sku @0 :Text;
  name @1 :Text;
  price @2 :Money;
  inStock @3 :Bool;
}

struct SearchResults {
  items @0 :List(ProductCard);
  nextCursor @1 :Text;
}

interface PublicAPI {
  searchProducts @0 (query :Text, cursor :Text) -> (results :SearchResults);
  getProduct     @1 (sku :Text)                 -> (product :ProductCard);
}
```

Run `npx capnwasm gen public_api.capnp` and you get `public_api.gen.mjs` with builder + reader classes the gateway and the browser both import.

## Step 2: import the internal services

Each upstream gets its own generated client. The gateway code never speaks raw `fetch`. It speaks typed clients.

**Catalog (OpenAPI 3.x spec):**

```bash
npx capnwasm openapi catalog-spec.yaml -o gateway/catalog.gen.mjs
```

Emits `createCatalogClient({ baseUrl, auth, retries }) → { searchProducts, getProduct, ... }`. Every operation in the spec becomes a method. Path/query/header/body are typed. Retries, auth, and Retry-After honoring come from `capnwasm/rest`.

**Pricing (TypeScript interface with `@rest` directive):**

```ts
// gateway/pricing.ts
interface Quote {
  sku: string;
  amount_cents: number;
  currency: string;
}

// @rest baseUrl=https://pricing.internal
// @auth bearer
// @retries count=3 backoff=exponential
interface PricingAPI {
  // @get /quote/{sku}
  // @query region
  quote(sku: string, region?: string): Promise<Quote>;
}
```

```bash
npx capnwasm gen gateway/pricing.ts -o gateway/pricing.gen.mjs
```

Same shape. `createPricingClient({ baseUrl: "https://pricing.internal", auth: { bearer: env.PRICING_TOKEN } })`.

**Inventory (gRPC-Web):** capnwasm doesn't generate gRPC clients. Hand-write a thin wrapper that uses `grpc-web` or a `fetch`-based shim. The wrapper exposes the same Promise-returning method shape. That way the gateway code doesn't care how the bytes get fetched.

## Step 3: write the gateway Worker

The Worker mounts each generated client and registers handlers for the public `.capnp` interface. The translation layer is just regular async JS. Fan out, await, assemble.

```js
// worker.js
import wasmModule from "capnwasm/capnp.slim.wasm";
import { CapnCpp, InterfaceRegistry } from "capnwasm";
import { createHttpBatchHandler } from "capnwasm/http-batch";

import { SearchResultsBuilder, ProductCardBuilder } from "./public_api.gen.mjs";
import { createCatalogClient }   from "./gateway/catalog.gen.mjs";
import { createPricingClient }   from "./gateway/pricing.gen.mjs";
import { getInventoryClient }    from "./gateway/inventory_grpc.mjs";  // hand-written wrapper

let cppPromise;
let handlerPromise;

const registry = new InterfaceRegistry();

// Method 0: searchProducts
registry.register(0xb7c4f9d9a6e15a31n, 0, async (target, ctx) => {
  const params = ctx.openParams(/* SearchProductsParamsReader */);
  const query  = params.query;
  const cursor = params.cursor || undefined;

  // Fan out. Three upstreams in parallel.
  const env = target;
  const catalog   = createCatalogClient({ baseUrl: env.CATALOG_URL, auth: { bearer: env.CATALOG_TOKEN } });
  const pricing   = createPricingClient({ baseUrl: env.PRICING_URL, auth: { bearer: env.PRICING_TOKEN } });
  const inventory = getInventoryClient(env);

  const matches = await catalog.searchProducts({ q: query, cursor });   // → { items: [...], next_cursor }
  const skus    = matches.items.map(m => m.sku);

  const [quotes, stock] = await Promise.all([
    Promise.all(skus.map(sku => pricing.quote(sku, env.REGION))),
    inventory.bulkStock(skus),
  ]);

  // Project upstream shapes onto the public ProductCard.
  // fromObject does the setter loop for us.
  ctx.beginResults(SearchResultsBuilder).fromObject({
    items: matches.items.map((m, i) => ({
      sku: m.sku,
      name: m.title,                                       // upstream calls it title; we expose name
      price: { amount: quotes[i].amount_cents, currency: quotes[i].currency },
      inStock: stock[m.sku] > 0,
    })),
    nextCursor: matches.next_cursor ?? "",
  });
});

// Method 1: getProduct
registry.register(0xb7c4f9d9a6e15a31n, 1, async (target, ctx) => {
  const sku = ctx.openParams(/* GetProductParamsReader */).sku;
  const env = target;
  const catalog = createCatalogClient({ baseUrl: env.CATALOG_URL, auth: { bearer: env.CATALOG_TOKEN } });
  const pricing = createPricingClient({ baseUrl: env.PRICING_URL, auth: { bearer: env.PRICING_TOKEN } });
  const inventory = getInventoryClient(env);

  const [product, quote, stock] = await Promise.all([
    catalog.getProduct(sku),
    pricing.quote(sku, env.REGION),
    inventory.bulkStock([sku]),
  ]);

  ctx.beginResults(ProductCardBuilder).fromObject({
    sku,
    name: product.title,
    price: { amount: quote.amount_cents, currency: quote.currency },
    inStock: stock[sku] > 0,
  });
});

export default {
  async fetch(req, env) {
    const cpp = await (cppPromise ??= CapnCpp.load(wasmModule));
    const handler = handlerPromise ??= createHttpBatchHandler(cpp, registry, {
      bootstrap: () => env,    // each request gets the env as its bootstrap
    });
    return handler(req);
  },
};
```

Notice what's *not* in this code:

- No JSON serialization. Upstream JSON gets parsed by the generated REST client; it's projected into a typed builder; it goes out as capnp wire bytes. One serialize, one parse. Not a JSON → string → JSON → string chain.
- No retry logic, no `Retry-After` parsing, no exponential backoff. The REST runtime handles it.
- No bearer-token plumbing. `auth: { bearer: env.PRICING_TOKEN }` and the runtime puts the right header in.
- No manual field-by-field setter calls. `fromObject(o)` walks the schema and emits straight-line setters for every defined field.

## The base64-in-a-string-field trap

If the upstream is JSON, every binary field is base64-encoded text. That's JSON's only option for bytes. A naive projection that mirrors the upstream shape just carries the bloat forward:

```js
// WRONG. Public.thumbnail is :Text, the bytes stay base64-encoded.
ctx.beginResults(...).fromObject({ thumbnail: upstream.thumbnail });
```

That's a 33% size penalty in the public wire bytes that your schema didn't have to pay. The projection is where you fix it: declare `thumbnail :Data` in the `.capnp`, decode the base64 once, send raw bytes:

```capnp
struct ProductCard {
  sku       @0 :Text;
  thumbnail @1 :Data;        # raw image bytes, not base64
}
```

```js
// RIGHT. Decode once at the gateway boundary, raw bytes go on the wire.
ctx.beginResults(ProductCardBuilder).fromObject({
  sku: upstream.sku,
  thumbnail: Uint8Array.from(atob(upstream.thumbnail), c => c.charCodeAt(0)),
});
```

This is *the* lever the schema language gives you. capnp distinguishes `Text` from `Data`; JSON does not. If you skip the decode and shape-match the upstream, capnwasm offers nothing capnweb doesn't. The win exists only because you have a `Data` type and you actually use it. For 5 MB of image in 100 results, that's 1.6 MB you don't send.

## "But the client still needs JSON, right?"

Depends what the client does with the data. Three cases:

| consumer | does it call `JSON.stringify` somewhere? | capnwasm story |
|---|---|---|
| React/Vue/Svelte component reading `result.items[0].price.amount` and rendering to the DOM | **no** - the capnp reader *is* the typed object; field accessors read straight from wasm memory | win - no JSON.parse, no allocation of an intermediate object |
| Code that needs a plain JS object (passing to an existing function, logging, etc.) | **no** - `result.toObject()` returns a plain object without going through a string | neutral - same shape as `JSON.parse(...)` would have given you |
| A *next hop* that requires JSON wire bytes (a non-capnp postMessage target, a webhook relay, a `Response` body the browser needs to forward as JSON) | **yes** - `JSON.stringify(result.toObject())` | **loss** - capnp parse + object materialization + JSON serialize is more work than upstream JSON passthrough |

The first two cases are the typical browser SPA pattern, and they're a clean win. The third case. Where you're using the browser as a JSON-passthrough relay. Is one capnwasm doesn't help with. If that's your shape, stick with capnweb or plain `fetch`; the wire-format decoupling isn't earning its keep.

The framing: capnwasm-as-gateway pays off when the browser is *the* terminal consumer (renders the data, makes UI decisions from it, holds it in component state). It doesn't pay off when the browser is a glorified proxy.

## Step 4: the browser

```js
// app.js
import { load } from "capnwasm";
import { connectHttpBatch } from "capnwasm/http-batch";
import { PublicAPIRegistry } from "./public_api.gen.mjs";  // same .gen.mjs the gateway imports

const cpp = await load();
const session = connectHttpBatch(cpp, "https://gateway.example.com/api", {
  registry: PublicAPIRegistry,
});
const cap = session.bootstrap();

const results = await cap.searchProducts({ query: "shoes", cursor: "" }).promise;
// results.items is List<ProductCard>, typed.
// results.items[0].price.amount is BigInt cents.
```

The browser sees one URL, one schema, one client. It does not know the catalog is in Java behind an OpenAPI spec, that pricing is a Go REST service, that inventory is gRPC. That's the whole point of the gateway.

Multiple calls in the same JS tick get coalesced into one HTTP POST automatically. No manual batching API. If you need server push (subscriptions, capability streams), swap `connectHttpBatch` for `connectHttpStream` from `capnwasm/http-stream` and pair it with `createHttpStreamHandler` on the Worker. See [transports.md](transports.md) for the tradeoffs.

## What's free vs. hand-written

| | comes from the toolchain | you write |
|---|---|---|
| Public schema | - | `public_api.capnp` (the contract) |
| Browser client | `createClient(url, { registry })` | nothing |
| OpenAPI upstream client | `npx capnwasm openapi spec.yaml` | nothing |
| `@rest` upstream client | `npx capnwasm gen api.ts` | the `interface` + directives |
| gRPC upstream client | - | wrapper that exposes a Promise-returning shape |
| GraphQL upstream client | - | same - wrap the GraphQL client into typed methods |
| Translation/projection | `fromObject({ ... })` and the builder API | the per-method async function (the actual business logic) |
| Retries / auth / backoff | `capnwasm/rest` | config in the client constructor |
| WebSocket transport, framing | `wsTransport(server)` + `RpcSession` | nothing |
| Wasm runtime | `CapnCpp.load(wasmModule)` | one cached promise |

The hand-written part is the projection function. And that's exactly what should be hand-written, because *that's the contract*. Upstream change `title` to `displayName`? You touch one line in the gateway. The public schema stays stable. Browser code keeps working.

## Scope

This pattern doesn't get you everything you'd want from a full API gateway product:

- **No multi-language SDK emission.** The browser/Node client is JS only. If you need Python, Go, Swift, etc. consumers. The public `.capnp` schema is portable (other Cap'n Proto implementations exist), but capnwasm itself only emits JS/TS. The bigger commercial gateway products (Apollo, Speakeasy, Stainless) emit ~6 languages from one spec. capnwasm doesn't.
- **No GraphQL / federation.** If your public surface needs to be GraphQL, this isn't the tool.
- **No managed deploys.** This is library code. Your Worker is your Worker; capnwasm doesn't run it for you.
- **gRPC upstream codegen** isn't built. The shape (`fetch` shim that conforms to the same Promise-returning method interface) is straightforward to hand-write per service.
- **Schema versioning / breaking-change detection.** Cap'n Proto's wire format is famously evolution-friendly (add fields, never reorder). capnwasm now ships `npx capnwasm compat old.manifest.json new.manifest.json` as a conservative old/new manifest diff, but rollout policy is still on the application: v2 interface, adapter, migration window, or rejection of the break.

If you need a polished commercial gateway, the right answer is a polished commercial gateway. capnwasm is the answer when you want to own the wire format end-to-end, the public surface is JS-consumed, and the gateway box is a Worker (or any Node-shaped runtime).

## Why this matters

capnweb's design forecloses this pattern: JSON-RPC over WebSocket with no schema language is fine for two-services-talk-to-each-other, but it can't be the unified surface for a heterogeneous backend, because there's nothing to project *into*. There's no schema. The contract is "whatever methods the JS object happens to have". Which is exactly what makes it ergonomic for a single team and exactly what makes it useless as a public API.

The capnwasm pattern is: **the public schema is the product**, the gateway is glue, and every byte on the wire is a `.capnp` builder result that matches the contract. That's the difference between "RPC library" and "gateway toolchain."
