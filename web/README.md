# web/

> **Project framing:** this site is part of a learning/exploration repo: what changes if the browser keeps Cap'n Proto's binary wire instead of converting everything into JSON? The docs should show the tradeoff boundary: zero-copy/sparse/raw binary can win; JSON/capnweb can be better for tiny objects, pure JS-to-JS apps, and bundle size.

Wrangler-served docs site for capnwasm. The static assets are built with Vite, then served through the Worker configured in `../wrangler.json`.

- `/`; landing with overview and headline numbers vs capnweb
- `/playground.html`; live in-browser bench (REST + capnweb + capnwasm)
- `/dynamic.html`; runtime-schema demo (no codegen): define schema as JS data, build/read, Worker echo
- `/openapi.html`; live OpenAPI → manifest → `.capnp` conversion demo
- `/vs-capnweb.html`; full comparison: where capnwasm wins, loses, and ties

## Run locally

```bash
pnpm install
pnpm dev          # builds web/dist and runs Wrangler at http://127.0.0.1:8787
```

`pnpm dev` runs from the repo root. It first builds `web/dist`, then starts Wrangler so the same Worker entrypoint handles `/api/*`, `/capnwasm`, `/capnweb`, `/chat`, `/dynamic`, `/capnwasm-http`, and `/capnweb-http` locally.

The Vite build first runs `web`'s `prepare` script, which:

1. Copies `../dist/capnp.slim.wasm` into `web/public/`.
2. Generates fixture data into `web/public/data/` (200 small + 50 blob user
   records, each emitted in JSON, capnweb, and Cap'n Proto formats).

If you only need frontend/HMR iteration, use `pnpm dev:vite` from the repo root. That starts Vite at `http://127.0.0.1:5173` with a matching Node-side RPC shim, but Wrangler is the source of truth for deployed behavior.

## Production build

```bash
pnpm build        # static output in web/dist
pnpm preview      # serve the built site at http://localhost:4173
```

`pnpm preview` is useful for static Vite preview, but the deploy-shaped
path is `pnpm dev` / Wrangler. The build emits hashed asset filenames
for the wasm + JS, and Wrangler serves them through the configured
assets binding.

## Wiring

- `users.capnp`; the demo schema. `pnpm codegen` runs `npx
  capnwasm gen users.capnp` to produce `src/playground/users.gen.mjs`,
  and the `capnwasm/vite-plugin` plugin regenerates it on save during
  dev. The generated file is gitignored.
- `scripts/generate-fixtures.mjs`; emits the static `.json`, `.cwb`,
  and `.capnp` fixture files. Edit the record counts / avatar sizes
  here to change the bench surface.
- `src/playground/main.ts`; runs all three protocols, measures
  `fetch` + `decode` + `render` per phase, picks the winner per row.
- `vite-rpc-server.mjs`; the Vite-only RPC shim used by `pnpm dev:vite`.
  The deployed Worker has matching handlers in `../src/worker.mjs`.

## What this measures

The playground fetches static files from the same origin (Wrangler locally,
the Worker assets binding after deploy). The numbers it reports often end up
within a few percent across all three protocols because network is nearly free
in that setup. capnwasm consistently has the smallest wire bytes (2x smaller
for binary blobs after gzip) but can't always turn that into faster
end-to-end time when RTT is near zero. See `/vs-capnweb.html` and
`/render-bench.html` for where each protocol actually wins under realistic
workloads.

A second playground page that runs RPC over WebSocket (where capnwasm's
batching and pipelining matter) is a follow-up.
