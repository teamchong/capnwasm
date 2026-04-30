# Wire inspector

A standalone Cap'n Proto wire inspector hosted as a single file on the docs site. **Not part of the npm package** — you don't pay for it in production. Paste one line into DevTools when you need to debug what's actually on the wire.

## One line

```js
const cw = await import("https://teamchong.github.io/capnwasm/inspect.js");
cw.inspect(fetch("/api/user.capnp"));
```

That's it. The console gets an expandable tree: segment count, root pointer, struct shape, list elements, embedded text, hex previews of binary data.

## What `inspect()` accepts

```js
cw.inspect(fetch("/api/user.capnp"));            // Promise<Response>
cw.inspect(response);                            // Response
cw.inspect(arrayBuffer);                         // ArrayBuffer
cw.inspect(uint8Array);                          // Uint8Array
cw.inspect(dataView);                            // DataView
```

Whatever shape you have, it figures out the bytes and walks them.

Returns a Promise that resolves to the decoded structure (so you can also do `const decoded = await cw.inspect(...)`).

## Schema-aware decode (optional)

If you have a generated reader and a loaded `CapnCpp`, you get field names instead of raw struct bytes:

```js
import { UserReader } from "./user.capnp.gen.mjs";
import { load } from "capnwasm/browser";

const cpp = await load(...);

cw.inspect(fetch("/api/user.capnp"), { reader: UserReader, cpp });
// → { id: 42n, name: "Alice", email: "...", joinedAtMs: ..., active: true, avatar: Uint8Array }
```

## What the schemaless walker shows

For a `User` message with `id: 42, name: "Alice", email: "alice@…", active: true, avatar: <8 bytes>`:

```
▾ Cap'n Proto frame  144 bytes, 1 segment(s)
   bytes: 144
   ▸ segments: [{ index: 0, words: 17, bytes: 136 }]
   ▾ root:
       kind: "struct"
       dataWords: 3
       ptrWords: 3
       data: "2a 00 00 00 00 00 00 00 00 00 c0 d3 50 ec 8b 01 …"
       ▸ dataDecoded: [{ word: 0, u64: 42n, ... }, ...]
       ▾ pointers:
           ▸ { kind: "text", length: 5, value: "Alice" }
           ▸ { kind: "text", length: 17, value: "alice@example.com" }
           ▸ { kind: "bytes", length: 8, preview: "01 02 03 04 05 06 07 08" }
```

Lists, composite-element lists, and far-pointer chasing all decode automatically. Cycles are guarded against (max depth 16).

## CSP fallback (rare)

If the page you're debugging has a strict `Content-Security-Policy: script-src 'self'`, dynamic `import()` from a different origin gets blocked. Fetch as text and evaluate locally instead:

```js
const src = await fetch("https://teamchong.github.io/capnwasm/inspect.js").then(r => r.text());
const cw = await new Function("const m={};const exports=m;" + src + "; return m")();
cw.inspect(...);
```

For most apps the dynamic-import form works fine. GitHub Pages serves with `Access-Control-Allow-Origin: *`, so no CORS issues.

## Why it's not in the npm package

- Production users never need it — debug-only weight shouldn't ship in `capnwasm`.
- A hosted single file is more discoverable from a stack trace ("paste this URL into your console").
- Versioning is implicit — the docs-site URL always serves the latest source.

If you want the file in your repo for offline use, copy it from `web/public/inspect.js` (it's checked in alongside the docs site assets) or grab it from the public URL once and commit it locally.

## Source

`js/inspect.mjs` in the main repo. Pure JS, no dependencies, ~17 KB / 5.5 KB gz. Walks the Cap'n Proto wire format directly — no wasm needed for the schemaless path. The schema-aware path delegates to whatever generated reader you pass in, which uses the wasm runtime you've already loaded.

11 tests in `test/inspect.test.mjs` cover schemaless walk, schema-aware decode, every input shape, malformed input rejection, and the depth guard.
