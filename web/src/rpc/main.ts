// Live RPC bench in the browser. Connects two WebSocket sessions to the
// same Node server (web/server.mjs) — one per protocol — and runs three
// workloads:
//
//   1. burst   200 echoU8 calls fired in the same tick (microtask
//              batching test — capnwasm's headline perf claim)
//   2. pipe    getChild() + echoU8() chained on the unresolved answer
//              (promise pipelining; both libraries do this)
//   3. blob    echoBinary(64 KB) round-trip (binary wire vs base64 JSON)
//
// All numbers are median of N iterations; the warmup pass is excluded.

// @ts-ignore — generated module without a .d.ts wired in.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder.
import { PrimitivesBuilder, PrimitivesReader } from "../../../js/conformance_schema.gen.mjs";
// @ts-ignore — internal RPC layer; types not bundled.
import { RpcSession, connectWebSocket } from "../../../js/rpc.mjs";
import { newWebSocketRpcSession } from "capnweb";

const $ = (id: string) => document.getElementById(id)!;
// The RPC server runs on the same origin in both supported local modes:
// `pnpm dev` (Wrangler Worker, deployed-shape) and `pnpm dev:vite`
// (Vite plugin shim for frontend iteration).
const SERVER =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8     = 0;
const M_ECHO_TEXT   = 1;
const M_ECHO_BINARY = 2;
const M_GET_CHILD   = 3;

const status = $("status");
const summary = $("summary");
const runBtn = $("run-btn") as HTMLButtonElement;
const itersSel = $("iters-selector") as HTMLSelectElement;
const serverDot = $("server-dot");
const serverMsg = $("server-msg");

// Deep-link the iters selector via ?iters=N. Lets people share a URL
// to "show me the 10-iter median" without explaining how to set it.
{
  const want = new URLSearchParams(location.search).get("iters");
  if (want && Array.from(itersSel.options).some((o) => o.value === want)) {
    itersSel.value = want;
  }
  itersSel.addEventListener("change", () => {
    const p = new URLSearchParams();
    p.set("iters", itersSel.value);
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
  });
}

function fmtMs(ms: number) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(2)} ms`;
}
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function probeServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER + "/capnwasm");
    const t = setTimeout(() => { ws.close(); resolve(false); }, 1500);
    ws.onopen  = () => { clearTimeout(t); ws.close(); resolve(true);  };
    ws.onerror = () => { clearTimeout(t);            resolve(false); };
  });
}

// ---- capnwasm session helpers ------------------------------------------
let cppRoot: any = null;
async function ensureCapnwasm() {
  if (cppRoot) return cppRoot;
  const cpp = await load(new URL("/capnp.slim.wasm", location.origin));
  const session = await connectWebSocket(cpp, SERVER + "/capnwasm");
  cppRoot = session.bootstrap();
  return cppRoot;
}

let cwbRoot: any = null;
async function ensureCapnweb() {
  if (cwbRoot) return cwbRoot;
  cwbRoot = newWebSocketRpcSession(SERVER + "/capnweb");
  return cwbRoot;
}

// ---- workloads ---------------------------------------------------------

async function burstCapnwasm(n: number): Promise<number> {
  const root = await ensureCapnwasm();
  const t0 = performance.now();
  const promises: Promise<number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = root.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
    r.params.u8 = i & 0xff;
    promises[i] = r.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.u8 }).promise;
  }
  await Promise.all(promises);
  // performance.now() is in ms; convert to µs/call.
  return ((performance.now() - t0) * 1000) / n;
}

async function burstCapnweb(n: number): Promise<number> {
  const root = await ensureCapnweb();
  const t0 = performance.now();
  const promises = new Array(n);
  for (let i = 0; i < n; i++) {
    promises[i] = root.echoU8({ u8: i & 0xff });
  }
  await Promise.all(promises);
  return ((performance.now() - t0) * 1000) / n;
}

async function pipeCapnwasm(): Promise<number> {
  const root = await ensureCapnwasm();
  const t0 = performance.now();
  // First call: getChild() — capnwasm pipelines the second on its
  // unresolved answer, so both Calls go on the wire before any Return.
  const r1 = root.callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();
  const r2 = r1.cap.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
  r2.params.u8 = 9;
  await r2.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.u8 }).promise;
  return performance.now() - t0;
}

async function pipeCapnweb(): Promise<number> {
  const root = await ensureCapnweb();
  const t0 = performance.now();
  // capnweb pipelines via JS-side promise composition — methods called
  // on a pending promise chain on the receiver in order.
  const child = root.getChild();
  await child.echoU8({ u8: 9 });
  return performance.now() - t0;
}

async function blobCapnwasm(bytes: Uint8Array): Promise<{ ms: number; wire: number }> {
  const root = await ensureCapnwasm();
  const t0 = performance.now();
  const r = root.callBuilder(IFC, M_ECHO_BINARY, PrimitivesBuilder);
  r.params.data = bytes;
  await r.send({
    resultsReader: PrimitivesReader,
    extract: (rdr: any) => rdr.data,
  }).promise;
  return { ms: performance.now() - t0, wire: bytes.length * 2 + 64 /* approx */ };
}

async function blobCapnweb(bytes: Uint8Array): Promise<{ ms: number; wire: number }> {
  const root = await ensureCapnweb();
  const t0 = performance.now();
  const result = await root.echoBinary(bytes);
  // capnweb base64-encodes Uint8Array → roughly 4*ceil(N/3) chars per
  // direction in the JSON. Rough estimate: 4/3 inflation × 2 directions.
  return { ms: performance.now() - t0, wire: Math.ceil(bytes.length * 4 / 3) * 2 + 96 };
}

// ---- runner ------------------------------------------------------------

async function runAll() {
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  summary.className = "";
  summary.textContent = "";
  const iters = parseInt(itersSel.value, 10);

  // Set every metric cell to a pulsing "running…" so the page makes
  // it obvious that a bench is in flight, not stuck on stale data.
  for (const id of [
    "burst-capnp", "burst-cwb", "burst-capnp-x", "burst-cwb-x",
    "pipe-capnp",  "pipe-cwb",  "pipe-capnp-x",  "pipe-cwb-x",
    "blob-capnp",  "blob-cwb",  "blob-capnp-bytes", "blob-cwb-bytes",
  ]) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = "running…";
      el.className = "running";
    }
  }

  status.textContent = "Connecting…";
  await ensureCapnwasm();
  await ensureCapnweb();

  // Warmup
  status.textContent = "Warmup…";
  await burstCapnwasm(20); await burstCapnweb(20);
  await pipeCapnwasm();   await pipeCapnweb();

  // Burst
  const burstCapnp: number[] = [];
  const burstCwb:   number[] = [];
  for (let i = 0; i < iters; i++) {
    status.textContent = `Burst — iter ${i + 1}/${iters}`;
    burstCapnp.push(await burstCapnwasm(200));
    burstCwb.push(  await burstCapnweb(200));
  }

  // Pipelining
  const pipeCapnp: number[] = [];
  const pipeCwb:   number[] = [];
  for (let i = 0; i < iters; i++) {
    status.textContent = `Pipelining — iter ${i + 1}/${iters}`;
    pipeCapnp.push(await pipeCapnwasm());
    pipeCwb.push(  await pipeCapnweb());
  }

  // Big-blob round-trip
  const blob = new Uint8Array(64 * 1024);
  for (let i = 0; i < blob.length; i++) blob[i] = i & 0xff;
  const blobCapnp: number[] = [];
  const blobCwb:   number[] = [];
  let wireCapnp = 0, wireCwb = 0;
  for (let i = 0; i < iters; i++) {
    status.textContent = `64 KB blob — iter ${i + 1}/${iters}`;
    const a = await blobCapnwasm(blob); blobCapnp.push(a.ms); wireCapnp = a.wire;
    const b = await blobCapnweb(blob);  blobCwb.push(b.ms);   wireCwb   = b.wire;
  }

  // Render results. Per-row "win" goes to the lower number.
  const setRow = (id: string, value: string, win: boolean) => {
    const td = $(id);
    td.textContent = value;
    td.className = "big" + (win ? " win" : "");
  };
  const setRatio = (id: string, ratio: number) => {
    const td = $(id);
    td.textContent = ratio === 1 ? "1.00× (baseline)" : (ratio < 1 ? `${(1 / ratio).toFixed(2)}× faster` : `${ratio.toFixed(2)}× slower`);
    td.className = "ratio";
  };

  const burstM = { capnp: median(burstCapnp), cwb: median(burstCwb) };
  setRow("burst-capnp", `${burstM.capnp.toFixed(2)} µs/call`, burstM.capnp < burstM.cwb);
  setRow("burst-cwb",   `${burstM.cwb.toFixed(2)} µs/call`,   burstM.cwb   < burstM.capnp);
  setRatio("burst-capnp-x", burstM.capnp / burstM.cwb);
  setRatio("burst-cwb-x",   burstM.cwb   / burstM.capnp);

  const pipeM = { capnp: median(pipeCapnp), cwb: median(pipeCwb) };
  setRow("pipe-capnp", fmtMs(pipeM.capnp), pipeM.capnp < pipeM.cwb);
  setRow("pipe-cwb",   fmtMs(pipeM.cwb),   pipeM.cwb   < pipeM.capnp);
  setRatio("pipe-capnp-x", pipeM.capnp / pipeM.cwb);
  setRatio("pipe-cwb-x",   pipeM.cwb   / pipeM.capnp);

  const blobM = { capnp: median(blobCapnp), cwb: median(blobCwb) };
  setRow("blob-capnp", fmtMs(blobM.capnp), blobM.capnp < blobM.cwb);
  setRow("blob-cwb",   fmtMs(blobM.cwb),   blobM.cwb   < blobM.capnp);
  $("blob-capnp-bytes").textContent = `~${fmtBytes(wireCapnp)} on wire`;
  $("blob-cwb-bytes").textContent   = `~${fmtBytes(wireCwb)} on wire`;
  $("blob-capnp-bytes").className = wireCapnp < wireCwb ? "win" : "";
  $("blob-cwb-bytes").className   = wireCwb   < wireCapnp ? "win" : "";

  const wins =
    (burstM.capnp < burstM.cwb ? 1 : 0) +
    (pipeM.capnp  < pipeM.cwb  ? 1 : 0) +
    (blobM.capnp  < blobM.cwb  ? 1 : 0);

  if (wins >= 2) {
    summary.className = "win";
    summary.innerHTML = `<strong>capnwasm wins ${wins} of 3</strong>. Burst ${(burstM.cwb / burstM.capnp).toFixed(2)}×, pipeline ${(pipeM.cwb / pipeM.capnp).toFixed(2)}×, 64 KB blob ${(blobM.cwb / blobM.capnp).toFixed(2)}×. Wire bytes for the blob: ~${fmtBytes(wireCapnp)} capnwasm vs ~${fmtBytes(wireCwb)} capnweb.`;
  } else {
    summary.className = "lose";
    summary.innerHTML = `capnweb wins ${3 - wins} of 3 on this run &mdash; burst, pipeline, blob numbers fluctuate with local/same-origin RTT. Try a few iterations or a slower link to see the gap widen on the bytes-bound workload.`;
  }
  status.textContent = `done — ${iters} iter (median)`;
  runBtn.disabled = false;
  runBtn.textContent = "Run all workloads";
}

let inFlight = false;
async function runSafe() {
  if (inFlight) return;
  inFlight = true;
  try { await runAll(); }
  finally { inFlight = false; }
}
runBtn.addEventListener("click", runSafe);

// Probe the server up front and gate the Run button on it.
(async () => {
  const up = await probeServer();
  if (up) {
    serverDot.classList.add("up");
    serverMsg.innerHTML = `Server up at <code>${SERVER}</code> &mdash; ready.`;
    runBtn.disabled = false;
    setTimeout(runSafe, 100);
  } else {
    serverDot.classList.add("down");
    serverMsg.innerHTML = `<strong>RPC server unreachable.</strong> Run <code>pnpm dev</code> from the repo root for the Wrangler-backed server, or <code>pnpm dev:vite</code> for the Vite-only shim.`;
    status.textContent = "RPC server unreachable — see banner above.";
  }
})();
