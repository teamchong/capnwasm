// Head-to-head: capnweb HTTP batch vs capnwasm HTTP batch.
//
// Both transports get the same in-process Request/Response shim. No real
// HTTP, no real network. So the numbers reflect pure encode/decode and
// boundary-crossing overhead. Network RTT will dominate any of this in
// practice; the point of this bench is to measure what the libraries cost
// on top of the network.
//
// Run: node bench/http_batch_bench.mjs
//
// Workloads:
//   1. Single tiny call (latency floor)
//   2. Burst of 100 concurrent calls in one tick (pipelining)
//   3. Single 10 KB string echo (payload-dominated)
//
// Each workload reports per-iteration time (median of 5 runs after a 1000-
// call warmup).

import { performance } from "node:perf_hooks";

import { load as loadWasm } from "../dist/inlined.mjs";
import { InterfaceRegistry } from "../js/rpc.mjs";
import {
  connectHttpBatch,
  createHttpBatchHandler,
} from "../js/http_batch.mjs";

import {
  newHttpBatchRpcSession,
  newHttpBatchRpcResponse,
  RpcTarget,
} from "../../capnweb/dist/index.js";

/* ------------------------------------------------------------------ */
/*  capnwasm setup                                                    */
/* ------------------------------------------------------------------ */

const ECHO_IFC = 0xab1234ff00cc0001n;

// Build a 1-segment Cap'n Proto frame whose root pointer points at a
// Text blob (length encoded inline). The server's handler echoes the
// paramsBytes back, so the bench measures pure transport overhead with
// a real-shape framed message.
function buildTextFrame(text) {
  const bytes = new TextEncoder().encode(text);
  // pad to 8-byte word boundary, +1 word for null terminator slot
  const dataWords = Math.ceil((bytes.length + 1) / 8);
  // Frame: [4 B segCount-1][4 B segLen][8 B root ptr][8*dataWords B data]
  const total = 4 + 4 + 8 + 8 * dataWords;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);            // segCount - 1 = 0
  dv.setUint32(4, 1 + dataWords, true);// segment length in words
  // Root pointer: list pointer to byte list immediately after the pointer
  // tag = 1 (list), offset = 0, elementSize = 2 (bytes), count = bytes.length+1
  // word low: tag=1 | (offset<<2) = 1 ; word high: count<<3 | elemSize=2
  dv.setUint32(8, 1, true);
  dv.setUint32(12, ((bytes.length + 1) << 3) | 2, true);
  out.set(bytes, 16);
  return out;
}

async function setupCapnwasm() {
  const cppServer = await loadWasm();
  const cppClient = await loadWasm();
  const registry = new InterfaceRegistry();
  registry.register(ECHO_IFC, 0, async (target, ctx) => {
    // Echo paramsBytes verbatim. Measures transport overhead, not codegen.
    return ctx.paramsBytes();
  });
  const handler = createHttpBatchHandler(cppServer, registry, { bootstrap: {} });
  const fetchShim = async (_url, init) => {
    const req = new Request("http://test.local/rpc", {
      method: init.method, headers: init.headers, body: init.body,
    });
    return handler(req);
  };
  const session = connectHttpBatch(cppClient, "http://test.local/rpc", {
    fetch: fetchShim, registry,
  });
  const cap = session.bootstrap();

  async function callEcho(text) {
    const params = buildTextFrame(text);
    const { bytes } = await cap.call(ECHO_IFC, 0, params).promise;
    return bytes;
  }

  return { callEcho, close: () => session.close() };
}

/* ------------------------------------------------------------------ */
/*  capnweb setup                                                     */
/* ------------------------------------------------------------------ */

class EchoApi extends RpcTarget {
  echo(text) { return text; }
}

async function setupCapnweb() {
  // capnweb's HTTP batch session is single-use: one session = one batch =
  // one HTTP request, then teardown. For sequential calls each iteration
  // gets its own session. For burst-of-N calls in one tick, ONE session
  // packs all N calls into one POST (which is the design).
  const fetchShim = async (_url, init) => {
    const req = new Request("http://test.local/rpc", {
      method: init.method, headers: init.headers, body: init.body,
    });
    return newHttpBatchRpcResponse(req, new EchoApi());
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchShim;
  // Each callEcho creates a new session. Matches the documented capnweb
  // pattern for stateless request/response.
  const callEcho = (text) => {
    const api = newHttpBatchRpcSession("http://test.local/rpc");
    return api.echo(text);
  };
  // For burst calls, the caller must reuse one session within the tick,
  // so expose a factory.
  const newBurstSession = () => newHttpBatchRpcSession("http://test.local/rpc");
  return {
    callEcho,
    newBurstSession,
    close: () => { globalThis.fetch = realFetch; },
  };
}

/* ------------------------------------------------------------------ */
/*  Bench harness                                                     */
/* ------------------------------------------------------------------ */

function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timed(fn, iters) {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn(i);
  return performance.now() - t0;
}

async function bench(name, fn, iters, runs = 5) {
  // Warmup
  await timed(fn, 1000);
  const samples = [];
  for (let r = 0; r < runs; r++) {
    samples.push(await timed(fn, iters));
  }
  const med = median(samples);
  return { name, iters, totalMs: med, perCallUs: (med * 1000) / iters };
}

async function benchBurst(name, fn, batchSize, runs = 5) {
  // Warmup
  await Promise.all(Array.from({ length: 1000 }, (_, i) => fn(i)));
  const samples = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: batchSize }, (_, i) => fn(i)));
    samples.push(performance.now() - t0);
  }
  const med = median(samples);
  return { name, iters: batchSize, totalMs: med, perCallUs: (med * 1000) / batchSize };
}

function fmtRow(label, capnwasm, capnweb) {
  const wasmStr = capnwasm.perCallUs.toFixed(2) + " µs";
  const webStr = capnweb.perCallUs.toFixed(2) + " µs";
  const ratio = capnwasm.perCallUs / capnweb.perCallUs;
  const winner = ratio < 1
    ? `capnwasm ${(1 / ratio).toFixed(2)}× faster`
    : `capnweb ${ratio.toFixed(2)}× faster`;
  console.log(`| ${label.padEnd(36)} | ${wasmStr.padStart(10)} | ${webStr.padStart(10)} | ${winner} |`);
}

/* ------------------------------------------------------------------ */
/*  Run                                                               */
/* ------------------------------------------------------------------ */

const TINY = "ok";
const BIG = "x".repeat(10240);

async function main() {
  const wasm = await setupCapnwasm();
  const web = await setupCapnweb();

  console.log("HTTP batch: capnwasm vs capnweb (in-process, same workload)\n");
  console.log("| Workload                             | capnwasm   | capnweb    | Winner |");
  console.log("|--------------------------------------|------------|------------|--------|");

  // 1. Single tiny call. Sequential
  const tinyW = await bench("tiny seq", (i) => wasm.callEcho(TINY), 200);
  const tinyB = await bench("tiny seq", (i) => web.callEcho(TINY), 200);
  fmtRow("Single tiny call (sequential)", tinyW, tinyB);

  // 2. Burst of 100 in same tick. Pipelining/batching
  // capnweb requires reusing the same session within a tick to batch.
  const burstW = await benchBurst("burst-100", (i) => wasm.callEcho(TINY), 100);
  const burstB = await (async () => {
    // Warmup
    for (let r = 0; r < 1000 / 100; r++) {
      const s = web.newBurstSession();
      await Promise.all(Array.from({ length: 100 }, () => s.echo(TINY)));
    }
    const samples = [];
    for (let r = 0; r < 5; r++) {
      const s = web.newBurstSession();
      const t0 = performance.now();
      await Promise.all(Array.from({ length: 100 }, () => s.echo(TINY)));
      samples.push(performance.now() - t0);
    }
    const med = median(samples);
    return { name: "burst-100", iters: 100, totalMs: med, perCallUs: (med * 1000) / 100 };
  })();
  fmtRow("Burst of 100 calls (1 tick)", burstW, burstB);

  // 3. 10 KB payload echo
  const bigW = await bench("big seq", (i) => wasm.callEcho(BIG), 100);
  const bigB = await bench("big seq", (i) => web.callEcho(BIG), 100);
  fmtRow("10 KB string echo (sequential)", bigW, bigB);

  wasm.close();
  web.close();
}

main().catch(err => { console.error(err); process.exit(1); });
