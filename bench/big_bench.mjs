// Properly-measured bench using BigUser (256 fields) — workloads are big
// enough that timings are in tens of microseconds, well above timer noise.
//
// Methodology:
//   - Time-budgeted iterations: each measurement runs to a fixed wall-clock
//     budget (default 100 ms) so faster workloads do more iterations.
//   - 5 trials per measurement, report median + min, plus relative spread.
//   - Explicit warm-up: 200 ms of warm-up before each measurement.
//   - Pre-bound all wasm exports to local consts (avoid V8 lookup overhead
//     leaking into the timing).

import { CapnCpp } from "/js/cpp_loader.mjs";
import * as capnweb from "/capnweb-vendor/index.js";
import { openBigUser, BigUserReader } from "/js/big_schema.gen.mjs";

const status = document.getElementById("status");
const results = document.getElementById("results");

function setStatus(msg) {
  status.textContent = msg;
  console.log("[bench]", msg);
}

/**
 * Run `fn` until at least `budgetMs` of wall time has elapsed.
 * Returns ns/op (median of 5 trials).
 */
function timed(fn, { budgetMs = 100, warmMs = 200, trials = 5 } = {}) {
  // Warm-up: drive JIT, hidden classes, code caches.
  let warmEnd = performance.now() + warmMs;
  while (performance.now() < warmEnd) fn();

  const samples = [];
  for (let t = 0; t < trials; t++) {
    let iters = 0;
    const start = performance.now();
    const deadline = start + budgetMs;
    while (performance.now() < deadline) {
      fn(); fn(); fn(); fn(); fn(); fn(); fn(); fn();  // 8 unrolled calls per loop
      iters += 8;
    }
    const elapsed = performance.now() - start;
    samples.push((elapsed * 1e6) / iters);  // ns/op
  }
  samples.sort((a, b) => a - b);
  return {
    medianNs: samples[Math.floor(trials / 2)],
    minNs: samples[0],
    maxNs: samples[trials - 1],
    spread: (samples[trials - 1] - samples[0]) / samples[Math.floor(trials / 2)],
  };
}

async function run() {
  setStatus("Loading wasm ...");
  const cpp = await CapnCpp.load("/zig-out/capnp_cpp.opt.wasm");

  // Stage real BigUser bytes via the C++ test-data builder.
  const len = cpp._exports.cpp_make_big_user_bytes();
  if (!len) throw new Error("cpp_make_big_user_bytes failed");
  const cppBytes = cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);

  // Build the equivalent capnweb-shape value + its serialized form.
  const obj = {};
  for (let i = 0; i < 256; i++) {
    obj[`field${i}`] = `v${i}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
  }
  const cwbStr = capnweb.serialize(obj);

  // Bind exports locally so V8 doesn't redo property lookups during timing.
  const exp = cpp._exports;
  const cpp_any_open = exp.cpp_any_open;
  const cpp_any_text_at = exp.cpp_any_text_at;
  const cpp_in_ptr = exp.cpp_in_ptr();
  const cpp_out_ptr = exp.cpp_out_ptr();
  cpp._u8.set(cppBytes, cpp_in_ptr);  // stage once

  setStatus("Running ...");

  // ---- Workload 1: read 5 fields ----
  const cwbRead5 = () => {
    const v = capnweb.deserialize(cwbStr);
    return v.field0.length + v.field63.length + v.field127.length +
           v.field191.length + v.field255.length;
  };
  // Raw wasm calls — does NOT materialize JS strings. Useful as a lower bound
  // showing how much of the time is JS-side string materialization vs wasm.
  const cppRead5 = () => {
    cpp_any_open(cppBytes.length);
    return cpp_any_text_at(0) + cpp_any_text_at(63) + cpp_any_text_at(127) +
           cpp_any_text_at(191) + cpp_any_text_at(255);
  };
  // Sanity: the reader API path that real users use
  const cppRead5UsingReader = () => {
    const r = openBigUser(cpp, cppBytes);
    return r.field0.length + r.field63.length + r.field127.length +
           r.field191.length + r.field255.length;
  };

  // ---- Workload 2: read all 256 fields ----
  const cwbReadAll = () => {
    const v = capnweb.deserialize(cwbStr);
    let total = 0;
    for (let i = 0; i < 256; i++) total += v[`field${i}`].length;
    return total;
  };
  // Per-field path: 256 wasm boundary calls, one materialization per field.
  const cppReadAll = () => {
    const r = openBigUser(cpp, cppBytes);
    let total = 0;
    for (let i = 0; i < 256; i++) total += r[`field${i}`].length;
    return total;
  };

  // JSON-emit path: wasm walks all fields and writes a JSON object string.
  // JS does one TextDecoder + JSON.parse — V8's hottest object-construction
  // path. Goal: actually beat capnweb on full materialization too.
  const cpp_big_user_emit_json = exp.cpp_big_user_emit_json;
  const SHARED_TEXT_DECODER = new TextDecoder();
  const cppReadAllJson = () => {
    cpp_any_open(cppBytes.length);
    const len = cpp_big_user_emit_json();
    const u8 = cpp._u8;
    return JSON.parse(SHARED_TEXT_DECODER.decode(u8.subarray(cpp_out_ptr, cpp_out_ptr + len)));
  };

  // Batched path: ONE wasm call walks all 256 fields and packs them into
  // scratch_out. JS reads with one tight loop. Builds the equivalent JS
  // object so the comparison stays apples-to-apples with capnweb's full
  // deserialize result.
  const cpp_big_user_all_packed = exp.cpp_big_user_all_packed;
  const cppReadAllBatched = () => {
    cpp_any_open(cppBytes.length);
    const total = cpp_big_user_all_packed();
    const u8 = cpp._u8;
    const dv = new DataView(u8.buffer, cpp_out_ptr, total);
    const obj = {};
    let pos = 0;
    for (let i = 0; i < 256; i++) {
      const flen = dv.getUint32(pos, true);
      pos += 4;
      const start = cpp_out_ptr + pos;
      // Inline ASCII materialization (no TextDecoder overhead per call).
      let s = "";
      for (let j = 0; j < flen; j++) s += String.fromCharCode(u8[start + j]);
      obj[`field${i}`] = s;
      pos += flen;
    }
    return Object.keys(obj).length;
  };

  const out = {
    fixture: { cppBytes: cppBytes.length, cwbBytes: cwbStr.length },
    read5: {
      capnweb:    timed(cwbRead5),
      cpp_raw:    timed(cppRead5),
      cpp_reader: timed(cppRead5UsingReader),
    },
    readAll: {
      capnweb:       timed(cwbReadAll),
      cpp:           timed(cppReadAll),
      cpp_batched:   timed(cppReadAllBatched),
      cpp_json_emit: timed(cppReadAllJson),
    },
  };

  results.textContent = JSON.stringify(out, null, 2);
  window.__bigBenchResults = out;
  setStatus("Done.");
}

run().catch((err) => {
  setStatus("Error: " + err);
  console.error(err);
  window.__bigBenchResults = { error: String(err), stack: err.stack };
});
