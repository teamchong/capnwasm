// Build/live metrics for vs-capnweb.html.
//
// Rule: values derived from current artifacts (bundle sizes, fixture wire
// bytes) are loaded from /metrics/build.json. Lightweight RPC rows are
// measured live from this browser against the current Worker. Heavy render
// benchmark rows remain snapshots and link to the live benchmark pages.

// @ts-ignore — runtime imports from the parent capnwasm package.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder.
import { PrimitivesBuilder, PrimitivesReader } from "../../../js/conformance_schema.gen.mjs";
// @ts-ignore — generated reader/builder for render-bench params.
import { CountParamsBuilder } from "../playground/users.capnp.gen.mjs";
// @ts-ignore — generated wide-metadata reader.
import { WideUserDataReader } from "../../../js/typed_schema.gen.mjs";
// @ts-ignore — internal RPC layer.
import { connectWebSocket } from "../../../js/rpc.mjs";
import { newWebSocketRpcSession } from "capnweb";

const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8 = 0;
const M_ECHO_TEXT = 1;
const M_GET_CHILD = 3;
const RENDER_IFC = 0xb1a5c0deb1a5c0den;
const RENDER_M_METADATA = 1;

const WS_ORIGIN = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

const $ = (id: string) => document.getElementById(id)!;

function fmtBytes(b: number): string {
  if (!Number.isFinite(b)) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(2)} ms`;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function setText(id: string, value: string): void {
  const el = $(id);
  el.textContent = value;
}

function setMetric(id: string, value: string, win = false): void {
  const el = $(id);
  el.textContent = value;
  el.className = win ? "win" : "";
}

function setCell(id: string, value: number): void {
  setText(id, fmtBytes(value));
}

async function loadBuildMetrics(): Promise<any> {
  const res = await fetch("/metrics/build.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`build metrics fetch failed: HTTP ${res.status}`);
  return await res.json();
}

let cppPromise: Promise<any> | null = null;
async function ensureCpp(): Promise<any> {
  if (!cppPromise) cppPromise = load(new URL("/capnp.slim.wasm", location.origin));
  return await cppPromise;
}

let capnwasmRoot: any = null;
let capnwasmBurstRoot: any = null;
async function ensureCapnwasmRoot(opts: { batchWindow?: boolean } = {}): Promise<any> {
  if (opts.batchWindow) {
    if (capnwasmBurstRoot) return capnwasmBurstRoot;
    const cpp = await ensureCpp();
    const session = await connectWebSocket(cpp, WS_ORIGIN + "/capnwasm", { batchWindowMs: 2 });
    capnwasmBurstRoot = session.bootstrap();
    return capnwasmBurstRoot;
  }
  if (capnwasmRoot) return capnwasmRoot;
  const cpp = await ensureCpp();
  const session = await connectWebSocket(cpp, WS_ORIGIN + "/capnwasm");
  capnwasmRoot = session.bootstrap();
  return capnwasmRoot;
}

let capnwebRoot: any = null;
async function ensureCapnwebRoot(): Promise<any> {
  if (capnwebRoot) return capnwebRoot;
  capnwebRoot = newWebSocketRpcSession(WS_ORIGIN + "/capnweb");
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

async function textCapnwasm(text: string): Promise<number> {
  const root = await ensureCapnwasmRoot();
  const t0 = performance.now();
  const r = root.callBuilder(IFC, M_ECHO_TEXT, PrimitivesBuilder);
  r.params.text = text;
  await r.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.text }).promise;
  return performance.now() - t0;
}

async function textCapnweb(text: string): Promise<number> {
  const root = await ensureCapnwebRoot();
  const t0 = performance.now();
  await root.echoText(text);
  return performance.now() - t0;
}

async function tinyCapnwasm(): Promise<number> {
  const root = await ensureCapnwasmRoot();
  const t0 = performance.now();
  const r = root.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
  r.params.u8 = 7;
  await r.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.u8 }).promise;
  return performance.now() - t0;
}

async function tinyCapnweb(): Promise<number> {
  const root = await ensureCapnwebRoot();
  const t0 = performance.now();
  await root.echoU8({ u8: 7 });
  return performance.now() - t0;
}

async function capPassCapnwasm(): Promise<number> {
  const root = await ensureCapnwasmRoot();
  const t0 = performance.now();
  const r1 = root.callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();
  const r2 = r1.cap.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
  r2.params.u8 = 9;
  await r2.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.u8 }).promise;
  return performance.now() - t0;
}

async function capPassCapnweb(): Promise<number> {
  const root = await ensureCapnwebRoot();
  const t0 = performance.now();
  const child = root.getChild();
  await child.echoU8({ u8: 9 });
  return performance.now() - t0;
}

async function sparseCapnwasm(): Promise<number> {
  const root = await ensureCapnwasmRoot();
  const t0 = performance.now();
  const r = root.callBuilder(RENDER_IFC, RENDER_M_METADATA, CountParamsBuilder);
  r.params.n = 0;
  await r.send({
    resultsReader: WideUserDataReader,
    extract: (rdr: any) => rdr.draft((m: any) => ({
      field0: m.field0,
      field5: m.field5,
      field10: m.field10,
    })),
  }).promise;
  return performance.now() - t0;
}

async function sparseCapnweb(): Promise<number> {
  const root = await ensureCapnwebRoot();
  const t0 = performance.now();
  const o = await root.getMetadata();
  void o.field0;
  void o.field5;
  void o.field10;
  return performance.now() - t0;
}

async function measurePair(fnWasm: () => Promise<number>, fnWeb: () => Promise<number>, iters = 5): Promise<{ wasm: number; web: number }> {
  const wasm: number[] = [];
  const web: number[] = [];
  for (let i = 0; i < iters; i++) {
    wasm.push(await fnWasm());
    web.push(await fnWeb());
  }
  return { wasm: median(wasm), web: median(web) };
}

function setPair(rowPrefix: string, values: { wasm: number; web: number }, formatter: (v: number) => string, noteId: string | null, unit = "faster"): void {
  const wasmWins = values.wasm < values.web;
  setMetric(`${rowPrefix}-wasm`, formatter(values.wasm), wasmWins);
  setMetric(`${rowPrefix}-web`, formatter(values.web), !wasmWins);
  if (noteId) {
    const ratio = values.web / values.wasm;
    const label = ratio >= 1 ? `${ratio.toFixed(2)}× ${unit}` : `${(1 / ratio).toFixed(2)}× slower`;
    setText(noteId, `${label}; live`);
  }
}

async function renderLiveRpcMetrics(): Promise<void> {
  const unavailable = (rowPrefix: string, noteId: string | null, err: unknown) => {
    console.warn(`vs-capnweb live row failed: ${rowPrefix}`, err);
    setMetric(`${rowPrefix}-wasm`, "live RPC unavailable", false);
    setMetric(`${rowPrefix}-web`, "live RPC unavailable", false);
    if (noteId) setText(noteId, "live RPC unavailable");
  };
  const runPair = async (
    rowPrefix: string,
    fnWasm: () => Promise<number>,
    fnWeb: () => Promise<number>,
    formatter: (v: number) => string,
    noteId: string | null,
    iters: number,
  ) => {
    try {
      const values = await measurePair(fnWasm, fnWeb, iters);
      setPair(rowPrefix, values, formatter, noteId);
    } catch (err) {
      unavailable(rowPrefix, noteId, err);
    }
  };

  try {
    await burstCapnwasm(20);
    await burstCapnweb(20);
    await tinyCapnwasm();
    await tinyCapnweb();
  } catch (err) {
    console.warn("vs-capnweb warmup failed; rows will report individually", err);
  }

  await runPair("live-burst", () => burstCapnwasm(1000), () => burstCapnweb(1000), (v) => `${v.toFixed(1)} µs`, "live-burst-note", 3);

  const text64 = "x".repeat(64 * 1024);
  await runPair("live-text64", () => textCapnwasm(text64), () => textCapnweb(text64), fmtMs, "live-text64-note", 3);

  const text4 = "x".repeat(4 * 1024);
  await runPair("live-text4", () => textCapnwasm(text4), () => textCapnweb(text4), fmtMs, "live-text4-note", 5);

  await runPair("live-tiny", tinyCapnwasm, tinyCapnweb, fmtMs, "live-tiny-note", 7);
  await runPair("live-cap", capPassCapnwasm, capPassCapnweb, fmtMs, null, 5);
  await runPair("live-sparse", sparseCapnwasm, sparseCapnweb, fmtMs, "live-sparse-note", 5);
}

function renderWireMetrics(m: any): void {
  const blob = m.fixtures.blob;
  setCell("wire-capnp", blob.gzip.capnp);
  setCell("wire-capnweb", blob.gzip.capnweb);
  setCell("wire-json", blob.gzip.json);
  const smallerThanJson = blob.gzip.json / blob.gzip.capnp;
  const smallerThanCapnweb = blob.gzip.capnweb / blob.gzip.capnp;
  setText(
    "wire-note",
    `${smallerThanJson.toFixed(1)}× smaller than JSON, ${smallerThanCapnweb.toFixed(1)}× smaller than capnweb`,
  );
}

function renderBundleMetrics(m: any): void {
  const gz = m.bundles.gzip;
  const br = m.bundles.brotli;
  setCell("bundle-capnweb-gz", gz.capnweb);
  setCell("bundle-capnweb-br", br.capnweb);
  setCell("bundle-browser-gz", gz.capnwasmBrowser);
  setCell("bundle-browser-br", br.capnwasmBrowser);
  setCell("bundle-rpc-gz", gz.capnwasmRpc);
  setCell("bundle-rpc-br", br.capnwasmRpc);
  setCell("bundle-typical-gz", gz.capnwasmTypical);
  setCell("bundle-typical-br", br.capnwasmTypical);

  const ratioGz = gz.capnwasmTypical / gz.capnweb;
  const ratioBr = br.capnwasmTypical / br.capnweb;
  const deltaBr = br.capnwasmTypical - br.capnweb;
  setText(
    "bundle-note",
    `Build-time metrics from current assets: typical capnwasm browser app is ${ratioGz.toFixed(2)}× capnweb by gzip and ${ratioBr.toFixed(2)}× by brotli (${fmtBytes(deltaBr)} extra brotli). The extra bytes are the wasm runtime + builder/RPC path.`,
  );
}

(async () => {
  try {
    const m = await loadBuildMetrics();
    renderWireMetrics(m);
    renderBundleMetrics(m);
  } catch (err) {
    console.warn("vs-capnweb build metrics failed", err);
    for (const id of [
      "wire-capnp", "wire-capnweb", "wire-json", "wire-note",
      "bundle-capnweb-gz", "bundle-capnweb-br",
      "bundle-browser-gz", "bundle-browser-br",
      "bundle-rpc-gz", "bundle-rpc-br",
      "bundle-typical-gz", "bundle-typical-br", "bundle-note",
    ]) {
      try { setText(id, "build metrics unavailable"); } catch {}
    }
  }
})();

void renderLiveRpcMetrics();
