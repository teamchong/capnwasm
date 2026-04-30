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

The build emits hashed asset filenames for the wasm + JS, so it&rsquo;s safe
to deploy behind any CDN with long-cache headers.

## Wiring

- `users.capnp` &mdash; the demo schema. `npm run prepare` regenerates
  `src/playground/users.gen.mjs` if you edit it.
- `scripts/generate-fixtures.mjs` &mdash; emits the static `.json`, `.cwb`, and
  `.capnp` fixture files. Edit the `COUNTS` / avatar sizes here to change
  the bench surface.
- `src/playground/main.ts` &mdash; runs all three protocols, measures
  `fetch` + `decode` + `render` per phase, picks the winner per row.

## Honest about what this measures

The playground fetches static files from localhost. The numbers it reports
end up within ~3% across all three protocols because network is essentially
free in that setup. capnwasm consistently has the smallest wire bytes
(2&times; smaller for binary blobs after gzip) but can&rsquo;t turn that into
a faster end-to-end time when the network has zero RTT. See `/honest.html`
for where each protocol actually wins under realistic conditions.

A second playground page that runs RPC over WebSocket (where capnwasm&rsquo;s
batching and pipelining matter) is a follow-up.
