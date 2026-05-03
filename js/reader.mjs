// Reader-only entry point: loads dist/capnp.reader.wasm — the smallest
// self-contained read path. Use this if your code only consumes capnwasm
// responses via draft() projections / per-field getters and never sends
// requests, builds messages, or runs an RPC session.
//
// Bundle: ~47 KB raw / ~19 KB brotli (the full bundle is ~83 KB raw / ~30 KB
// brotli with builder + RPC + lazy reader + tape codec).
//
// Usage:
//   import { load } from "capnwasm/reader";
//   const cpp = await load(new URL("./capnp.reader.wasm", import.meta.url));
//
// Behaviour matches `capnwasm/browser` for the read path. Calls into
// builder / RPC / lazy reader paths against this runtime will throw or
// no-op — the corresponding cpp_* exports are not present in this wasm.
// Codegen Reader classes / openX functions / draft() / list project all
// work as in the full build.

import { CapnCpp } from "./cpp_loader.mjs";

export { CapnCpp };

function defaultWasmUrl() {
  return new URL("../dist/capnp.reader.wasm", import.meta.url);
}

export async function load(wasmUrl = defaultWasmUrl()) {
  return await CapnCpp.load(wasmUrl);
}
