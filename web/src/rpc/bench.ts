// Shared RPC bench runner. Used by /rpc and /playground (which combines
// fetch + RPC into one auto-run flow).

// @ts-ignore — generated module without a .d.ts wired in.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder.
import { PrimitivesBuilder, PrimitivesReader } from "../../../js/conformance_schema.gen.mjs";
// @ts-ignore — internal RPC layer; types not bundled.
import { connectWebSocket } from "../../../js/rpc.mjs";
import { newWebSocketRpcSession } from "capnweb";

const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8 = 0;
const M_ECHO_BINARY = 2;
const M_GET_CHILD = 3;

export interface RpcBenchControls {
  status: HTMLElement;
  summary: HTMLElement;
  iters: HTMLSelectElement;
  // Cell IDs used by the surrounding HTML. Defaults match /rpc.
  ids?: {
    burstCapnp?: string;
    burstCwb?: string;
    burstCapnpX?: string;
    burstCwbX?: string;
    pipeCapnp?: string;
    pipeCwb?: string;
    pipeCapnpX?: string;
    pipeCwbX?: string;
    blobCapnp?: string;
    blobCwb?: string;
    blobCapnpBytes?: string;
    blobCwbBytes?: string;
  };
}

const DEFAULT_IDS: Required<NonNullable<RpcBenchControls["ids"]>> = {
  burstCapnp: "burst-capnp",
  burstCwb: "burst-cwb",
  burstCapnpX: "burst-capnp-x",
  burstCwbX: "burst-cwb-x",
  pipeCapnp: "pipe-capnp",
  pipeCwb: "pipe-cwb",
  pipeCapnpX: "pipe-capnp-x",
  pipeCwbX: "pipe-cwb-x",
  blobCapnp: "blob-capnp",
  blobCwb: "blob-cwb",
  blobCapnpBytes: "blob-capnp-bytes",
  blobCwbBytes: "blob-cwb-bytes",
};

const SERVER = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

let cppRoot: any = null;
let cppBurstRoot: any = null;
let cwbRoot: any = null;

async function ensureCapnwasm(opts: { batchWindow?: boolean } = {}) {
  if (opts.batchWindow) {
    if (cppBurstRoot) return cppBurstRoot;
    const cpp = await load(new URL("/capnp.slim.wasm", location.origin));
    const session = await connectWebSocket(cpp, SERVER + "/capnwasm", { batchWindowMs: 2 });
    cppBurstRoot = session.bootstrap();
    return cppBurstRoot;
  }
  if (cppRoot) return cppRoot;
  const cpp = await load(new URL("/capnp.slim.wasm", location.origin));
  const session = await connectWebSocket(cpp, SERVER + "/capnwasm");
  cppRoot = session.bootstrap();
  return cppRoot;
}

async function ensureCapnweb() {
  if (cwbRoot) return cwbRoot;
  cwbRoot = newWebSocketRpcSession(SERVER + "/capnweb");
  return cwbRoot;
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

async function burstCapnwasm(n: number): Promise<number> {
  const root = await ensureCapnwasm({ batchWindow: true });
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
  const root = await ensureCapnweb();
  const t0 = performance.now();
  const promises = new Array(n);
  for (let i = 0; i < n; i++) promises[i] = root.echoU8({ u8: i & 0xff });
  await Promise.all(promises);
  return ((performance.now() - t0) * 1000) / n;
}

async function pipeCapnwasm(): Promise<number> {
  const root = await ensureCapnwasm();
  const t0 = performance.now();
  const r1 = root.callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();
  const r2 = r1.cap.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
  r2.params.u8 = 9;
  await r2.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.u8 }).promise;
  return performance.now() - t0;
}

async function pipeCapnweb(): Promise<number> {
  const root = await ensureCapnweb();
  const t0 = performance.now();
  const child = root.getChild();
  await child.echoU8({ u8: 9 });
  return performance.now() - t0;
}

async function blobCapnwasm(bytes: Uint8Array): Promise<{ ms: number; wire: number }> {
  const root = await ensureCapnwasm();
  const t0 = performance.now();
  const r = root.callBuilder(IFC, M_ECHO_BINARY, PrimitivesBuilder);
  r.params.data = bytes;
  await r.send({ resultsReader: PrimitivesReader, extract: (rdr: any) => rdr.data }).promise;
  return { ms: performance.now() - t0, wire: bytes.length * 2 + 64 };
}

async function blobCapnweb(bytes: Uint8Array): Promise<{ ms: number; wire: number }> {
  const root = await ensureCapnweb();
  const t0 = performance.now();
  await root.echoBinary(bytes);
  return { ms: performance.now() - t0, wire: Math.ceil(bytes.length * 4 / 3) * 2 + 96 };
}

export async function probeRpcServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runRpcBench(controls: RpcBenchControls): Promise<void> {
  const { status, summary, iters: itersSel } = controls;
  const ids = { ...DEFAULT_IDS, ...(controls.ids ?? {}) };
  const $ = (id: string) => document.getElementById(id);
  const iters = parseInt(itersSel.value, 10) || 3;
  summary.className = "";
  summary.textContent = "";

  for (const id of Object.values(ids)) {
    const el = $(id);
    if (el) {
      el.textContent = "running…";
      el.className = "running";
    }
  }

  status.textContent = "Connecting RPC sessions…";
  await ensureCapnwasm();
  await ensureCapnweb();

  status.textContent = "Warming RPC up…";
  await burstCapnwasm(20); await burstCapnweb(20);
  await pipeCapnwasm();   await pipeCapnweb();

  const burstCapnp: number[] = [];
  const burstCwb: number[] = [];
  for (let i = 0; i < iters; i++) {
    status.textContent = `RPC burst — iter ${i + 1}/${iters}`;
    burstCapnp.push(await burstCapnwasm(200));
    burstCwb.push(await burstCapnweb(200));
  }

  const pipeCapnp: number[] = [];
  const pipeCwb: number[] = [];
  for (let i = 0; i < iters; i++) {
    status.textContent = `RPC pipelining — iter ${i + 1}/${iters}`;
    pipeCapnp.push(await pipeCapnwasm());
    pipeCwb.push(await pipeCapnweb());
  }

  const blob = new Uint8Array(64 * 1024);
  for (let i = 0; i < blob.length; i++) blob[i] = i & 0xff;
  const blobCapnp: number[] = [];
  const blobCwb: number[] = [];
  let wireCapnp = 0;
  let wireCwb = 0;
  for (let i = 0; i < iters; i++) {
    status.textContent = `RPC 64 KB blob — iter ${i + 1}/${iters}`;
    const a = await blobCapnwasm(blob); blobCapnp.push(a.ms); wireCapnp = a.wire;
    const b = await blobCapnweb(blob); blobCwb.push(b.ms); wireCwb = b.wire;
  }

  const setRow = (id: string, value: string, win: boolean) => {
    const td = $(id);
    if (!td) return;
    td.textContent = value;
    td.className = "big" + (win ? " win" : "");
  };
  const setRelative = (id: string, ratio: number) => {
    const td = $(id);
    if (!td) return;
    td.textContent = ratio === 1
      ? "same as capnweb"
      : ratio < 1
        ? `${(1 / ratio).toFixed(2)}× faster than capnweb`
        : `${ratio.toFixed(2)}× slower than capnweb`;
    td.className = "ratio";
  };
  const setBaseline = (id: string) => {
    const td = $(id);
    if (!td) return;
    td.textContent = "capnweb baseline";
    td.className = "ratio";
  };

  const burstM = { capnp: median(burstCapnp), cwb: median(burstCwb) };
  setRow(ids.burstCapnp, `${burstM.capnp.toFixed(2)} µs/call`, burstM.capnp < burstM.cwb);
  setRow(ids.burstCwb, `${burstM.cwb.toFixed(2)} µs/call`, burstM.cwb < burstM.capnp);
  setRelative(ids.burstCapnpX, burstM.capnp / burstM.cwb);
  setBaseline(ids.burstCwbX);

  const pipeM = { capnp: median(pipeCapnp), cwb: median(pipeCwb) };
  setRow(ids.pipeCapnp, fmtMs(pipeM.capnp), pipeM.capnp < pipeM.cwb);
  setRow(ids.pipeCwb, fmtMs(pipeM.cwb), pipeM.cwb < pipeM.capnp);
  setRelative(ids.pipeCapnpX, pipeM.capnp / pipeM.cwb);
  setBaseline(ids.pipeCwbX);

  const blobM = { capnp: median(blobCapnp), cwb: median(blobCwb) };
  setRow(ids.blobCapnp, fmtMs(blobM.capnp), blobM.capnp < blobM.cwb);
  setRow(ids.blobCwb, fmtMs(blobM.cwb), blobM.cwb < blobM.capnp);
  const blobCapnpBytes = $(ids.blobCapnpBytes);
  const blobCwbBytes = $(ids.blobCwbBytes);
  if (blobCapnpBytes) {
    blobCapnpBytes.textContent = `~${fmtBytes(wireCapnp)} on wire`;
    blobCapnpBytes.className = wireCapnp < wireCwb ? "win" : "";
  }
  if (blobCwbBytes) {
    blobCwbBytes.textContent = `~${fmtBytes(wireCwb)} on wire`;
    blobCwbBytes.className = wireCwb < wireCapnp ? "win" : "";
  }

  const wins =
    (burstM.capnp < burstM.cwb ? 1 : 0) +
    (pipeM.capnp < pipeM.cwb ? 1 : 0) +
    (blobM.capnp < blobM.cwb ? 1 : 0);

  if (wins >= 2) {
    summary.className = "win";
    summary.innerHTML = `<strong>capnwasm wins ${wins} of 3 RPC workloads</strong> on this run.
      Burst ${burstM.capnp < burstM.cwb ? "faster" : "slower"} than capnweb,
      pipelining ${pipeM.capnp < pipeM.cwb ? "faster" : "slower"},
      64 KB blob ${blobM.capnp < blobM.cwb ? "faster" : "slower"}.
      Blob wire bytes: ~${fmtBytes(wireCapnp)} capnwasm vs ~${fmtBytes(wireCwb)} capnweb.`;
  } else {
    summary.className = "lose";
    summary.innerHTML = `capnweb wins ${3 - wins} of 3 RPC workloads on this run.
      Numbers fluctuate with same-origin RTT; rerun to see stability.`;
  }
  status.textContent = `RPC done — ${iters} iter (median).`;
}
