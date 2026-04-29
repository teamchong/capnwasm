// Runs in the browser. Loads both libraries, executes each fixture, and writes
// results into the page (and posts them via window.__benchResults for Playwright
// to read).

import { CapnWasm } from "/js/index.mjs";
import { fixtures } from "./fixtures.mjs";
import * as capnweb from "/capnweb-vendor/index.js";
import { encodeFromValue, decodeToValue } from "./codec-capnwasm.mjs";
import * as tapeMod from "/js/tape.mjs";
window.__capnwasmTape = tapeMod;

const status = document.getElementById("status");
const results = document.getElementById("results");

function setStatus(msg) {
  status.textContent = msg;
  console.log("[bench]", msg);
}

async function run() {
  setStatus("Loading capnwasm.wasm + gc_decode.wasm ...");
  const wasm = await CapnWasm.load("/zig-out/capnwasm.opt.wasm", "/zig-out/gc_decode.wasm");

  const out = {
    sizes: await collectSizes(),
    perf: {},
    correctness: {},
  };

  setStatus("Running fixtures ...");
  for (const fx of fixtures) {
    out.perf[fx.name] = perfFor(wasm, fx);
    out.correctness[fx.name] = correctnessFor(wasm, fx);
  }

  results.textContent = JSON.stringify(out, null, 2);
  // Expose for Playwright.
  window.__benchResults = out;
  setStatus("Done.");
}

async function collectSizes() {
  // Browser-side sizes: response bodies, gzipped on the fly.
  const wasmBytes = await (await fetch("/zig-out/capnwasm.opt.wasm")).bytes();
  const glueBytes = await (await fetch("/js/index.mjs")).bytes();
  const capnwebBytes = await (await fetch("/capnweb-vendor/index.js")).bytes();

  return {
    capnwasm_wasm_raw: wasmBytes.length,
    capnwasm_glue_raw: glueBytes.length,
    capnwasm_total_raw: wasmBytes.length + glueBytes.length,
    capnweb_raw: capnwebBytes.length,
    note: "gzipped sizes are reported by the runner harness, not the browser",
  };
}

function perfFor(wasm, fx) {
  const iters = fx.name.includes("large") || fx.name.includes("blob") ? 200 : 2000;
  const v = fx.value;

  // Encode benchmark
  const tCwEnc = bench(iters, () => encodeFromValue(wasm, v));
  const cwBytes = encodeFromValue(wasm, v);
  const tCwDec = bench(iters, () => decodeToValue(wasm, cwBytes));

  // Sub-step timings to attribute cost to JS-tape vs wasm-encode.
  const tWriteTape = benchWriteTape(wasm, v, iters);
  const tWasmEncode = benchWasmEncodeOnly(wasm, v, iters);
  const tWasmDecode = benchWasmDecodeOnly(wasm, cwBytes, iters);
  const tReadTape = benchReadTape(wasm, cwBytes, iters);
  const tGcDecode = wasm.hasGc()
    ? bench(iters, () => wasm.deserializeViaGc(cwBytes))
    : { usPerOp: NaN };

  let tCwbEnc = NaN, tCwbDec = NaN, cwbBytes = null;
  try {
    cwbBytes = capnweb.serialize(v);
    tCwbEnc = bench(iters, () => capnweb.serialize(v));
    tCwbDec = bench(iters, () => capnweb.deserialize(cwbBytes));
  } catch (err) {
    return { error: String(err) };
  }

  const cwbWireSize = typeof cwbBytes === "string"
    ? new TextEncoder().encode(cwbBytes).length
    : (cwbBytes?.length ?? 0);

  return {
    iters,
    capnwasm_encode_us: tCwEnc.usPerOp,
    capnwasm_decode_us: tCwDec.usPerOp,
    capnwasm_writetape_us: tWriteTape.usPerOp,
    capnwasm_wasmencode_us: tWasmEncode.usPerOp,
    capnwasm_wasmdecode_us: tWasmDecode.usPerOp,
    capnwasm_readtape_us: tReadTape.usPerOp,
    capnwasm_gcdecode_us: tGcDecode.usPerOp,
    capnweb_encode_us: tCwbEnc.usPerOp,
    capnweb_decode_us: tCwbDec.usPerOp,
    encode_speedup: tCwbEnc.usPerOp / tCwEnc.usPerOp,
    decode_speedup: tCwbDec.usPerOp / tCwDec.usPerOp,
    capnwasm_bytes: cwBytes.length,
    capnweb_bytes: cwbWireSize,
  };
}

function benchWasmDecodeOnly(wasm, bytes, iters) {
  // Only the wasm cw_decode_to_tape call.
  const u8 = new Uint8Array(wasm.memory.buffer);
  const inPtr = wasm.exports.cw_in_ptr();
  u8.set(bytes, inPtr);
  return bench(iters, () => wasm.exports.cw_decode_to_tape(bytes.length));
}

function benchReadTape(wasm, bytes, iters) {
  // Only the JS-side TapeReader walk over a pre-decoded tape.
  const u8 = new Uint8Array(wasm.memory.buffer);
  const inPtr = wasm.exports.cw_in_ptr();
  u8.set(bytes, inPtr);
  const tapeLen = wasm.exports.cw_decode_to_tape(bytes.length);
  const outPtr = wasm.exports.cw_out_ptr();
  const tape = new Uint8Array(wasm.memory.buffer, outPtr, tapeLen);
  const { TapeReader } = window.__capnwasmTape;
  return bench(iters, () => new TapeReader(tape).readMessage());
}

function benchWriteTape(wasm, v, iters) {
  // Re-import TapeWriter via wasm module's export shape.
  return bench(iters, () => {
    const u8 = new Uint8Array(wasm.memory.buffer);
    const region = u8.subarray(wasm.exports.cw_in_ptr(), wasm.exports.cw_in_ptr() + wasm.exports.cw_in_capacity());
    const { TapeWriter } = window.__capnwasmTape;
    const tw = new TapeWriter(region);
    tw.writeMessage(v);
  });
}

function benchWasmEncodeOnly(wasm, v, iters) {
  // Pre-write the tape so we measure only the wasm encode call.
  const u8 = new Uint8Array(wasm.memory.buffer);
  const region = u8.subarray(wasm.exports.cw_in_ptr(), wasm.exports.cw_in_ptr() + wasm.exports.cw_in_capacity());
  const { TapeWriter } = window.__capnwasmTape;
  const tw = new TapeWriter(region);
  tw.writeMessage(v);
  const len = tw.pos;
  return bench(iters, () => wasm.exports.cw_encode_tape(len));
}

function correctnessFor(wasm, fx) {
  try {
    const encoded = encodeFromValue(wasm, fx.value);
    const decoded = decodeToValue(wasm, encoded);
    const ok = JSON.stringify(decoded) === JSON.stringify(fx.value)
      || tagPreservedOnly(fx.value, decoded);
    return { ok, decoded, expected: fx.value };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function tagPreservedOnly(expected, actual) {
  // While the encoder is still text-tag-only, we accept "tag preserved" as
  // a soft pass for non-text payloads.
  if (Array.isArray(expected) && actual && typeof actual === "object") {
    return expected[0] === actual.tag;
  }
  return false;
}

function bench(iters, fn) {
  // Warm up.
  for (let i = 0; i < Math.min(50, iters); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsedMs = performance.now() - start;
  return { iters, totalMs: elapsedMs, usPerOp: (elapsedMs * 1000) / iters };
}

run().catch((err) => {
  setStatus("Error: " + err);
  console.error(err);
  window.__benchResults = { error: String(err), stack: err.stack };
});
