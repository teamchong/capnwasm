# web/

Vite-built docs site for capnwasm. Three pages:

- `/` &mdash; landing with overview and headline numbers vs capnweb
- `/playground.html` &mdash; live in-browser bench (REST + capnweb + capnwasm)
- `/honest.html` &mdash; full comparison: where capnwasm wins, loses, and ties

## Run locally

```bash
cd web
npm install
npm run dev          # vite dev server at http://localhost:5173
```

`npm run dev` first runs `npm run prepare`, which:

1. Copies `../dist/capnp.slim.wasm` into `web/public/`.
2. Generates fixture data into `web/public/data/` (200 small + 50 blob user
   records, each emitted in JSON, capnweb, and Cap'n Proto formats).

If you change the runtime wasm or the fixture script, re-run `npm run prepare`
or just restart `npm run dev`.

## Production build

```bash
npm run build        # static output in web/dist
npm run preview      # serve the built site at http://localhost:4173
```

`npm run preview` also attaches the RPC bench server to its HTTP port,
so `/rpc.html` works against the production build out of the box. The
build emits hashed asset filenames for the wasm + JS, so the static
`dist/` is safe to drop behind any CDN with long-cache headers.

If you do drop the static `dist/` behind a CDN, the RPC bench page
will need a real WebSocket backend somewhere &mdash; `npm run server` runs
the same handlers as a standalone process at `ws://HOST:8081`. Or wire
the handlers in `vite-rpc-server.mjs` into your own deployment.

## Wiring

- `users.capnp` &mdash; the demo schema. `npm run codegen` runs `npx
  capnwasm gen users.capnp` to produce `src/playground/users.gen.mjs`,
  and the `capnwasm/vite-plugin` plugin regenerates it on save during
  dev. The generated file is gitignored.
- `scripts/generate-fixtures.mjs` &mdash; emits the static `.json`, `.cwb`,
  and `.capnp` fixture files. Edit the record counts / avatar sizes
  here to change the bench surface.
- `src/playground/main.ts` &mdash; runs all three protocols, measures
  `fetch` + `decode` + `render` per phase, picks the winner per row.
- `vite-rpc-server.mjs` &mdash; the bench WebSocket server, attached to
  Vite&apos;s HTTP server in both dev and preview.

## Honest about what this measures

The playground fetches static files from localhost. The numbers it reports
end up within ~3% across all three protocols because network is essentially
free in that setup. capnwasm consistently has the smallest wire bytes
(2&times; smaller for binary blobs after gzip) but can&rsquo;t turn that into
a faster end-to-end time when the network has zero RTT. See `/honest.html`
for where each protocol actually wins under realistic conditions.

A second playground page that runs RPC over WebSocket (where capnwasm&rsquo;s
batching and pipelining matter) is a follow-up.
