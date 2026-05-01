// Stream Cap'n Proto bytes from a ReadableStream (e.g. fetch response.body)
// directly into wasm linear memory at cpp_in_ptr(). No intermediate JS-side
// ArrayBuffer for the whole response — chunks land straight in wasm memory
// as they arrive. The Reader returned reads from there in place.

/**
 * Open a Cap'n Proto message by streaming bytes from `stream` directly
 * into wasm memory, then constructing a typed Reader over them.
 *
 * Usage:
 *   const r = await openFromStream(cpp, PrimitivesReader, response.body);
 *   r.foo, r.bar, ...
 *
 * @param {object} cpp - loaded CapnCpp instance
 * @param {Function} ReaderClass - generated Reader class (e.g. PrimitivesReader)
 * @param {ReadableStream<Uint8Array>} stream - source stream
 * @returns {Promise<object>} an instance of ReaderClass positioned on the parsed message
 */
export async function openFromStream(cpp, ReaderClass, stream) {
  const inPtr = cpp._exports.cpp_in_ptr();
  const inCap = cpp._exports.cpp_in_capacity();
  const dst = cpp._u8.subarray(inPtr, inPtr + inCap);

  const reader = stream.getReader();
  let pos = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (pos + value.length > inCap) {
        throw new Error(`stream payload exceeds scratch buffer (${inCap} bytes)`);
      }
      dst.set(value, pos);
      pos += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  if (pos === 0) throw new Error("stream produced no bytes");
  // cpp_any_open returns the data section pointer (truthy on success,
  // 0 only for an empty struct — also valid). Pass through to the Reader
  // so primitive getters can read from wasm memory directly.
  const dataPtr = cpp._exports.cpp_any_open(pos);
  return new ReaderClass(cpp, dataPtr);
}
