// Drives capnwasm's tape-based encoder/decoder for capnweb-shape JS values.
// Compatibility target: equivalent to capnweb.serialize/deserialize.

export function encodeFromValue(wasm, value) {
  return wasm.serialize(value);
}

export function decodeToValue(wasm, bytes) {
  return wasm.deserialize(bytes);
}
