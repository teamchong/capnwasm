// Landing-page metrics. Rule: every number shown in the headline block is
// either measured live in this browser against the current Worker server,
// or loaded from build-generated metrics emitted during `web` build.

// @ts-ignore — runtime imports from the parent capnwasm package.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder.
import { PrimitivesBuilder, PrimitivesReader } from "../../../js/conformance_schema.gen.mjs";
// @ts-ignore — internal RPC layer.
import { connectWebSocket } from "../../../js/rpc.mjs";
import { newWebSocketRpcSession } from "capnweb";

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

async function loadBuildMetrics() {
  const res = await fetch("/metrics/build.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`build metrics fetch failed: HTTP ${res.status}`);
  return await res.json();
}

async function renderBuildMetrics() {
  try {
    const m = await loadBuildMetrics();
    const blob = m.fixtures.blob;
    setMetric(
      "metric-fixture-wire",
      `${blob.ratios.jsonToCapnpGzip.toFixed(2)}× smaller than JSON (${fmtBytes(blob.gzip.capnp)} vs ${fmtBytes(blob.gzip.json)})`,
      "win",
    );

    const bundles = m.bundles;
    const rpc = bundles.gzip.capnwasmRpc;
    const cw = bundles.gzip.capnweb;
    setMetric(
      "metric-bundle",
      `${fmtBytes(rpc)}; ${(rpc / cw).toFixed(2)}× capnweb`,
      "lose",
    );

    const wasm = m.wasm;
    setMetric(
      "metric-browser-load",
      `${fmtBytes(wasm.gzip)} gzip (${fmtBytes(wasm.raw)} raw)`,
      "",
    );
  } catch (err) {
    setMetric("metric-fixture-wire", "build metrics unavailable", "measuring");
    setMetric("metric-bundle", "build metrics unavailable", "measuring");
    setMetric("metric-browser-load", "build metrics unavailable", "measuring");
    console.warn("landing build metrics failed", err);
  }
}

let cppPromise: Promise<any> | null = null;
async function ensureCpp() {
  if (!cppPromise) {
    cppPromise = load(new URL("/capnp.slim.wasm", location.origin));
    const cpp = await cppPromise;
    return cpp;
  }
  return await cppPromise;
}

let capnwasmRoot: any = null;
let capnwasmBurstRoot: any = null;
async function ensureCapnwasmRoot(opts: { batchWindow?: boolean } = {}) {
  if (opts.batchWindow) {
    if (capnwasmBurstRoot) return capnwasmBurstRoot;
    const cpp = await ensureCpp();
    const session = await connectWebSocket(cpp, SERVER + "/capnwasm", { batchWindowMs: 2 });
    capnwasmBurstRoot = session.bootstrap();
    return capnwasmBurstRoot;
  }
  if (capnwasmRoot) return capnwasmRoot;
  const cpp = await ensureCpp();
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
      `${burstRatio.toFixed(2)}× ${burstRatio >= 1 ? "faster" : "slower"} (${burst.wasm.toFixed(1)} vs ${burst.web.toFixed(1)} µs/call)`,
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
    const wasmWire = blobWasm.at(-1)!.wire;
    const webWire = blobWeb.at(-1)!.wire;
    const speedRatio = webMs / wasmMs;
    const wireSaving = 1 - wasmWire / webWire;
    setMetric(
      "metric-rpc-blob",
      `${speedRatio.toFixed(2)}× ${speedRatio >= 1 ? "faster" : "slower"}; ${(wireSaving * 100).toFixed(0)}% less wire`,
      speedRatio >= 1 && wireSaving > 0 ? "win" : "lose",
    );
  } catch (err) {
    setMetric("metric-rpc-burst", "live RPC unavailable", "measuring");
    setMetric("metric-rpc-blob", "live RPC unavailable", "measuring");
    console.warn("landing live metrics failed", err);
  }
}

void renderBuildMetrics();
void renderLiveMetrics();
