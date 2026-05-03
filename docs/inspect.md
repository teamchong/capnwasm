# Wire inspector

A standalone Cap'n Proto wire inspector hosted as a single file on the docs site. **Not part of the npm package**. You don't pay for it in production. Paste one line into DevTools when you need to debug what's actually on the wire.

DevTools' Network panel handles JSON natively (pretty-print, expand, search) so this tool is useless for JSON. The gap it fills is **capnp binary payloads**, which DevTools shows as raw bytes / `<Binary Data>` / failed-to-parse-as-text. No built-in decoder, no schema awareness. Paste the inspector and you get an expandable decoded tree.

## The actual workflow: copy from Network panel, paste

This is what you'll use 90% of the time. Already saw the request/response in DevTools, want to know what was on the wire:

```js
// Once per session: load the inspector
const cw = await import("https://capnwasm.teamchong.net/inspect.js");

// HTTP response body (right-click in Network panel → Copy response).
// DevTools gives you base64 for binary bodies.
cw.inspectBase64("CAAAAAYAAAA...");

// WebSocket frame (right-click in WS Frames tab → Copy).
// DevTools gives you hex (with or without spaces / 0x prefixes).
cw.inspectHex("08 00 00 00 06 00 00 00 ...");
```

Both produce the same expandable tree as the live-fetch path: segment count, root pointer, struct shape, list elements, embedded text, hex previews of binary data.

Tolerant of whatever DevTools actually pasted: whitespace, newlines, URL-safe base64, hex with `0x` prefixes / commas / colons all work.

## Live-fetch form (when you don't have the bytes yet)

If you want to fire a request from the console rather than re-using one DevTools already saw:

```js
cw.inspect(fetch("/api/user.capnp"));
```

`inspect()` accepts:

```js
cw.inspect(fetch("/api/user.capnp"));            // Promise<Response>
cw.inspect(response);                            // Response
cw.inspect(arrayBuffer);                         // ArrayBuffer
cw.inspect(uint8Array);                          // Uint8Array
cw.inspect(dataView);                            // DataView
```

Returns a Promise that resolves to the decoded structure, so `const decoded = await cw.inspect(...)` also works.

## Schema-aware decode (optional)

If you have a generated reader and a loaded `CapnCpp`, you get field names instead of raw struct bytes. The `{ reader, cpp }` opts work on every entry point — live fetch, copy-paste base64, or copy-paste hex:

```js
import { UserReader } from "./user.capnp.gen.mjs";
import { load } from "capnwasm/browser";

const cpp = await load(...);

cw.inspect(fetch("/api/user.capnp"), { reader: UserReader, cpp });
cw.inspectBase64("CAAAAAYAAAA...",   { reader: UserReader, cpp });
cw.inspectHex("08 00 00 00 ...",      { reader: UserReader, cpp });
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
const src = await fetch("https://capnwasm.teamchong.net/inspect.js").then(r => r.text());
const cw = await new Function("const m={};const exports=m;" + src + "; return m")();
cw.inspect(...);
```

For most apps the dynamic-import form works fine. GitHub Pages serves with `Access-Control-Allow-Origin: *`, so no CORS issues.

## Why it's not in the npm package

- Production users never need it. Debug-only weight shouldn't ship in `capnwasm`.
- A hosted single file is more discoverable from a stack trace ("paste this URL into your console").
- Versioning is implicit. The docs-site URL always serves the latest source.

If you want the file in your repo for offline use, copy it from `web/public/inspect.js` (it's checked in alongside the docs site assets) or grab it from the public URL once and commit it locally.

## Source

`js/inspect.mjs` in the main repo. Pure JS, no dependencies, ~17 KB / 5.5 KB gz. Walks the Cap'n Proto wire format directly. No wasm needed for the schemaless path. The schema-aware path delegates to whatever generated reader you pass in, which uses the wasm runtime you've already loaded.

11 tests in `test/inspect.test.mjs` cover schemaless walk, schema-aware decode, every input shape, malformed input rejection, and the depth guard.
