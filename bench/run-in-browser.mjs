// Runs in the browser. Loads the real capnproto C++ wasm and capnweb,
// executes each fixture, writes results into the page and exposes them
// via window.__benchResults for the Playwright runner to scrape.

import { CapnCpp } from "/js/cpp_loader.mjs";
import { fixtures } from "./fixtures.mjs";
import * as capnweb from "/capnweb-vendor/index.js";

const status = document.getElementById("status");
const results = document.getElementById("results");

function setStatus(msg) {
  status.textContent = msg;
  console.log("[bench]", msg);
}

async function run() {
  setStatus("Loading capnp_cpp.opt.wasm ...");
  const cpp = await CapnCpp.load("/zig-out/capnp_cpp.opt.wasm");

  const out = {
    sizes: await collectSizes(),
    perf: {},
    correctness: {},
  };

  setStatus("Running fixtures ...");
  for (const fx of fixtures) {
    out.perf[fx.name] = perfFor(cpp, fx);
    out.correctness[fx.name] = correctnessFor(cpp, fx);
  }

  results.textContent = JSON.stringify(out, null, 2);
  window.__benchResults = out;
  setStatus("Done.");
}

async function collectSizes() {
  const wasmBytes = await (await fetch("/zig-out/capnp_cpp.opt.wasm")).bytes();
  const capnwebBytes = await (await fetch("/capnweb-vendor/index.js")).bytes();
  return {
    capnp_cpp_raw: wasmBytes.length,
    capnweb_raw: capnwebBytes.length,
  };
}

function perfFor(cpp, fx) {
  const iters = fx.name.includes("large") || fx.name.includes("blob") || fx.name.includes("wide") ? 200 : 2000;
  const v = fx.value;

  const tCppEnc = bench(iters, () => cpp.serialize(v));
  const cppBytes = cpp.serialize(v);
  const tCppDec = bench(iters, () => cpp.deserialize(cppBytes));

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
    capnp_cpp_encode_us: tCppEnc.usPerOp,
    capnp_cpp_decode_us: tCppDec.usPerOp,
    capnweb_encode_us: tCwbEnc.usPerOp,
    capnweb_decode_us: tCwbDec.usPerOp,
    encode_speedup: tCwbEnc.usPerOp / tCppEnc.usPerOp,
    decode_speedup: tCwbDec.usPerOp / tCppDec.usPerOp,
    capnp_cpp_bytes: cppBytes.length,
    capnweb_bytes: cwbWireSize,
  };
}

function correctnessFor(cpp, fx) {
  try {
    const encoded = cpp.serialize(fx.value);
    const decoded = cpp.deserialize(encoded);
    const ok = JSON.stringify(decoded) === JSON.stringify(fx.value);
    return { ok, decoded, expected: fx.value };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function bench(iters, fn) {
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
