# capnwasm

Zig + WasmGC implementation of Cap'n Proto RPC for the browser.

## Status

Working end-to-end: a Zig core compiled to wasm32 encodes/decodes capnweb-shape
RPC messages into Cap'n Proto wire bytes, with a single `wasm-opt` post-process
pass to add advanced wasm features. Conformance is verified by round-tripping
seven representative fixtures inside Chromium via Playwright.

## Honest size comparison

Comparing single-file bundles (inlined wasm, one network fetch):

| Bundle                                   | Raw    | Gzip      |
|------------------------------------------|--------|-----------|
| capnwasm `dist/capnwasm.bundle.mjs`      | 55 KB  | **20.8 KB** |
| capnweb `dist/index.js`                  | 103 KB | **21.1 KB** |

We are 47% smaller raw but **essentially tied at gzip** because base64-encoding
the wasm for inlining inflates the source by ~33%, eating most of the wasm
compression win. Splitting wasm into a separate fetch shrinks the gzip total
to ~16.7 KB but costs an extra round-trip.

## Build

```bash
zig build test           # native unit tests for the Zig core
zig build opt            # build + wasm-opt -O3
node bench/runner.mjs    # Playwright bench vs capnweb
```

The bench expects sibling clones of [`capnweb`](https://github.com/cloudflare/capnweb) at
`../capnweb` so it can import the built `dist/index.js`.

## Architecture

```
src/wire.zig     Cap'n Proto wire format (pointers, segments, struct/list)
src/packing.zig  Cap'n Proto packed encoding
src/rpc.zig      capnweb-shaped RPC bookkeeping (imports/exports/refcounts)
src/tape.zig     Single-pass tape ↔ Cap'n Proto encoder/decoder
src/wasm.zig     C-ABI wasm exports + scratch buffers
js/index.mjs     CapnWasm class — public JS API
js/tape.mjs      JS-side tape walker (encode/decode JS values)
bench/           Playwright runner + browser fixture
```

The hot path uses two fixed scratch regions in linear memory:

1. JS walks the value tree once and writes a compact byte tape into
   `cw_in_ptr`. The tape carries everything needed to materialize the
   message — types, lengths, payloads.
2. Zig reads the tape, builds the Cap'n Proto message in a 2 MB bump arena,
   and writes the framed bytes directly into `cw_out_ptr`.

Decode flips the path: Cap'n Proto bytes go in, a tape comes out, JS reads
the tape into a value. No wasm-side allocations beyond the bump arena, no
handle-table lookups.

## Conformance

The bench fixtures cover:

- Method calls with pipelining
- Heterogeneous objects (~2 KB)
- Arrays of homogeneous objects (~16 KB)
- Binary blobs (64 KB)
- Deeply chained pipelines
- Bare `pull` and `release` control messages

All seven round-trip exactly through `serialize` → bytes → `deserialize`.

## Where the time goes

Sub-step timing in the bench attributes encode cost to JS-tape vs WASM-encode.
WASM encode is fast (≈ 1.5 GB/s for large structured payloads). The
remaining gap to capnweb on raw encode/decode is:

- **Wire size**: a polymorphic Expression struct uses 2 data words + 4 pointer
  slots, so each tree node costs 48 bytes minimum. capnweb's JSON is more
  compact for arrays of small objects.
- **Wasm boundary**: ≈ 0.1–0.2 µs per call dominates trivial messages.

What capnwasm wins on:

- **Bundle size** — `wasm + glue` is ~0.6× of capnweb gzipped.
- **Binary blob wire size** — raw bytes vs base64 gives ~25% smaller payloads.
- **Decode of deep pipelines** — wasm decode beats capnweb's JSON parse here.

## Next steps

- WasmGC outer layer: pass JS objects through as `externref` so the JS↔Zig
  boundary doesn't require a tape at all.
- Tighter Expression schema using specialized struct types per variant to
  shrink wire size on object/array-heavy payloads.
- Lazy reader API: don't materialize the JS value tree in `deserialize`;
  return a proxy that fetches fields on access.
