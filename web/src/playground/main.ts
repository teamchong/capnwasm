// Live in-browser bench. Fetches N user records from static fixtures
// in two formats — JSON (REST baseline) and Cap'n Proto bytes — decodes,
// renders to DOM, measures each phase.
//
// Both paths see the same N records and produce identical DOM output, so
// the only thing the numbers measure is wire size + decoder + render.

// @ts-ignore — generated module, no .d.ts wired into tsconfig yet.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder for the demo schema.
import { openUser } from "./users.capnp.gen.mjs";
import { deserialize as cwbDeserialize } from "capnweb";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
const summary = $("summary");
const runBtn = $("run-btn") as HTMLButtonElement;
const workloadSel = $("workload-selector") as HTMLSelectElement;
const countSel = $("count-selector") as HTMLSelectElement;
const itersSel = $("iters-selector") as HTMLSelectElement;

// Cap the per-workload record count so users can't ask for 200 records
// from the "blob" workload (only 50 fixtures are emitted).
const WORKLOAD_MAX = { small: 200, blob: 50 } as const;
function clampCount() {
  const max = WORKLOAD_MAX[workloadSel.value as keyof typeof WORKLOAD_MAX];
  for (const opt of Array.from(countSel.options)) {
    opt.disabled = parseInt(opt.value, 10) > max;
  }
  if (parseInt(countSel.value, 10) > max) {
    countSel.value = String(max);
  }
}

// Apply ?workload=&count=&iters= from the URL so visitors can deep-link
// a specific bench config. Writes are also reflected in the URL via
// replaceState — sharing the page after tweaking the selectors gives
// the recipient your exact configuration.
function setSelectIfValid(sel: HTMLSelectElement, value: string | null) {
  if (!value) return;
  const ok = Array.from(sel.options).some((opt) => opt.value === value);
  if (ok) sel.value = value;
}
function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  setSelectIfValid(workloadSel, p.get("workload"));
  // workload changes constrain the count options — clamp before the
  // count read so a stale "?count=200" from a small-workload share
  // doesn't get rejected when arriving on a blob-default page load.
  clampCount();
  setSelectIfValid(countSel, p.get("count"));
  setSelectIfValid(itersSel, p.get("iters"));
}
function syncUrlParams() {
  const p = new URLSearchParams();
  p.set("workload", workloadSel.value);
  p.set("count",    countSel.value);
  p.set("iters",    itersSel.value);
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}
workloadSel.addEventListener("change", () => { clampCount(); syncUrlParams(); });
countSel.addEventListener("change",   syncUrlParams);
itersSel.addEventListener("change",   syncUrlParams);
applyUrlParams();

type Phase = { fetchMs: number; decodeMs: number; renderMs: number; bytes: number };

let cpp: any = null;

async function ensureWasm() {
  if (cpp) return cpp;
  status.textContent = "Loading capnwasm runtime…";
  // The wasm lives in web/public/capnp.slim.wasm — Vite serves files
  // from public/ at the site root, so /capnp.slim.wasm is the right URL.
  cpp = await load(new URL("/capnp.slim.wasm", location.origin));
  return cpp;
}

async function fetchJson(workload: string, count: number): Promise<{ phase: Phase; users: any[] }> {
  const t0 = performance.now();
  // Parallel fetch — like a real list view kicking off N requests at once.
  const promises: Promise<Response>[] = [];
  for (let i = 1; i <= count; i++) {
    promises.push(fetch(`/data/${workload}/user-${i}.json`));
  }
  const responses = await Promise.all(promises);
  const texts = await Promise.all(responses.map((r) => r.text()));
  const tFetch = performance.now();

  let bytes = 0;
  const users = new Array(count);
  for (let i = 0; i < count; i++) {
    bytes += texts[i].length;
    users[i] = JSON.parse(texts[i]);
  }
  const tDecode = performance.now();

  const list = $("rest-list");
  list.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const u of users) {
    const li = document.createElement("li");
    li.textContent = `${u.id}  ${u.name}  ${u.email}  ${u.active ? "✓" : "·"}`;
    frag.appendChild(li);
  }
  list.appendChild(frag);
  // Force layout so we measure the actual paint+layout work, not just
  // the DOM manipulation time.
  void list.offsetHeight;
  const tRender = performance.now();

  return {
    phase: {
      fetchMs: tFetch - t0,
      decodeMs: tDecode - tFetch,
      renderMs: tRender - tDecode,
      bytes,
    },
    users,
  };
}

async function fetchCwb(workload: string, count: number): Promise<{ phase: Phase }> {
  const t0 = performance.now();
  const promises: Promise<Response>[] = [];
  for (let i = 1; i <= count; i++) {
    promises.push(fetch(`/data/${workload}/user-${i}.cwb`));
  }
  const responses = await Promise.all(promises);
  const texts = await Promise.all(responses.map((r) => r.text()));
  const tFetch = performance.now();

  let bytes = 0;
  const users = new Array(count);
  for (let i = 0; i < count; i++) {
    bytes += texts[i].length;
    users[i] = cwbDeserialize(texts[i]) as any;
  }
  const tDecode = performance.now();

  const list = $("cwb-list");
  list.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const u of users) {
    const li = document.createElement("li");
    li.textContent = `${u.id}  ${u.name}  ${u.email}  ${u.active ? "✓" : "·"}`;
    frag.appendChild(li);
  }
  list.appendChild(frag);
  void list.offsetHeight;
  const tRender = performance.now();

  return {
    phase: {
      fetchMs: tFetch - t0,
      decodeMs: tDecode - tFetch,
      renderMs: tRender - tDecode,
      bytes,
    },
  };
}

async function fetchCapnp(workload: string, count: number): Promise<{ phase: Phase; rendered: number }> {
  await ensureWasm();
  const t0 = performance.now();
  const promises: Promise<Response>[] = [];
  for (let i = 1; i <= count; i++) {
    promises.push(fetch(`/data/${workload}/user-${i}.capnp`));
  }
  const responses = await Promise.all(promises);
  const buffers = await Promise.all(responses.map((r) => r.arrayBuffer()));
  const tFetch = performance.now();

  let bytes = 0;
  const decoded: { id: bigint; name: string; email: string; active: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const u8 = new Uint8Array(buffers[i]);
    bytes += u8.length;
    const r = openUser(cpp, u8);
    decoded.push({
      id: r.id,
      name: r.name,
      email: r.email,
      active: r.active,
    });
  }
  const tDecode = performance.now();

  const list = $("capnp-list");
  list.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const u of decoded) {
    const li = document.createElement("li");
    li.textContent = `${u.id}  ${u.name}  ${u.email}  ${u.active ? "✓" : "·"}`;
    frag.appendChild(li);
  }
  list.appendChild(frag);
  void list.offsetHeight;
  const tRender = performance.now();

  return {
    phase: {
      fetchMs: tFetch - t0,
      decodeMs: tDecode - tFetch,
      renderMs: tRender - tDecode,
      bytes,
    },
    rendered: decoded.length,
  };
}

function fmtMs(ms: number) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(2)} ms`;
}
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
// "Egress at 1k req/s for 1 hour" — extrapolates per-request wire bytes
// to a Worker-shaped sustained-traffic load, the case where bytes-on-wire
// translates straight into an egress bill. 1000 req/s × 3600 s = 3.6 M
// requests/hour, so this is "GB transferred per hour at that load."
const REQ_PER_SEC = 1000;
const SECONDS = 3600;
function fmtEgress(bytesPerRequest: number, recordsPerRequest: number) {
  // bytesPerRequest is the TOTAL across all records in this fixture run;
  // we need the per-record bytes × records-per-fetch on the real path.
  // For the playground, "1 fetch = 1 record" — so per-request is
  // bytesPerRequest / recordsPerRequest.
  const perReq = bytesPerRequest / recordsPerRequest;
  const total = perReq * REQ_PER_SEC * SECONDS;
  return fmtBytes(total) + "/h";
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function runBench() {
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  summary.className = "";
  summary.textContent = "";
  status.textContent = "Warming up…";
  const workload = workloadSel.value;
  const count = parseInt(countSel.value, 10);
  const iters = parseInt(itersSel.value, 10);

  // Replace stale "—" cells (or numbers from a previous run) with a
  // visible "running…" so the page doesn't sit looking broken while
  // the warmup pass takes a few hundred ms on slow machines.
  const PHASES = ["fetch", "decode", "render", "total", "bytes", "egress"];
  const PROTO  = ["rest", "cwb", "capnp"];
  for (const p of PROTO) {
    for (const ph of PHASES) {
      const el = document.getElementById(`${p}-${ph}`);
      if (el) {
        el.textContent = "running…";
        el.className = "running";
      }
    }
  }

  // One warmup round so neither side pays HTTP-cache or wasm-init cost
  // in the measured iterations.
  await fetchJson(workload, count);
  await fetchCwb(workload, count);
  await fetchCapnp(workload, count);

  const restRuns: Phase[] = [];
  const cwbRuns: Phase[] = [];
  const capnpRuns: Phase[] = [];
  for (let i = 0; i < iters; i++) {
    status.textContent = `Iteration ${i + 1}/${iters} — REST…`;
    restRuns.push((await fetchJson(workload, count)).phase);
    status.textContent = `Iteration ${i + 1}/${iters} — capnweb…`;
    cwbRuns.push((await fetchCwb(workload, count)).phase);
    status.textContent = `Iteration ${i + 1}/${iters} — capnwasm…`;
    capnpRuns.push((await fetchCapnp(workload, count)).phase);
  }

  const rest: Phase = {
    fetchMs:  median(restRuns.map((r) => r.fetchMs)),
    decodeMs: median(restRuns.map((r) => r.decodeMs)),
    renderMs: median(restRuns.map((r) => r.renderMs)),
    bytes:    restRuns[0].bytes,
  };
  const cwb: Phase = {
    fetchMs:  median(cwbRuns.map((r) => r.fetchMs)),
    decodeMs: median(cwbRuns.map((r) => r.decodeMs)),
    renderMs: median(cwbRuns.map((r) => r.renderMs)),
    bytes:    cwbRuns[0].bytes,
  };
  const capnp: Phase = {
    fetchMs:  median(capnpRuns.map((r) => r.fetchMs)),
    decodeMs: median(capnpRuns.map((r) => r.decodeMs)),
    renderMs: median(capnpRuns.map((r) => r.renderMs)),
    bytes:    capnpRuns[0].bytes,
  };
  const totals = {
    rest:  rest.fetchMs  + rest.decodeMs  + rest.renderMs,
    cwb:   cwb.fetchMs   + cwb.decodeMs   + cwb.renderMs,
    capnp: capnp.fetchMs + capnp.decodeMs + capnp.renderMs,
  };

  // Find the per-row minimum (lower-is-better) so the winner gets the
  // green "win" styling and the others get neutral.
  const minOf = (a: number, b: number, c: number) => Math.min(a, Math.min(b, c));
  const fillCol = (prefix: string, p: Phase, total: number, isMinFetch: boolean, isMinDecode: boolean, isMinRender: boolean, isMinTotal: boolean, isMinBytes: boolean) => {
    const setCell = (id: string, ms: number, win: boolean) => {
      const td = $(id);
      td.textContent = fmtMs(ms);
      td.className = win ? "win" : "";
    };
    setCell(`${prefix}-fetch`,  p.fetchMs,  isMinFetch);
    setCell(`${prefix}-decode`, p.decodeMs, isMinDecode);
    setCell(`${prefix}-render`, p.renderMs, isMinRender);
    setCell(`${prefix}-total`,  total,      isMinTotal);
    const bytes = $(`${prefix}-bytes`);
    bytes.textContent = fmtBytes(p.bytes);
    bytes.className = isMinBytes ? "win" : "";
    const egress = $(`${prefix}-egress`);
    egress.textContent = fmtEgress(p.bytes, count);
    egress.className = isMinBytes ? "win" : "";
  };

  const minFetch  = minOf(rest.fetchMs,  cwb.fetchMs,  capnp.fetchMs);
  const minDecode = minOf(rest.decodeMs, cwb.decodeMs, capnp.decodeMs);
  const minRender = minOf(rest.renderMs, cwb.renderMs, capnp.renderMs);
  const minTotal  = minOf(totals.rest,   totals.cwb,   totals.capnp);
  const minBytes  = minOf(rest.bytes,    cwb.bytes,    capnp.bytes);

  fillCol("rest",  rest,  totals.rest,  rest.fetchMs===minFetch,  rest.decodeMs===minDecode,  rest.renderMs===minRender,  totals.rest===minTotal,  rest.bytes===minBytes);
  fillCol("cwb",   cwb,   totals.cwb,   cwb.fetchMs===minFetch,   cwb.decodeMs===minDecode,   cwb.renderMs===minRender,   totals.cwb===minTotal,   cwb.bytes===minBytes);
  fillCol("capnp", capnp, totals.capnp, capnp.fetchMs===minFetch, capnp.decodeMs===minDecode, capnp.renderMs===minRender, totals.capnp===minTotal, capnp.bytes===minBytes);

  // Summary picks the winner and explains the finish order.
  const sorted = [
    { name: "REST/JSON", t: totals.rest,  b: rest.bytes  },
    { name: "capnweb",   t: totals.cwb,   b: cwb.bytes   },
    { name: "capnwasm",  t: totals.capnp, b: capnp.bytes },
  ].sort((a, b) => a.t - b.t);
  const winner = sorted[0];
  const honestLink = `<a href="./honest.html" style="color:inherit;text-decoration:underline">honest comparison page</a>`;

  // Bandwidth savings extrapolated to a sustained 1k req/s workload —
  // 1000 req/s × 3600 s = 3.6 M requests/hour, so this is "GB transferred
  // per hour at that load." Translating to dollars depends on the cloud:
  // Cloudflare R2 + Workers egress to clients is **zero-rated** (no
  // savings on the bill there). AWS S3 charges $0.09/GB; GCP $0.12/GB.
  // We show both — Cloudflare for "free, but UX win" and AWS for the
  // real-money case.
  const perReqRest  = rest.bytes  / count;
  const perReqCapnp = capnp.bytes / count;
  const perHourRest  = perReqRest  * REQ_PER_SEC * SECONDS;
  const perHourCapnp = perReqCapnp * REQ_PER_SEC * SECONDS;
  const savedPerHour = perHourRest - perHourCapnp;
  const awsGbPrice = 0.09;
  const savedDollarsPerMonthAws = (savedPerHour / 1e9) * awsGbPrice * 24 * 30;
  const bandwidthLine = savedPerHour > 0
    ? `At <strong>1k req/s sustained</strong> that's <strong>${fmtBytes(savedPerHour)}/hour</strong> less wire vs REST. On Cloudflare (zero-rated egress) the win is UX and Worker CPU, not the bill; on AWS S3 ($0.09/GB) it's ~$${savedDollarsPerMonthAws.toFixed(2)}/month.`
    : "";

  if (winner.name === "capnwasm") {
    summary.className = "win";
    summary.innerHTML = `<strong>capnwasm wins</strong>: ${fmtMs(totals.capnp)} vs REST ${fmtMs(totals.rest)} (${(totals.rest / totals.capnp).toFixed(2)}×) and capnweb ${fmtMs(totals.cwb)} (${(totals.cwb / totals.capnp).toFixed(2)}×). Wire ${fmtBytes(rest.bytes)} JSON / ${fmtBytes(cwb.bytes)} capnweb / ${fmtBytes(capnp.bytes)} capnp.<br>${bandwidthLine}`;
  } else {
    summary.className = "lose";
    summary.innerHTML = `<strong>${winner.name} wins this workload</strong>: ${fmtMs(winner.t)}. capnwasm came in at ${fmtMs(totals.capnp)} (${(totals.capnp / winner.t).toFixed(2)}× ${winner.name}&apos;s). On localhost the wasm load + per-record boundary cost can outweigh the bytes savings; capnwasm&apos;s wins (RPC bursts, sparse reads, binary wire interop) need a different workload &mdash; see ${honestLink}.<br>${bandwidthLine}`;
  }

  status.textContent = `done — ${workload} workload, ${count} records × ${iters} iter (median)`;
  runBtn.disabled = false;
  runBtn.textContent = "Run benchmark";
}

// Single-flight: ignore re-entrant clicks while a run is in progress so
// the test rig (and the user) can never start a new bench on top of a
// pending one. Auto-run goes through the same gate.
let inFlight = false;
async function runBenchSafe() {
  if (inFlight) return;
  inFlight = true;
  try {
    await runBench();
  } finally {
    inFlight = false;
  }
}
runBtn.addEventListener("click", runBenchSafe);
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(runBenchSafe, 100);
});
