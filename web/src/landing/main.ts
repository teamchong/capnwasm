// Landing-page metrics. Rule: every number shown in the headline block is
// either measured live in this browser against the current Worker server,
// or loaded from build-generated metrics emitted during `web` build.

// @ts-ignore — runtime imports from the parent capnwasm package.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder.
import { PrimitivesBuilder, PrimitivesReader } from "../../../js/conformance_schema.gen.mjs";
// @ts-ignore — generated playground reader used by the fetch smoke.
import { openUser } from "../playground/users.capnp.gen.mjs";
// @ts-ignore — internal RPC layer.
import { connectWebSocket } from "../../../js/rpc.mjs";
import { deserialize as cwbDeserialize, newWebSocketRpcSession } from "capnweb";

const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8 = 0;
const M_ECHO_BINARY = 2;

const SERVER = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

const $ = (id: string) => document.getElementById(id)!;

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function fmtMs(ms: number) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(2)} ms`;
}

function median(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function setMetric(id: string, text: string, cls = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `value ${cls}`.trim();
}

function speedVsCapnweb(ratio: number, capnwasmValue: string, capnwebValue: string) {
  if (ratio >= 1) {
    return `${ratio.toFixed(2)}× faster than capnweb (${capnwasmValue} capnwasm, ${capnwebValue} capnweb)`;
  }
  return `${(1 / ratio).toFixed(2)}× slower than capnweb (${capnwasmValue} capnwasm, ${capnwebValue} capnweb)`;
}

async function loadBuildMetrics() {
  const res = await fetch("/metrics/build.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`build metrics fetch failed: HTTP ${res.status}`);
  return await res.json();
}

async function renderBuildMetrics() {
  try {
    const m = await loadBuildMetrics();
    const bundles = m.bundles;
    const rpc = bundles.gzip.capnwasmRpc;
    const cw = bundles.gzip.capnweb;
    setMetric(
      "metric-bundle",
      `${fmtBytes(rpc)}; ${(rpc / cw).toFixed(2)}× capnweb`,
      "lose",
    );
  } catch (err) {
    setMetric("metric-bundle", "build metrics unavailable", "measuring");
    console.warn("landing build metrics failed", err);
  }
}

let cppPromise: Promise<any> | null = null;
async function ensureCpp() {
  if (!cppPromise) {
    const t0 = performance.now();
    cppPromise = load(new URL("/capnp.slim.wasm", location.origin));
    try {
      const cpp = await cppPromise;
      setMetric("metric-browser-load", `${fmtMs(performance.now() - t0)} this page load`, "");
      return cpp;
    } catch (err) {
      setMetric("metric-browser-load", "wasm init failed", "lose");
      throw err;
    }
  }
  return await cppPromise;
}

function newCpp() {
  return load(new URL("/capnp.slim.wasm", location.origin));
}

let capnwasmRoot: any = null;
let capnwasmBurstRoot: any = null;
async function ensureCapnwasmRoot(opts: { batchWindow?: boolean } = {}) {
  if (opts.batchWindow) {
    if (capnwasmBurstRoot) return capnwasmBurstRoot;
    const cpp = await newCpp();
    const session = await connectWebSocket(cpp, SERVER + "/capnwasm", { batchWindowMs: 2 });
    capnwasmBurstRoot = session.bootstrap();
    return capnwasmBurstRoot;
  }
  if (capnwasmRoot) return capnwasmRoot;
  const cpp = await newCpp();
  const session = await connectWebSocket(cpp, SERVER + "/capnwasm");
  capnwasmRoot = session.bootstrap();
  return capnwasmRoot;
}

let capnwebRoot: any = null;
async function ensureCapnwebRoot() {
  if (capnwebRoot) return capnwebRoot;
  capnwebRoot = newWebSocketRpcSession(SERVER + "/capnweb");
  return capnwebRoot;
}

async function burstCapnwasm(n: number): Promise<number> {
  const root = await ensureCapnwasmRoot({ batchWindow: true });
  const t0 = performance.now();
  const promises: Promise<number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = root.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
    r.params.u8 = i & 0xff;
    promises[i] = r.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.u8 }).promise;
  }
  await Promise.all(promises);
  return ((performance.now() - t0) * 1000) / n;
}

async function burstCapnweb(n: number): Promise<number> {
  const root = await ensureCapnwebRoot();
  const t0 = performance.now();
  const promises = new Array(n);
  for (let i = 0; i < n; i++) promises[i] = root.echoU8({ u8: i & 0xff });
  await Promise.all(promises);
  return ((performance.now() - t0) * 1000) / n;
}

async function blobCapnwasm(bytes: Uint8Array): Promise<{ ms: number; wire: number }> {
  const root = await ensureCapnwasmRoot();
  const t0 = performance.now();
  const r = root.callBuilder(IFC, M_ECHO_BINARY, PrimitivesBuilder);
  r.params.data = bytes;
  await r.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.data }).promise;
  return { ms: performance.now() - t0, wire: bytes.length * 2 + 64 };
}

async function blobCapnweb(bytes: Uint8Array): Promise<{ ms: number; wire: number }> {
  const root = await ensureCapnwebRoot();
  const t0 = performance.now();
  await root.echoBinary(bytes);
  return { ms: performance.now() - t0, wire: Math.ceil(bytes.length * 4 / 3) * 2 + 96 };
}

async function renderLiveMetrics() {
  try {
    await ensureCpp();
    await ensureCapnwebRoot();

    await burstCapnwasm(20);
    await burstCapnweb(20);

    const burstWasm: number[] = [];
    const burstWeb: number[] = [];
    for (let i = 0; i < 3; i++) {
      burstWasm.push(await burstCapnwasm(200));
      burstWeb.push(await burstCapnweb(200));
    }
    const burst = { wasm: median(burstWasm), web: median(burstWeb) };
    const burstRatio = burst.web / burst.wasm;
    setMetric(
      "metric-rpc-burst",
      speedVsCapnweb(burstRatio, `${burst.wasm.toFixed(1)} µs/call`, `${burst.web.toFixed(1)} µs/call`),
      burstRatio >= 1 ? "win" : "lose",
    );

    const bytes = new Uint8Array(64 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const blobWasm: { ms: number; wire: number }[] = [];
    const blobWeb: { ms: number; wire: number }[] = [];
    for (let i = 0; i < 3; i++) {
      blobWasm.push(await blobCapnwasm(bytes));
      blobWeb.push(await blobCapnweb(bytes));
    }
    const wasmMs = median(blobWasm.map((x) => x.ms));
    const webMs = median(blobWeb.map((x) => x.ms));
    const wasmWire = blobWasm[blobWasm.length - 1]!.wire;
    const webWire = blobWeb[blobWeb.length - 1]!.wire;
    const speedRatio = webMs / wasmMs;
    const wireSaving = 1 - wasmWire / webWire;
    setMetric(
      "metric-rpc-blob",
      `${speedVsCapnweb(speedRatio, fmtMs(wasmMs), fmtMs(webMs))}; ${(wireSaving * 100).toFixed(0)}% less wire`,
      speedRatio >= 1 && wireSaving > 0 ? "win" : "lose",
    );
  } catch (err) {
    setMetric("metric-rpc-burst", "live RPC unavailable", "measuring");
    setMetric("metric-rpc-blob", "live RPC unavailable", "measuring");
    console.warn("landing live metrics failed", err);
  }
}

type CompareKey = "rest" | "cwb" | "capnp";
type CompareResult = { key: CompareKey; label: string; totalMs: number; bytes: number };

const COMPARE_WORKLOAD = "blob";
const COMPARE_ROWS = 12;
const COMPARE_ITERS = 3;

function renderCompareRows(users: Array<{ id: unknown; name: string; email: string; active: boolean }>) {
  const sink = $("compare-sink");
  sink.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const u of users) {
    const li = document.createElement("li");
    li.textContent = `${u.id}  ${u.name}  ${u.email}  ${u.active ? "✓" : "·"}`;
    frag.appendChild(li);
  }
  sink.appendChild(frag);
  void sink.offsetHeight;
}

async function compareRest(): Promise<Omit<CompareResult, "key" | "label">> {
  const t0 = performance.now();
  const responses = await Promise.all(Array.from({ length: COMPARE_ROWS }, (_, i) => fetch(`/data/${COMPARE_WORKLOAD}/user-${i + 1}.json`)));
  const texts = await Promise.all(responses.map((r) => r.text()));
  let bytes = 0;
  const users = texts.map((text) => {
    bytes += text.length;
    return JSON.parse(text);
  });
  renderCompareRows(users);
  return { totalMs: performance.now() - t0, bytes };
}

async function compareCapnweb(): Promise<Omit<CompareResult, "key" | "label">> {
  const t0 = performance.now();
  const responses = await Promise.all(Array.from({ length: COMPARE_ROWS }, (_, i) => fetch(`/data/${COMPARE_WORKLOAD}/user-${i + 1}.cwb`)));
  const texts = await Promise.all(responses.map((r) => r.text()));
  let bytes = 0;
  const users = texts.map((text) => {
    bytes += text.length;
    return cwbDeserialize(text) as any;
  });
  renderCompareRows(users);
  return { totalMs: performance.now() - t0, bytes };
}

async function compareCapnwasm(): Promise<Omit<CompareResult, "key" | "label">> {
  const cpp = await ensureCpp();
  const t0 = performance.now();
  const responses = await Promise.all(Array.from({ length: COMPARE_ROWS }, (_, i) => fetch(`/data/${COMPARE_WORKLOAD}/user-${i + 1}.capnp`)));
  const buffers = await Promise.all(responses.map((r) => r.arrayBuffer()));
  let bytes = 0;
  const users = buffers.map((buf) => {
    const u8 = new Uint8Array(buf);
    bytes += u8.length;
    const r = openUser(cpp, u8);
    return { id: r.id, name: r.name, email: r.email, active: r.active };
  });
  renderCompareRows(users);
  return { totalMs: performance.now() - t0, bytes };
}

function setComparePlaceholder(text: string) {
  for (const key of ["rest", "cwb", "capnp"] as CompareKey[]) {
    $(`compare-${key}-payload`).textContent = text;
    $(`compare-${key}-time`).textContent = "time: —";
    ($(`compare-${key}-bar`) as HTMLElement).style.width = "0%";
    $(`compare-${key}-badge`).textContent = "";
    $(`compare-row-${key}`).classList.remove("winner");
  }
}

function renderCompareResults(results: CompareResult[]) {
  const smallest = Math.min(...results.map((r) => r.bytes));
  const largest = Math.max(...results.map((r) => r.bytes));
  const winner = results.find((r) => r.bytes === smallest)!;
  for (const r of results) {
    const width = largest > 0 ? (r.bytes / largest) * 100 : 0;
    const row = $(`compare-row-${r.key}`);
    row.classList.toggle("winner", r === winner);
    $(`compare-${r.key}-payload`).textContent = fmtBytes(r.bytes);
    $(`compare-${r.key}-time`).textContent = `time: ${fmtMs(r.totalMs)}`;
    ($(`compare-${r.key}-bar`) as HTMLElement).style.width = `${Math.max(8, width).toFixed(0)}%`;
    $(`compare-${r.key}-badge`).textContent = r === winner ? "smallest" : "";
  }
  const saved = 1 - winner.bytes / results.find((r) => r.key === "rest")!.bytes;
  $("compare-summary").textContent = `${winner.label} has the smallest payload in the fetch smoke (${(saved * 100).toFixed(0)}% smaller than REST/JSON). Bars show payload bytes; the time column is live and noisy.`;
}

async function renderInlineCompare() {
  try {
    setComparePlaceholder("running…");
    await ensureCpp();
    const samples: Record<CompareKey, number[]> = { rest: [], cwb: [], capnp: [] };
    const bytes: Record<CompareKey, number> = { rest: 0, cwb: 0, capnp: 0 };
    for (let i = 0; i < COMPARE_ITERS; i++) {
      const rest = await compareRest();
      const cwb = await compareCapnweb();
      const capnp = await compareCapnwasm();
      samples.rest.push(rest.totalMs); bytes.rest = rest.bytes;
      samples.cwb.push(cwb.totalMs); bytes.cwb = cwb.bytes;
      samples.capnp.push(capnp.totalMs); bytes.capnp = capnp.bytes;
    }
    renderCompareResults([
      { key: "rest", label: "REST / JSON", totalMs: median(samples.rest), bytes: bytes.rest },
      { key: "cwb", label: "capnweb", totalMs: median(samples.cwb), bytes: bytes.cwb },
      { key: "capnp", label: "capnwasm", totalMs: median(samples.capnp), bytes: bytes.capnp },
    ]);
  } catch (err) {
    setComparePlaceholder("unavailable");
    $("compare-summary").textContent = err instanceof Error ? err.message : String(err);
    console.warn("landing inline comparison failed", err);
  }
}

void (async () => {
  await renderBuildMetrics();
  await renderInlineCompare();
  await renderLiveMetrics();
})();
