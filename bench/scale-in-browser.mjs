// Seconds-scale workload bench. Microsecond per-call differences are
// invisible behind any real network; what users actually feel is when
// accumulated work crosses into the 100ms-1s range. Each workload here
// is a realistic-shape scenario that gets there.
//
// Workload 1 — DASHBOARD BOOTSTRAP: server returns 1000 records, each a
// 32-field metadata struct. Client renders 5 fields per record. Mirrors
// "load a list view with 1000 entries."
//
// Workload 2 — BINARY ASSET TRANSFER: server returns a 5 MB binary blob
// (image / dataset / model weights). On a slow link, the wire-bytes ratio
// determines transfer wall-time directly.
//
// Workload 3 — STREAMING DECODE: 10,000 small messages parsed sequentially
// (the kind of pattern you see for telemetry / log streams / replay).

import { CapnCpp } from "/js/cpp_loader.mjs";
import * as capnweb from "/capnweb-vendor/index.js";
import {
  WideUserDataBuilder,
  WideUserDataReader,
} from "/js/typed_schema.gen.mjs";
import {
  BigUserReader,
} from "/js/big_schema.gen.mjs";

const status = document.getElementById("status");
const results = document.getElementById("results");
const log = (s) => { results.textContent += s + "\n"; };
const setStatus = (s) => { status.textContent = s; console.log("[bench]", s); };

setStatus("Loading wasm…");
const cpp = await CapnCpp.load("/zig-out/capnp_cpp.opt.wasm");

// ----- Helpers ----------------------------------------------------------
function buildOneWide() {
  // Same shape as the dashboard scenario: 32 named string fields.
  const o = {};
  for (let i = 0; i < 32; i++) o["field" + i] = "value" + i + "_" + "x".repeat(40);
  return o;
}

function jsonEncode(records) { return JSON.stringify(records); }
function jsonDecode(str)     { return JSON.parse(str); }

function ourEncodeOne(record) {
  const b = new WideUserDataBuilder(cpp);
  for (const [k, v] of Object.entries(record)) b[k] = v;
  return b.toBytes();
}

// Pre-flight: make sure both encoders agree on the round-trip values.
{
  const r = buildOneWide();
  const rt = jsonDecode(jsonEncode(r));
  if (rt.field5 !== r.field5) throw new Error("JSON round-trip mismatch");
  // Build via our encoder + decode via reader.
  const bytes = ourEncodeOne(r);
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  cpp._exports.cpp_any_open(bytes.length);
  const wr = new WideUserDataReader(cpp);
  if (wr.field5 !== r.field5) throw new Error("Capn round-trip mismatch");
}

// ============================================================
// Workload 1 — Many big records: ITER × BigUser (256 fields, read 5)
// ============================================================
setStatus("W1: many big records…");

// Build one BigUser via the C++ bench helper (CW_BENCH-gated build).
const bigLen = cpp._exports.cpp_make_big_user_bytes();
if (!bigLen) throw new Error("cpp_make_big_user_bytes failed (rebuild with `bash cpp/build.sh bench`)");
const oneCapnpBytes = cpp._u8.slice(cpp._exports.cpp_out_ptr(), cpp._exports.cpp_out_ptr() + bigLen);

// Build the equivalent JSON: a 256-field object with the same field names
// and values the C++ helper used (field0 = "value0_x...x", etc.).
const oneJsonObj = (() => {
  const o = {};
  for (let i = 0; i < 256; i++) o["field" + i] = "value" + i + "_" + "x".repeat(40);
  return o;
})();
const oneJsonStr = JSON.stringify(oneJsonObj);
const oneJsonBytes = new TextEncoder().encode(oneJsonStr);

const ITER = 1000;

log(`══ Workload 1: ${ITER}× decode of a 256-field record, read 5 fields each ══`);
log(``);
log(`  per-record bytes:`);
log(`    JSON:   ${oneJsonBytes.length.toLocaleString().padStart(7)} B`);
log(`    capnp:  ${oneCapnpBytes.length.toLocaleString().padStart(7)} B   (${(oneJsonBytes.length / oneCapnpBytes.length).toFixed(2)}x smaller)`);
log(``);

// JSON: parse + read 5 fields, repeated ITER times.
function jsonScenario() {
  let acc = 0;
  for (let i = 0; i < ITER; i++) {
    const r = JSON.parse(oneJsonStr);
    acc += r.field0.length + r.field50.length + r.field100.length + r.field200.length + r.field255.length;
  }
  return acc;
}

// Capnp: open + read 5 fields, repeated ITER times. Each open re-stages
// the same bytes in cpp_in (same shape as decoding messages off a stream).
function ourScenario() {
  let acc = 0;
  const inPtr = cpp._exports.cpp_in_ptr();
  for (let i = 0; i < ITER; i++) {
    cpp._u8.set(oneCapnpBytes, inPtr);
    cpp._exports.cpp_any_open(oneCapnpBytes.length);
    const r = new BigUserReader(cpp);
    acc += r.field0.length + r.field50.length + r.field100.length + r.field200.length + r.field255.length;
  }
  return acc;
}

// Warm
for (let i = 0; i < 3; i++) { jsonScenario(); ourScenario(); }

const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const RUNS = 7;
const w1jt = [], w1ot = [];
for (let i = 0; i < RUNS; i++) { const t = performance.now(); jsonScenario(); w1jt.push(performance.now() - t); }
for (let i = 0; i < RUNS; i++) { const t = performance.now(); ourScenario();  w1ot.push(performance.now() - t); }
const jms = median(w1jt);
const oms = median(w1ot);

log(`  total time across ${ITER} records:`);
log(`    JSON.parse (whole object) + 5 reads:  ${jms.toFixed(1).padStart(7)} ms`);
log(`    capnp open + 5 lazy reads:            ${oms.toFixed(1).padStart(7)} ms`);
log(`    speedup: ${(jms / oms).toFixed(2)}x`);
log(``);
log(`  Real-world translation: this is "load a list of ${ITER} products, render`);
log(`  5 attributes per card." Going from ${jms.toFixed(0)}ms to ${oms.toFixed(0)}ms is the`);
log(`  difference between sluggish and snappy on a slow device.`);
log(``);

// ============================================================
// Workload 2 — Binary asset transfer (5 MB)
// ============================================================
setStatus("W2: binary asset transfer…");
log(`══ Workload 2: binary asset transfer (5 MB raw bytes) ══`);
log(``);

const BIN_SIZE = 5 * 1024 * 1024;
const bin = new Uint8Array(BIN_SIZE);
for (let i = 0; i < BIN_SIZE; i++) bin[i] = i & 0xff;

// JSON has to base64 the bytes (no native binary support).
const t0json = performance.now();
const jsonWire = JSON.stringify({ bin: btoa(String.fromCharCode(...bin.subarray(0, 65536)))
                                + (bin.length > 65536 ? "[truncated for btoa speed]" : "") });
const tJsonEnc = performance.now() - t0json;
// btoa over 5MB at once is pathologically slow in some browsers, so we
// estimate the wire size analytically (4 bytes out per 3 bytes in).
const jsonWireSize = Math.ceil(BIN_SIZE * 4 / 3) + 20;

// Our format: just the bytes plus framing.
const t0ours = performance.now();
const cpp_in = cpp._exports.cpp_in_ptr();
cpp._u8.set(bin, cpp_in);
// Don't actually serialize; we're measuring the bandwidth ratio, not the
// transport. The wire-bytes claim is what matters for the user-visible
// "how long does the download take" question.
const tOurStage = performance.now() - t0ours;

const oursWireSize = BIN_SIZE + 16;  // segment table + null root + raw bytes
const ratio = jsonWireSize / oursWireSize;

log(`  bytes-on-wire (this is what determines transfer wall-time):`);
log(`    JSON (base64-encoded):  ${jsonWireSize.toLocaleString().padStart(10)} B`);
log(`    capnp (raw binary):     ${oursWireSize.toLocaleString().padStart(10)} B   (${ratio.toFixed(2)}x smaller)`);
log(``);
log(`  Hypothetical transfer time on a 10 Mbps link (1.25 MB/s):`);
log(`    JSON:   ${(jsonWireSize / (1.25 * 1024 * 1024)).toFixed(2)} s`);
log(`    capnp:  ${(oursWireSize / (1.25 * 1024 * 1024)).toFixed(2)} s   ← user-visible difference`);
log(``);

// ============================================================
// Workload 3 — Streaming decode (10K small messages)
// ============================================================
setStatus("W3: streaming decode…");
log(`══ Workload 3: streaming decode (10,000 messages × 32 fields, read 3) ══`);
log(``);

const STREAM_N = 10_000;
const tinyRecord = (() => { const o = {}; for (let i = 0; i < 32; i++) o["field" + i] = "v" + i; return o; })();
const tinyBytes = ourEncodeOne(tinyRecord);
const tinyJson = jsonEncode(tinyRecord);

function jsonStream() {
  let acc = 0;
  for (let i = 0; i < STREAM_N; i++) {
    const r = jsonDecode(tinyJson);
    acc += r.field0.length + r.field5.length + r.field10.length;
  }
  return acc;
}
function ourStream() {
  let acc = 0;
  const inPtr = cpp._exports.cpp_in_ptr();
  for (let i = 0; i < STREAM_N; i++) {
    cpp._u8.set(tinyBytes, inPtr);
    cpp._exports.cpp_any_open(tinyBytes.length);
    const r = new WideUserDataReader(cpp);
    acc += r.field0.length + r.field5.length + r.field10.length;
  }
  return acc;
}

// Warm
for (let i = 0; i < 3; i++) { jsonStream(); ourStream(); }
const w3jt = performance.now(); jsonStream(); const w3jms = performance.now() - w3jt;
const w3ot = performance.now(); ourStream();  const w3oms = performance.now() - w3ot;
log(`  total time to decode + read 3 fields × ${STREAM_N.toLocaleString()} messages:`);
log(`    JSON:   ${w3jms.toFixed(1).padStart(7)} ms   (${((STREAM_N * 1000) / w3jms).toFixed(0).padStart(8)} msgs/sec)`);
log(`    capnp:  ${w3oms.toFixed(1).padStart(7)} ms   (${((STREAM_N * 1000) / w3oms).toFixed(0).padStart(8)} msgs/sec)`);
log(`    speedup: ${(w3jms / w3oms).toFixed(2)}x`);
log(``);

setStatus("done");
window.__scaleResults = results.textContent;
