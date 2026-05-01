// Render bench: 4 transports × 5 workloads × 3 sizes × cold/warm.
//
// Measures end-to-end timing per cell: from `cap.method()` invocation
// through wire, decode, every field read used by the render path, the
// DOM mutation, and forced layout via `offsetHeight`. The same server
// (web/vite-rpc-server.mjs) backs every transport so the only independent
// variables are the library and the wire shape.
//
// Cells are reported as median of `iters` warm runs. Cold = first call
// after the transport opens — includes WS handshake / first POST + (for
// capnwasm) the wasm fetch + compile if not cached.

// @ts-ignore — runtime imports from the parent capnwasm package.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated reader/builder for the bench schema.
import {
  CountParamsBuilder,
  UserListReader,
  BlobReplyReader,
  openUserList,
} from "../playground/users.capnp.gen.mjs";
// @ts-ignore — generated wide-metadata reader (32 fields).
import {
  WideUserDataReader,
  openWideUserData,
} from "../../../js/typed_schema.gen.mjs";
// @ts-ignore — internal RPC layer.
import { connectWebSocket } from "../../../js/rpc.mjs";
// @ts-ignore — HTTP-batch transport.
import { connectHttpBatch } from "../../../js/http_batch.mjs";
// capnweb's two transports.
import { newWebSocketRpcSession, newHttpBatchRpcSession } from "capnweb";

const $ = (id: string) => document.getElementById(id)!;
const status = $("status");
const summary = $("summary");
const runBtn = $("run-btn") as HTMLButtonElement;
const itersSel = $("iters-selector") as HTMLSelectElement;
const serverDot = $("server-dot");
const serverMsg = $("server-msg");

const sinkList  = $("render-sink-list")   as HTMLUListElement;
const sinkFields= $("render-sink-fields") as HTMLDivElement;
const sinkBlob  = $("render-sink-blob")   as HTMLDivElement;

// ---- Server endpoints --------------------------------------------------
const ORIGIN = location.origin;
const WS_ORIGIN = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
const URL_CAPNWASM_WS    = WS_ORIGIN + "/capnwasm";
const URL_CAPNWEB_WS     = WS_ORIGIN + "/capnweb";
const URL_CAPNWASM_HTTP  = ORIGIN    + "/capnwasm-http";
const URL_CAPNWEB_HTTP   = ORIGIN    + "/capnweb-http";

const RENDER_IFC          = 0xb1a5c0deb1a5c0den;
const RENDER_M_USER_LIST  = 0;
const RENDER_M_METADATA   = 1;
const RENDER_M_BLOB       = 2;

// ---- Format helpers ----------------------------------------------------
function fmtMs(ms: number): string {
  if (!isFinite(ms)) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 100) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(1)} ms`;
}
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type Lib = "capnweb" | "capnwasm";
type Wire = "ws" | "http";
type TransportKey = `${Lib}-${Wire}`;
const TRANSPORTS: { key: TransportKey; label: string }[] = [
  { key: "capnweb-ws",   label: "capnweb / WS"   },
  { key: "capnweb-http", label: "capnweb / HTTP" },
  { key: "capnwasm-ws",  label: "capnwasm / WS"  },
  { key: "capnwasm-http",label: "capnwasm / HTTP"},
];

type ReadMode = "sparse" | "dense";

// Per-transport bundle exposing the four bench operations.
type Bundle = {
  key: TransportKey;
  callList: (n: number) => Promise<void>;
  callMetadata: (mode: ReadMode) => Promise<void>;
  callBlob: (n: number) => Promise<void>;
  // re-read storm: fetch once, return a function that reads one field per
  // call (cycling through 10 fields). Each read runs independently of any
  // re-fetch so the workload measures the post-fetch read cost.
  fetchMetadataOnce: () => Promise<() => string>;
  close: () => void;
};

let cppRuntime: any = null;
async function ensureCpp() {
  if (cppRuntime) return cppRuntime;
  cppRuntime = await load(new URL("/capnp.slim.wasm", location.origin));
  return cppRuntime;
}

// ---- capnwasm bundle factory (shared between WS + HTTP) ----------------
function capnwasmBundle(key: TransportKey, session: any, root: any, cpp: any): Bundle {
  return {
    key,
    callList: async (n) => {
      const r = root.callBuilder(RENDER_IFC, RENDER_M_USER_LIST, CountParamsBuilder);
      r.params.n = n;
      // extract runs after Return decode but before the promise resolves.
      // We materialize each row to plain JS values inside extract so the
      // wasm crossings count toward the bench timing.
      const rows: { id: bigint; name: string; email: string; active: boolean }[] = await r.send({
        resultsReader: UserListReader,
        extract: (rdr: any) => {
          const list = rdr.users;
          const len = list.length;
          const out: typeof rows = new Array(len);
          for (let i = 0; i < len; i++) {
            const u = list.at(i);
            out[i] = { id: u.id, name: u.name, email: u.email, active: u.active };
          }
          return out;
        },
      }).promise;
      sinkList.replaceChildren();
      const frag = document.createDocumentFragment();
      for (const u of rows) {
        const li = document.createElement("li");
        li.textContent = `${u.id}  ${u.name}  ${u.email}  ${u.active ? "✓" : "·"}`;
        frag.appendChild(li);
      }
      sinkList.appendChild(frag);
      void sinkList.offsetHeight;
    },
    callMetadata: async (mode) => {
      const r = root.callBuilder(RENDER_IFC, RENDER_M_METADATA, CountParamsBuilder);
      r.params.n = 0;  // server ignores
      const out: string[] = await r.send({
        resultsReader: WideUserDataReader,
        extract: (rdr: any) => {
          if (mode === "sparse") {
            // Read 3 of 32 — capnwasm's wire layout means we only cross
            // the wasm boundary 3 times, not 32.
            return [rdr.field0, rdr.field5, rdr.field10];
          }
          // Dense: read all 32. Each access is a wasm crossing.
          const all: string[] = new Array(32);
          for (let i = 0; i < 32; i++) all[i] = (rdr as any)["field" + i];
          return all;
        },
      }).promise;
      sinkFields.replaceChildren();
      for (const s of out) {
        const div = document.createElement("div");
        div.textContent = s;
        sinkFields.appendChild(div);
      }
      void sinkFields.offsetHeight;
    },
    callBlob: async (n) => {
      const r = root.callBuilder(RENDER_IFC, RENDER_M_BLOB, CountParamsBuilder);
      r.params.n = n;
      const len: number = await r.send({
        resultsReader: BlobReplyReader,
        extract: (rdr: any) => rdr.data.length,
      }).promise;
      sinkBlob.textContent = `bytes: ${len}`;
      void sinkBlob.offsetHeight;
    },
    fetchMetadataOnce: async () => {
      // Send WITHOUT extract so the promise resolves with raw {bytes, caps}.
      // Wrap those bytes in a long-lived reader for the bench's read loop.
      const r = root.callBuilder(RENDER_IFC, RENDER_M_METADATA, CountParamsBuilder);
      r.params.n = 0;
      const { bytes }: { bytes: Uint8Array } = await r.send().promise;
      const reader = openWideUserData(cpp, bytes);
      const fields = ["field0","field1","field2","field3","field4",
                      "field5","field6","field7","field8","field9"];
      let cursor = 0;
      return () => {
        const name = fields[cursor];
        cursor = (cursor + 1) % fields.length;
        return reader[name];
      };
    },
    close: () => { try { session.close(); } catch {} },
  };
}

async function makeCapnwasmWs(): Promise<Bundle> {
  const cpp = await ensureCpp();
  const session = await connectWebSocket(cpp, URL_CAPNWASM_WS);
  return capnwasmBundle("capnwasm-ws", session, session.bootstrap(), cpp);
}
async function makeCapnwasmHttp(): Promise<Bundle> {
  const cpp = await ensureCpp();
  const session = connectHttpBatch(cpp, URL_CAPNWASM_HTTP);
  return capnwasmBundle("capnwasm-http", session, session.bootstrap(), cpp);
}

// ---- capnweb bundle factory --------------------------------------------
function capnwebBundle(key: TransportKey, openSession: () => any): Bundle {
  // capnweb HTTP-batch sessions are single-use by spec — recreate every
  // call so each invocation is one POST. WS sessions persist.
  let wsSession: any = null;
  function getSession() {
    if (key === "capnweb-http") return openSession();
    if (!wsSession) wsSession = openSession();
    return wsSession;
  }
  return {
    key,
    callList: async (n) => {
      const arr: { id: number; name: string; email: string; active: boolean }[] =
        await getSession().getUserList(n);
      sinkList.replaceChildren();
      const frag = document.createDocumentFragment();
      for (const u of arr) {
        const li = document.createElement("li");
        li.textContent = `${u.id}  ${u.name}  ${u.email}  ${u.active ? "✓" : "·"}`;
        frag.appendChild(li);
      }
      sinkList.appendChild(frag);
      void sinkList.offsetHeight;
    },
    callMetadata: async (mode) => {
      const o: Record<string, string> = await getSession().getMetadata();
      const out: string[] = mode === "sparse"
        ? [o.field0, o.field5, o.field10]
        : Array.from({ length: 32 }, (_, i) => o["field" + i]);
      sinkFields.replaceChildren();
      for (const s of out) {
        const div = document.createElement("div");
        div.textContent = s;
        sinkFields.appendChild(div);
      }
      void sinkFields.offsetHeight;
    },
    callBlob: async (n) => {
      const bytes: Uint8Array = await getSession().getBlob(n);
      sinkBlob.textContent = `bytes: ${bytes.length}`;
      void sinkBlob.offsetHeight;
    },
    fetchMetadataOnce: async () => {
      const o: Record<string, string> = await getSession().getMetadata();
      const fields = ["field0","field1","field2","field3","field4",
                      "field5","field6","field7","field8","field9"];
      let cursor = 0;
      return () => {
        const name = fields[cursor];
        cursor = (cursor + 1) % fields.length;
        return o[name];
      };
    },
    close: () => { try { wsSession?.close?.(); } catch {} },
  };
}

async function makeCapnwebWs(): Promise<Bundle> {
  return capnwebBundle("capnweb-ws", () => newWebSocketRpcSession(URL_CAPNWEB_WS));
}
async function makeCapnwebHttp(): Promise<Bundle> {
  return capnwebBundle("capnweb-http", () => newHttpBatchRpcSession(URL_CAPNWEB_HTTP));
}

// ---- Bench harness -----------------------------------------------------

type Cell = { coldMs: number; warmMs: number; error?: string };

async function timeOnce(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function runCell(fn: () => Promise<unknown>, iters: number): Promise<Cell> {
  try {
    const cold = await timeOnce(fn);
    for (let i = 0; i < 3; i++) await fn();   // JIT warmup, untimed
    const samples: number[] = [];
    for (let i = 0; i < iters; i++) samples.push(await timeOnce(fn));
    return { coldMs: cold, warmMs: median(samples) };
  } catch (err: any) {
    return { coldMs: NaN, warmMs: NaN, error: String(err?.message ?? err) };
  }
}

type Workload = {
  id: string;
  sizes: { label: string; value: number }[];
  call: (b: Bundle, sizeValue: number) => Promise<unknown>;
};

const WORKLOADS: Workload[] = [
  {
    id: "list",
    sizes: [
      { label: "small (10)",   value: 10   },
      { label: "medium (100)", value: 100  },
      { label: "large (1000)", value: 1000 },
    ],
    call: (b, n) => b.callList(n),
  },
  {
    id: "sparse",
    sizes: [
      { label: "1× call",   value: 1  },
      { label: "10× calls", value: 10 },
      { label: "50× calls", value: 50 },
    ],
    call: async (b, n) => {
      const ps: Promise<unknown>[] = new Array(n);
      for (let i = 0; i < n; i++) ps[i] = b.callMetadata("sparse");
      await Promise.all(ps);
    },
  },
  {
    id: "dense",
    sizes: [
      { label: "1× call",   value: 1  },
      { label: "10× calls", value: 10 },
      { label: "50× calls", value: 50 },
    ],
    call: async (b, n) => {
      const ps: Promise<unknown>[] = new Array(n);
      for (let i = 0; i < n; i++) ps[i] = b.callMetadata("dense");
      await Promise.all(ps);
    },
  },
  {
    id: "reread",
    sizes: [
      { label: "10× reads",   value: 10  },
      { label: "100× reads",  value: 100 },
      { label: "1000× reads", value: 1000 },
    ],
    call: async (b, n) => {
      const read = await b.fetchMetadataOnce();
      let acc = "";
      for (let i = 0; i < n; i++) acc += read();
      sinkFields.textContent = `total chars: ${acc.length}`;
      void sinkFields.offsetHeight;
    },
  },
  {
    id: "blob",
    sizes: [
      { label: "small (4 KB)",   value: 4 * 1024 },
      { label: "medium (64 KB)", value: 64 * 1024 },
      { label: "large (256 KB)", value: 256 * 1024 },
    ],
    call: (b, n) => b.callBlob(n),
  },
];

// ---- Table builders ----------------------------------------------------
function buildTable(workload: Workload): HTMLTableElement {
  const t = document.createElement("table");
  t.className = "bench";
  const cap = document.createElement("caption");
  cap.textContent = `Workload — ${workload.id}: cold / warm per transport × size`;
  t.appendChild(cap);
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.appendChild(document.createElement("th"));
  for (const s of workload.sizes) {
    const th = document.createElement("th");
    th.colSpan = 2;
    th.textContent = s.label;
    th.style.textAlign = "center";
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const sub = document.createElement("tr");
  sub.appendChild(document.createElement("th"));
  for (const _ of workload.sizes) {
    const cold = document.createElement("th");
    cold.textContent = "cold";
    cold.style.textAlign = "right";
    sub.appendChild(cold);
    const warm = document.createElement("th");
    warm.textContent = "warm";
    warm.style.textAlign = "right";
    sub.appendChild(warm);
  }
  thead.appendChild(sub);
  t.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const tr of TRANSPORTS) {
    const row = document.createElement("tr");
    const td0 = document.createElement("td");
    td0.textContent = tr.label;
    row.appendChild(td0);
    for (const s of workload.sizes) {
      const cold = document.createElement("td");
      cold.className = "num running";
      cold.textContent = "—";
      cold.id = `cell-${workload.id}-${tr.key}-${s.value}-cold`;
      row.appendChild(cold);
      const warm = document.createElement("td");
      warm.className = "num running";
      warm.textContent = "—";
      warm.id = `cell-${workload.id}-${tr.key}-${s.value}-warm`;
      row.appendChild(warm);
    }
    tbody.appendChild(row);
  }
  t.appendChild(tbody);
  return t;
}

function fillCell(workloadId: string, key: TransportKey, sizeValue: number, cell: Cell): void {
  const cold = document.getElementById(`cell-${workloadId}-${key}-${sizeValue}-cold`);
  const warm = document.getElementById(`cell-${workloadId}-${key}-${sizeValue}-warm`);
  if (cold) {
    cold.classList.remove("running");
    cold.textContent = cell.error ? "err" : fmtMs(cell.coldMs);
    if (cell.error) cold.classList.add("error");
  }
  if (warm) {
    warm.classList.remove("running");
    warm.textContent = cell.error ? "err" : fmtMs(cell.warmMs);
    if (cell.error) warm.classList.add("error");
  }
}

function paintWinners(workload: Workload, results: Map<TransportKey, Map<number, Cell>>): void {
  for (const s of workload.sizes) {
    const warmCells: { key: TransportKey; v: number }[] = [];
    for (const tr of TRANSPORTS) {
      const c = results.get(tr.key)?.get(s.value);
      if (c && !c.error && isFinite(c.warmMs)) warmCells.push({ key: tr.key, v: c.warmMs });
    }
    if (warmCells.length < 2) continue;
    const min = Math.min(...warmCells.map((c) => c.v));
    for (const c of warmCells) {
      const td = document.getElementById(`cell-${workload.id}-${c.key}-${s.value}-warm`);
      if (td && c.v === min) td.classList.add("win");
    }
  }
}

async function probeServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL_CAPNWASM_WS);
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 1500);
    ws.onopen  = () => { clearTimeout(t); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
}

async function runAll() {
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  summary.className = "summary";
  summary.textContent = "Running…";
  const iters = parseInt(itersSel.value, 10);

  document.querySelectorAll("td.num").forEach((td) => {
    td.classList.remove("win", "error");
    td.classList.add("running");
    td.textContent = "—";
  });

  status.textContent = "Loading wasm + connecting transports…";
  await ensureCpp();
  const bundles: Record<TransportKey, Bundle> = {
    "capnweb-ws":   await makeCapnwebWs(),
    "capnweb-http": await makeCapnwebHttp(),
    "capnwasm-ws":  await makeCapnwasmWs(),
    "capnwasm-http":await makeCapnwasmHttp(),
  };

  const allResults = new Map<string, Map<TransportKey, Map<number, Cell>>>();

  for (const w of WORKLOADS) {
    const wResults = new Map<TransportKey, Map<number, Cell>>();
    allResults.set(w.id, wResults);
    for (const tr of TRANSPORTS) {
      const sizeMap = new Map<number, Cell>();
      wResults.set(tr.key, sizeMap);
      const b = bundles[tr.key];
      for (const s of w.sizes) {
        status.textContent = `${w.id} · ${tr.label} · ${s.label} …`;
        const cell = await runCell(() => w.call(b, s.value), iters);
        sizeMap.set(s.value, cell);
        fillCell(w.id, tr.key, s.value, cell);
      }
    }
    paintWinners(w, wResults);
  }

  // Roll up: for each workload, count cells (sizes) won per transport
  // (warm). Picks the transport that won the most sizes as the workload
  // winner; reports ties verbatim so the user can see when nobody won.
  const lines: string[] = [];
  for (const w of WORKLOADS) {
    const wins: Record<TransportKey, number> = {
      "capnweb-ws": 0, "capnweb-http": 0, "capnwasm-ws": 0, "capnwasm-http": 0,
    };
    const wResults = allResults.get(w.id)!;
    for (const s of w.sizes) {
      const warm: { key: TransportKey; v: number }[] = [];
      for (const tr of TRANSPORTS) {
        const c = wResults.get(tr.key)?.get(s.value);
        if (c && !c.error && isFinite(c.warmMs)) warm.push({ key: tr.key, v: c.warmMs });
      }
      if (warm.length === 0) continue;
      const min = Math.min(...warm.map((c) => c.v));
      for (const c of warm) if (c.v === min) wins[c.key]++;
    }
    const winners = (Object.keys(wins) as TransportKey[])
      .filter((k) => wins[k] > 0)
      .sort((a, b) => wins[b] - wins[a]);
    const top = winners[0];
    const tied = winners.filter((k) => wins[k] === wins[top]);
    const label = tied.length === 1
      ? `<strong>${top}</strong> (${wins[top]}/${w.sizes.length})`
      : `tied: ${tied.map((k) => `<strong>${k}</strong>`).join(", ")}`;
    lines.push(`<strong>${w.id}</strong>: ${label}`);
  }
  summary.innerHTML = lines.join("<br>") +
    `<br><br><em>Both libraries win some, lose some. capnwasm tends to win on binary blobs and sparse-field reads; ` +
    `capnweb tends to win on re-read storms and small-payload cold paths. ` +
    `Pick by your workload — there is no single winner.</em>`;

  status.textContent = `done — ${iters} warm iters per cell, cold = first call after open`;
  runBtn.disabled = false;
  runBtn.textContent = "Run all benchmarks";
}

function buildAllTables() {
  for (const w of WORKLOADS) {
    const block = document.getElementById("bench-" + w.id);
    if (!block) continue;
    block.replaceChildren(buildTable(w));
  }
}
buildAllTables();

let inFlight = false;
async function runSafe() {
  if (inFlight) return;
  inFlight = true;
  try { await runAll(); }
  finally { inFlight = false; }
}
runBtn.addEventListener("click", runSafe);

(async () => {
  const up = await probeServer();
  if (up) {
    serverDot.classList.add("up");
    serverMsg.innerHTML = `Server up at <code>${WS_ORIGIN}</code> &mdash; ready.`;
    runBtn.disabled = false;
  } else {
    serverDot.classList.add("down");
    serverMsg.innerHTML =
      `<strong>RPC server unreachable.</strong> Run <code>npm run dev</code> or <code>npm run preview</code> from the <code>web/</code> dir; ` +
      `the server is mounted on the same port as Vite.`;
    status.textContent = "RPC server unreachable.";
  }
})();

// Touch the import to silence "unused" when openUserList isn't called
// directly (we use the class form via resultsReader).
void openUserList;
