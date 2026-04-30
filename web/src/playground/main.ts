// Live in-browser bench. Fetches N user records from static fixtures
// in two formats — JSON (REST baseline) and Cap'n Proto bytes — decodes,
// renders to DOM, measures each phase.
//
// Both paths see the same N records and produce identical DOM output, so
// the only thing the numbers measure is wire size + decoder + render.

// @ts-ignore — generated module, no .d.ts wired into tsconfig yet.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder for the demo schema.
import { openUser } from "./users.gen.mjs";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
const summary = $("summary");
const runBtn = $("run-btn") as HTMLButtonElement;
const countSel = $("count-selector") as HTMLSelectElement;
const itersSel = $("iters-selector") as HTMLSelectElement;

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

async function fetchJson(count: number): Promise<{ phase: Phase; users: any[] }> {
  const t0 = performance.now();
  // Parallel fetch — like a real list view kicking off N requests at once.
  const promises: Promise<Response>[] = [];
  for (let i = 1; i <= count; i++) {
    promises.push(fetch(`/data/user-${i}.json`));
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

async function fetchCapnp(count: number): Promise<{ phase: Phase; rendered: number }> {
  await ensureWasm();
  const t0 = performance.now();
  const promises: Promise<Response>[] = [];
  for (let i = 1; i <= count; i++) {
    promises.push(fetch(`/data/user-${i}.capnp`));
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
  return `${(b / 1024).toFixed(1)} KB`;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function runBench() {
  runBtn.disabled = true;
  summary.className = "";
  summary.textContent = "";
  status.textContent = "Warming up…";
  const count = parseInt(countSel.value, 10);
  const iters = parseInt(itersSel.value, 10);

  // One warmup round so neither side pays HTTP-cache or wasm-init cost
  // in the measured iterations.
  await fetchJson(count);
  await fetchCapnp(count);

  const restRuns: Phase[] = [];
  const capnpRuns: Phase[] = [];
  for (let i = 0; i < iters; i++) {
    status.textContent = `Iteration ${i + 1}/${iters} — REST…`;
    restRuns.push((await fetchJson(count)).phase);
    status.textContent = `Iteration ${i + 1}/${iters} — capnwasm…`;
    capnpRuns.push((await fetchCapnp(count)).phase);
  }

  const rest: Phase = {
    fetchMs:  median(restRuns.map((r) => r.fetchMs)),
    decodeMs: median(restRuns.map((r) => r.decodeMs)),
    renderMs: median(restRuns.map((r) => r.renderMs)),
    bytes:    restRuns[0].bytes,
  };
  const capnp: Phase = {
    fetchMs:  median(capnpRuns.map((r) => r.fetchMs)),
    decodeMs: median(capnpRuns.map((r) => r.decodeMs)),
    renderMs: median(capnpRuns.map((r) => r.renderMs)),
    bytes:    capnpRuns[0].bytes,
  };
  const restTotal  = rest.fetchMs  + rest.decodeMs  + rest.renderMs;
  const capnpTotal = capnp.fetchMs + capnp.decodeMs + capnp.renderMs;

  // Render metrics tables. Highlight the winner per row.
  const setCell = (id: string, ms: number, isWin: boolean | null) => {
    const td = $(id);
    td.textContent = fmtMs(ms);
    td.className = isWin === true ? "win" : isWin === false ? "lose" : "";
  };

  // Phase-by-phase: lower wins for fetch/decode/render/total.
  // Bytes: lower also wins.
  const restWinsFetch   = rest.fetchMs   < capnp.fetchMs;
  const restWinsDecode  = rest.decodeMs  < capnp.decodeMs;
  const restWinsRender  = rest.renderMs  < capnp.renderMs;
  const restWinsTotal   = restTotal      < capnpTotal;
  const restWinsBytes   = rest.bytes     < capnp.bytes;

  setCell("rest-fetch",  rest.fetchMs,  restWinsFetch);
  setCell("rest-decode", rest.decodeMs, restWinsDecode);
  setCell("rest-render", rest.renderMs, restWinsRender);
  setCell("rest-total",  restTotal,     restWinsTotal);
  $("rest-bytes").textContent = fmtBytes(rest.bytes);
  $("rest-bytes").className = restWinsBytes ? "win" : "lose";

  setCell("capnp-fetch",  capnp.fetchMs,  !restWinsFetch);
  setCell("capnp-decode", capnp.decodeMs, !restWinsDecode);
  setCell("capnp-render", capnp.renderMs, !restWinsRender);
  setCell("capnp-total",  capnpTotal,     !restWinsTotal);
  $("capnp-bytes").textContent = fmtBytes(capnp.bytes);
  $("capnp-bytes").className = !restWinsBytes ? "win" : "lose";

  const ratio = restTotal / capnpTotal;
  if (capnpTotal < restTotal) {
    summary.className = "win";
    summary.innerHTML = `capnwasm <strong>${ratio.toFixed(2)}× faster</strong> end-to-end (${fmtMs(restTotal)} → ${fmtMs(capnpTotal)}). Wire bytes: ${fmtBytes(rest.bytes)} → ${fmtBytes(capnp.bytes)}.`;
  } else {
    summary.className = "lose";
    summary.innerHTML = `capnwasm <strong>${(1 / ratio).toFixed(2)}× slower</strong> end-to-end (${fmtMs(capnpTotal)} vs ${fmtMs(restTotal)}). For many tiny records, V8&apos;s native JSON.parse beats the wasm boundary cost. capnwasm wins on bigger payloads, binary data, or RPC bursts &mdash; not "fetch lots of tiny records".`;
  }

  status.textContent = `done — ${count} records × ${iters} iter (median)`;
  runBtn.disabled = false;
}

runBtn.addEventListener("click", runBench);
// Auto-run on load so visitors see numbers without clicking.
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(runBench, 100);
});
