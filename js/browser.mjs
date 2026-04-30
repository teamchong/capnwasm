// Browser-optimized entrypoint: small JS shim that loads dist/capnp.slim.wasm
// over the network with WebAssembly.instantiateStreaming.
//
// Why this exists separately from `capnwasm/slim`:
//   capnwasm/slim is a single-file inlined bundle — fine for Node, but the
//   wasm is base64-encoded inside the JS, which inflates the on-the-wire
//   bytes by ~33% before gzip recovers most. For a browser, shipping the
//   .wasm as a separate asset is smaller (no base64 padding) and faster
//   (streaming compile parses bytes as they arrive).
//
// Usage:
//   import { load } from "capnwasm/browser";
//   const cpp = await load(new URL("./capnp.slim.wasm", import.meta.url));
//
// Bundlers (Vite, esbuild, Rollup with @rollup/plugin-url, etc) resolve the
// `new URL(..., import.meta.url)` form and copy the .wasm into your asset
// pipeline so it's hashed/cached alongside the rest of your build.

import { CapnCpp } from "./cpp_loader.mjs";

export { CapnCpp };

// Default URL — used when load() is called with no argument. Resolves the
// .wasm relative to this module's URL so it works whether the package is
// imported from node_modules, a CDN, or a local path.
const DEFAULT_WASM_URL = new URL("../dist/capnp.slim.wasm", import.meta.url);

export async function load(wasmUrl = DEFAULT_WASM_URL) {
  return await CapnCpp.load(wasmUrl);
}
