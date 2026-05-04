# Vite plugin

> Context: capnwasm explores where Cap'n Proto's binary wire beats JSON, and where it does not.

> **Production-readiness notice:** capnwasm is not production-ready yet. The goal is to make it production-capable over time. Normal readers now keep message bytes in managed `WebAssembly.Memory`, but 0.0.x still needs hardening around allocator lifecycle, large payloads, hostile inputs, concurrency, and secure memory hygiene.

`capnwasm/vite-plugin` makes the codegen step invisible. Drop it into
`vite.config.ts` and your `.capnp` schemas (and `.ts` interfaces with
`@rest` directives, and OpenAPI specs) generate during the build. No
separate `npx capnwasm gen` step, no committed `.gen.mjs` files in the
repo, full hot-reload on schema changes during dev.

## 5-line setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { capnwasm } from "capnwasm/vite-plugin";

export default defineConfig({
  plugins: [capnwasm()],
});
```

That's it. The plugin auto-discovers every `**/*.capnp` under your
project root (skipping `node_modules`, `dist`, `build`, `out`, `.vite`,
`.cache`, `.next`, `.turbo`, `.git`) and emits `<schema>.gen.mjs` and
`<schema>.gen.d.ts` next to each source. Imports look like:

```ts
import { openUser, buildUser } from "./schemas/user.capnp.gen.mjs";
```

In dev mode, editing any `.capnp` file regenerates and triggers a full
page reload. Codegen errors land in Vite's overlay so you see them
without checking the terminal.

## Options

All optional. Defaults are tuned for the common case.

```ts
capnwasm({
  // Explicit list. Paths or globs. When unset, auto-discovers all
  // .capnp under the project root. .ts and OpenAPI specs (.yaml /
  // .json) must be listed explicitly. They're not auto-discovered.
  schemas: ["./schemas/*.capnp", "./api.ts", "./stripe.json"],

  // Where to write generated files. Default: next to each schema.
  outDir: "node_modules/.capnwasm",

  // Suffix appended to the schema basename. Default ".gen.mjs"
  // (with the .d.ts derived by swapping .mjs → .d.ts).
  extension: ".gen.mjs",

  // Abort the build on a codegen error. Default true. Set false to
  // log errors but keep going. Useful when one schema is broken in
  // a monorepo and you want the rest to still build.
  failOnError: true,

  // Per-file log line. Default true.
  verbose: true,
})
```

## Where the generated files go

By default, generated files land next to the source:

```
schemas/
  user.capnp
  user.capnp.gen.mjs       ← runtime code
  user.capnp.gen.d.ts      ← types
  post.capnp
  post.capnp.gen.mjs
  post.capnp.gen.d.ts
```

Add the `*.gen.mjs` and `*.gen.d.ts` to `.gitignore`. Vite regenerates
them every time you start dev or run a build, so they're never the
source of truth.

If you'd rather keep generated files out of your source tree entirely:

```ts
capnwasm({ outDir: "node_modules/.capnwasm" })
```

…then everything lands under `node_modules/.capnwasm/` and the imports
become:

```ts
import { openUser } from "@/.capnwasm/user.capnp.gen.mjs";
// or whatever path alias your tsconfig.json maps to node_modules/.capnwasm/
```

## What the plugin does

| hook | behaviour |
|---|---|
| `configResolved` | captures the project root and Vite's logger |
| `buildStart` | runs codegen for every discovered/listed schema |
| `configureServer` | watches each schema; on change, regenerates and emits a `full-reload` HMR signal |
| | also watches for newly-added `.capnp` files in auto-discover mode |
| `config` | excludes `capnwasm` and friends from `optimizeDeps` so HMR doesn't churn |

The plugin is tested against eight scenarios in `test/vite_plugin.test.mjs`:

- auto-discovery
- explicit `schemas` list with globs
- skipping `node_modules` / `dist`
- `outDir` redirects output cleanly
- invalid `extension` rejects at config time
- malformed schema with `failOnError: true` aborts
- malformed schema with `failOnError: false` logs but continues
- `writeIfChanged` keeps the file mtime stable on identical content
  (so dev-server file watchers don't loop)

## Comparison: with vs without the plugin

**Without the plugin** (manual codegen):

```bash
# Every time the schema changes:
npx capnwasm gen schemas/user.capnp -o schemas/user.gen.mjs
# Maybe wire it into a `prebuild` script. Maybe forget. Then debug for
# 20 minutes when the imports stop matching the wire.
```

**With the plugin**:

```bash
# Save schemas/user.capnp. The dev server already reloaded the page
# with the new types. There is no second step.
```

This is the structural answer to "I don't want a codegen step." There
isn't one. The bundler runs it.
