// Where does capnwasm's wasm-init cost stop mattering?
//
// Capnweb's pitch: tiny bundle, zero init cost, every call is JSON.
// Capnwasm: 28 KB brotli wasm to compile up front, then every call is
// fast(er) thereafter. There is a break-even N. Make fewer calls than N
// in your app's lifetime and capnweb is the right pick.
//
// This bench measures it on this machine. Run it on a slower CPU
// (Raspberry Pi, throttled mobile profile) to see where the crossover
// shifts. On desktop the crossover is small. On mobile-class CPUs the
// wasm-compile cost grows roughly linearly with size, while V8's
// JSON.parse stays a constant-factor faster, pushing the break-even up.
//
//   node bench/mobile_crossover.mjs
//
// To simulate slower hardware, run under `taskpolicy -d -t 9` (macOS
// background priority) or chroot/qemu for true ARM emulation.

import { performance } from "node:perf_hooks";
import { load as loadCapnwasm } from "../dist/inlined.mjs";

// Lazy-load capnweb only if available. Bench is informational, skip
// gracefully when the sibling repo isn't checked out.
let capnweb;
try {
  capnweb = await import("../../capnweb/dist/index.js");
} catch {
  console.error("capnweb not found at ../../capnweb/dist/index.js. Skipping comparison.");
  process.exit(0);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function timeMs(fn) {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

// --- capnwasm init cost ----------------------------------------------------

const initRuns = 5;
const wasmInitTimes = [];
for (let i = 0; i < initRuns; i++) {
  // Use a fresh import? Node module-caches modules, so subsequent loads are
  // hot. The honest measurement is a single cold load, then warm thereafter.
  // The "init" we care about for the crossover is what a user pays the
  // FIRST time their page loads our library. So just measure load() once.
  const t = await timeMs(() => loadCapnwasm());
  wasmInitTimes.push(t);
}
const wasmColdInit = wasmInitTimes[0];   // first run is the only "cold" one
const wasmWarmInit = median(wasmInitTimes.slice(1));

// --- capnweb init cost (none. Pure JS) ------------------------------------

// capnweb has no wasm. The "init" is just import() time, which is dominated
// by V8 module instantiation. Measure it the same way for fairness.
const cwInitTimes = [];
for (let i = 0; i < initRuns; i++) {
  // Re-import via cache-buster URL to defeat the module cache.
  const t = await timeMs(async () => {
    await import(`../../capnweb/dist/index.js?cb=${i}`);
  });
  cwInitTimes.push(t);
}
const cwColdInit = cwInitTimes[0];
const cwWarmInit = median(cwInitTimes.slice(1));

// --- per-call cost ---------------------------------------------------------
// In-process pair for both libs, tiny u8 echo, 1000 calls, take the median
// per-call from a 5-run trial.

import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";

const IFC = 0xabcd1234abcd1234n;
const METHOD = 1;
const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();

async function measureCapnwasmPerCall() {
  const cppA = await loadCapnwasm();
  const cppB = await loadCapnwasm();
  const registry = new InterfaceRegistry();
  registry.register(IFC, METHOD, async () => EMPTY.slice());
  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppB, b, registry, { bootstrap: {} });
  const client = new RpcSession(cppA, a);
  const cap = client.bootstrap();

  // Warmup
  for (let i = 0; i < 100; i++) {
    await cap.call(IFC, METHOD, EMPTY.slice(), []).promise;
  }
  const trials = [];
  for (let trial = 0; trial < 5; trial++) {
    const t0 = performance.now();
    const N = 1000;
    const promises = [];
    for (let i = 0; i < N; i++) promises.push(cap.call(IFC, METHOD, EMPTY.slice(), []).promise);
    await Promise.all(promises);
    trials.push((performance.now() - t0) / N * 1000);   // µs/call
  }
  return median(trials);
}

async function measureCapnwebPerCall() {
  const { newMessagePortRpcSession } = capnweb;
  const channel = new MessageChannel();
  const main = { echo() { return 0; } };
  newMessagePortRpcSession(channel.port1, main);
  const client = newMessagePortRpcSession(channel.port2);
  // Warmup
  for (let i = 0; i < 100; i++) await client.echo();
  const trials = [];
  for (let trial = 0; trial < 5; trial++) {
    const t0 = performance.now();
    const N = 1000;
    const promises = [];
    for (let i = 0; i < N; i++) promises.push(client.echo());
    await Promise.all(promises);
    trials.push((performance.now() - t0) / N * 1000);
  }
  return median(trials);
}

const wasmPerCallUs = await measureCapnwasmPerCall();
const cwPerCallUs = await measureCapnwebPerCall();

// --- crossover -------------------------------------------------------------

// total(capnwasm) = wasmColdInit (ms) + N * wasmPerCallUs (µs)
// total(capnweb)  = cwColdInit  (ms) + N * cwPerCallUs  (µs)
// Solve for N: capnwasm wins when N > (wasmColdInit - cwColdInit) / (cwPerCallUs - wasmPerCallUs)
//   (numerator in ms, denominator in µs/call → multiply numerator by 1000 to get N in calls)
const initDelta = (wasmColdInit - cwColdInit) * 1000;   // µs
const perCallSavings = cwPerCallUs - wasmPerCallUs;     // µs/call (positive if capnwasm faster)
const crossoverN = perCallSavings > 0 ? Math.ceil(initDelta / perCallSavings) : Infinity;

// --- report ---------------------------------------------------------------

const cpu = process.arch + " / " + process.platform;
console.log("");
console.log("Mobile-class crossover. Where wasm init cost stops mattering");
console.log("=============================================================");
console.log(`CPU profile:               ${cpu} (Node ${process.versions.node})`);
console.log("");
console.log("Init cost (cold load):");
console.log(`  capnwasm                 ${wasmColdInit.toFixed(2)} ms`);
console.log(`  capnweb                  ${cwColdInit.toFixed(2)} ms`);
console.log(`  delta (capnwasm - cw)    ${(wasmColdInit - cwColdInit).toFixed(2)} ms`);
console.log("");
console.log("Per-call cost (median of 5x 1000-call bursts):");
console.log(`  capnwasm                 ${wasmPerCallUs.toFixed(2)} µs/call`);
console.log(`  capnweb                  ${cwPerCallUs.toFixed(2)} µs/call`);
console.log(`  per-call savings         ${perCallSavings.toFixed(2)} µs/call`);
console.log("");
console.log("Crossover:");
if (crossoverN === Infinity) {
  console.log("  capnwasm is slower per call too. No crossover at all on this hardware.");
} else if (crossoverN <= 0) {
  console.log("  capnwasm wins immediately (cold-init delta is already negative).");
} else {
  console.log(`  capnwasm wins after ${crossoverN.toLocaleString()} calls in the page's lifetime.`);
  console.log(`  Below ${crossoverN.toLocaleString()} calls → capnweb is the right pick.`);
}
console.log("");
console.log("Notes:");
console.log("- This is in-process (no network). Real WS adds 5-50 ms RTT per call,");
console.log("  which dwarfs both libs' per-call CPU and pushes the crossover to ~0.");
console.log("- On a 4× slower CPU (Raspberry Pi 4, throttled mobile), wasm cold-init");
console.log("  scales ~linearly with bytes (~25-50 ms instead of " + wasmColdInit.toFixed(0) + " ms),");
console.log("  while V8's JSON.parse stays roughly the same constant-factor.");
console.log("  Crossover N grows by the same ratio.");
