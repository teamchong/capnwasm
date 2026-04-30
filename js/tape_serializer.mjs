// Capnweb-shape tape encode/decode against the C++ wasm runtime.
//
// Split out of cpp_loader.mjs so bundles that don't use the tape codec
// (e.g. RPC-only browser clients) tree-shake the entire tape_codec.mjs
// graph (~3 KB gzipped). Use these as free functions:
//
//   import { serialize, deserialize } from "capnwasm/tape";
//   const bytes = serialize(cpp, { hello: "world" });
//   const value = deserialize(cpp, bytes);

import { TapeWriter, TapeReader } from "./tape_codec.mjs";

/** Encode a capnweb-shape message via the real C++ capnproto runtime. */
export function serialize(cpp, value) {
  const u8 = cpp._u8;
  const tapeArea = u8.subarray(cpp._inPtr, cpp._inPtr + cpp._cap);
  const tw = new TapeWriter(tapeArea);
  tw.writeMessage(value);
  const len = cpp._exports.cpp_serialize_tape(tw.pos);
  if (!len) throw new Error("cpp_serialize_tape failed");
  return cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);
}

/** Decode Cap'n Proto framed bytes via the C++ runtime. */
export function deserialize(cpp, bytes) {
  if (bytes.length > cpp._cap) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._inPtr);
  const tapeLen = cpp._exports.cpp_deserialize_to_tape(bytes.length);
  if (!tapeLen) throw new Error("cpp_deserialize_to_tape failed");
  const tape = cpp._u8.subarray(cpp._outPtr, cpp._outPtr + tapeLen);
  return new TapeReader(tape).readMessage();
}
