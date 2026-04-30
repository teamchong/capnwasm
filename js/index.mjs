// capnwasm: JS interface to the real capnproto C++ library compiled to wasm
// via zig cc (see cpp/build.sh). The wasm exports cpp_serialize_tape /
// cpp_deserialize_to_tape; this module produces a tape from a capnweb-shape
// JS value and parses a tape back into one.

import { CapnCpp } from "./cpp_loader.mjs";
import { TapeWriter, TapeReader } from "./tape_codec.mjs";

export { CapnCpp };

/**
 * Convenience: load the wasm module and return an object with
 * `serialize(value) -> Uint8Array` and `deserialize(bytes) -> value`.
 */
export async function load(wasmSource) {
  const cpp = await CapnCpp.load(wasmSource);
  return cpp;
}

export { TapeWriter, TapeReader };
