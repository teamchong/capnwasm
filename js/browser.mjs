// Browser-optimized entrypoint: small JS shim that loads dist/capnp.slim.wasm
// over the network with WebAssembly.instantiateStreaming.
//
// Why this exists separately from the default `capnwasm` import:
//   The default is a single-file inlined bundle (base64-encoded wasm
//   embedded in the JS). Fine for Node, but in a browser that wastes
//   ~20 KB gzipped on base64 padding and forces a synchronous decode
//   before instantiation. This entrypoint:
//     - loads dist/capnp.slim.wasm (the production-only wasm, no
//       bench/test helpers)
//     - uses WebAssembly.instantiateStreaming so the browser parses
//       bytes as they arrive instead of waiting for the full buffer
//
// Usage:
//   import { load } from "capnwasm/browser";
//   const cpp = await load(new URL("./capnp.slim.wasm", import.meta.url));
//
// Bundlers (Vite, esbuild, Rollup with @rollup/plugin-url, etc) resolve the
// `new URL(..., import.meta.url)` form and copy the .wasm into your asset
// pipeline so it's hashed/cached alongside the rest of your build.

import {
  CapnCpp,
  MultiSegmentMessageError,
  validateSingleSegment,
} from "./cpp_loader.mjs";

export { CapnCpp, MultiSegmentMessageError, validateSingleSegment };

// Default URL. Used when load() is called with no argument. Keep this lazy:
// Workers/workerd can import this module only to access `CapnCpp.load(module)`,
// and workerd doesn't always expose an import.meta.url shape that accepts
// relative URL resolution during module evaluation.
function defaultWasmUrl() {
  return new URL("../dist/capnp.slim.wasm", import.meta.url);
}

export async function load(wasmUrl = defaultWasmUrl()) {
  return await CapnCpp.load(wasmUrl);
}
