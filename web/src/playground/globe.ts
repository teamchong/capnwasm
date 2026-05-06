// Cloudflare-API-as-a-globe playground.
//
// Loads the slim endpoint index built by web/scripts/build-globe-data.mjs,
// renders a searchable list of endpoints, lets the user pick one, and
// runs a small user-edited function in JS / Python / Ruby / Go against
// that endpoint's mocked response. The function's return value bubbles
// out at the endpoint's lat/lng on the orange Cloudflare globe.
//
// This file is the page's entry point. The actual globe renderer (three
// + globe.gl) is loaded lazily so the inspector + editor work even when
// the globe library is still in flight or fails to load. Same idea for
// the Python / Ruby / Go runtimes — each lazy-loaded on first use of
// that tab.

type Lang = "js" | "python" | "ruby" | "go";

interface Endpoint {
  id: string;
  path: string;
  method: string;
  tag: string;
  summary: string | null;
  description: string | null;
  lat: number;
  lng: number;
  pop: string;
  params: Array<{ name: string; in: string; type: string; required: boolean }>;
  mock: unknown;
}

interface IndexFile {
  generatedAt: string;
  stats: { paths: number; operations: number; tags: number };
  pops: Array<{ city: string; country: string; lat: number; lng: number }>;
  endpoints: Endpoint[];
}

const $  = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends Element>(sel: string) => Array.from(document.querySelectorAll(sel)) as T[];

const els = {
  list:        $<HTMLDivElement>("#endpoint-list"),
  count:       $<HTMLSpanElement>("#endpoint-count"),
  search:      $<HTMLInputElement>("#endpoint-search"),
  detail:      $<HTMLDivElement>("#endpoint-detail"),
  detailVerb:  $<HTMLSpanElement>("#detail-verb"),
  detailPath:  $<HTMLElement>("#detail-path"),
  detailSum:   $<HTMLParagraphElement>("#detail-summary"),
  detailTags:  $<HTMLDivElement>("#detail-tags"),
  editor:      $<HTMLDivElement>("#editor-mount"),
  fire:        $<HTMLButtonElement>("#fire-btn"),
  status:      $<HTMLSpanElement>("#runtime-status"),
  preview:     $<HTMLOutputElement>("#bubble-preview"),
  langTabs:    $$<HTMLButtonElement>(".lang-tab"),
  globeCanvas: $<HTMLDivElement>("#globe-canvas"),
  bubbleLayer: $<HTMLDivElement>("#bubble-layer"),
};

let endpoints: Endpoint[] = [];
let filteredEndpoints: Endpoint[] = [];
let selected: Endpoint | null = null;
let currentLang: Lang = "js";

// Per-language editor source so switching tabs preserves what the user
// typed. Seeded with the SDK template for the current endpoint each time
// a new endpoint is selected.
const editorSources: Record<Lang, string> = { js: "", python: "", ruby: "", go: "" };

// ---- Endpoint loader ---------------------------------------------------

async function loadEndpoints(): Promise<void> {
  setStatus("Loading endpoints…");
  let res: Response;
  try {
    res = await fetch("/data/cf-endpoints.json", { cache: "force-cache" });
  } catch (err) {
    setStatus(`Endpoint index fetch failed: ${(err as Error).message}`);
    return;
  }
  if (!res.ok) {
    setStatus(`Endpoint index missing (${res.status}). Run \`pnpm prepare:assets\` to generate it.`);
    renderSampleEndpoints();
    return;
  }
  const data = (await res.json()) as IndexFile;
  endpoints = data.endpoints;
  filteredEndpoints = endpoints;
  els.count.textContent = `${endpoints.length} endpoints`;
  setStatus(`Loaded ${endpoints.length} endpoints across ${data.stats.tags} tags.`);
  renderList();
  // If the globe is already mounted (race depending on fetch vs three.js
  // load order) push the dataset; otherwise mountGlobe() will pick it up
  // from the closure when it runs.
  if (globeHandle) globeHandle.setEndpoints(toGlobeEndpoints(endpoints));
  if (endpoints.length > 0) selectEndpoint(endpoints[0]);
}

function renderSampleEndpoints(): void {
  // Fallback when the build-time index isn't available — keeps the page
  // demonstrable so the dev experience doesn't depend on the gitignored
  // cloudflare-openapi.json fixture.
  endpoints = [
    {
      id: "demo-list-zones",
      path: "/zones",
      method: "GET",
      tag: "Zones",
      summary: "List zones",
      description: null,
      lat: 51.5074, lng: -0.1278, pop: "London",
      params: [{ name: "name", in: "query", type: "string", required: false }],
      mock: { result: [{ id: "0".repeat(32), name: "example.com", status: "active" }], success: true, errors: [], messages: [] },
    },
    {
      id: "demo-get-account",
      path: "/accounts/{id}",
      method: "GET",
      tag: "Accounts",
      summary: "Get account details",
      description: null,
      lat: 38.9072, lng: -77.0369, pop: "Washington DC",
      params: [{ name: "id", in: "path", type: "string", required: true }],
      mock: { result: { id: "1".repeat(32), name: "Sample Account" }, success: true, errors: [], messages: [] },
    },
  ];
  filteredEndpoints = endpoints;
  els.count.textContent = `${endpoints.length} sample endpoints`;
  renderList();
  selectEndpoint(endpoints[0]);
}

// ---- Inspector list ----------------------------------------------------

function renderList(): void {
  // Build the list in chunks via a DocumentFragment to avoid layout
  // thrashing on the 2920-row case.
  const frag = document.createDocumentFragment();
  const limit = Math.min(filteredEndpoints.length, 500);
  for (let i = 0; i < limit; i++) {
    const ep = filteredEndpoints[i];
    const row = document.createElement("button");
    row.className = "endpoint-row";
    row.dataset.id = ep.id;
    row.setAttribute("role", "option");
    row.innerHTML = `
      <span class="row-verb verb verb-${ep.method.toLowerCase()}">${ep.method}</span>
      <span class="row-path">${escapeHtml(ep.path)}</span>
      <span class="row-tag">${escapeHtml(ep.tag)}</span>
    `;
    row.addEventListener("click", () => selectEndpoint(ep));
    frag.appendChild(row);
  }
  els.list.replaceChildren(frag);
  if (filteredEndpoints.length > limit) {
    const more = document.createElement("div");
    more.className = "endpoint-more";
    more.textContent = `+ ${filteredEndpoints.length - limit} more — refine the search to narrow.`;
    els.list.appendChild(more);
  }
}

function applyFilter(query: string): void {
  const q = query.trim().toLowerCase();
  if (!q) {
    filteredEndpoints = endpoints;
  } else {
    filteredEndpoints = endpoints.filter((ep) =>
      ep.path.toLowerCase().includes(q) ||
      ep.id.toLowerCase().includes(q) ||
      ep.tag.toLowerCase().includes(q) ||
      (ep.summary?.toLowerCase().includes(q) ?? false),
    );
  }
  els.count.textContent = `${filteredEndpoints.length} / ${endpoints.length}`;
  renderList();
}

// ---- Endpoint selection ------------------------------------------------

function selectEndpoint(ep: Endpoint): void {
  selected = ep;
  els.detail.hidden = false;
  els.detailVerb.textContent = ep.method;
  els.detailVerb.className = `verb verb-${ep.method.toLowerCase()}`;
  els.detailPath.textContent = ep.path;
  els.detailSum.textContent = ep.summary ?? "—";
  els.detailTags.innerHTML = `
    <span class="tag-pill">${escapeHtml(ep.tag)}</span>
    <span class="tag-pill pop">📍 ${escapeHtml(ep.pop)}</span>
  `;
  // Highlight the selected row.
  for (const r of $$<HTMLButtonElement>(".endpoint-row")) {
    r.classList.toggle("selected", r.dataset.id === ep.id);
  }
  // Reseed editors with starter SDK code for this endpoint, in every lang.
  editorSources.js     = jsTemplate(ep);
  editorSources.python = pythonTemplate(ep);
  editorSources.ruby   = rubyTemplate(ep);
  editorSources.go     = goTemplate(ep);
  setEditor(editorSources[currentLang]);
  els.fire.disabled = false;
  void runEditor("select");
  globeHandle?.focus(ep.id);
}

// ---- SDK code templates -----------------------------------------------
//
// Each template takes the selected endpoint and produces idiomatic-ish
// SDK code in the target language. The functions don't *actually* call
// the Cloudflare API — they receive `response` (the mocked payload) and
// return a string for the bubble. The SDK-shaped imports / client setup
// are decorative so the snippet reads like real SDK usage.

function jsTemplate(ep: Endpoint): string {
  const method = sdkMethodChain(ep);
  return `// Cloudflare TypeScript SDK
import Cloudflare from "cloudflare";
const cf = new Cloudflare({ apiToken: "your_token" });

// ${ep.method} ${ep.path}
// const response = await cf.${method};

export default function format(response) {
  return JSON.stringify(response).slice(0, 60) + "…";
}
`;
}

function pythonTemplate(ep: Endpoint): string {
  const method = sdkMethodChainPy(ep);
  return `# Cloudflare Python SDK
from cloudflare import Cloudflare
cf = Cloudflare(api_token="your_token")

# ${ep.method} ${ep.path}
# response = cf.${method}

def format(response):
    return f"{type(response).__name__}: {str(response)[:60]}…"
`;
}

function rubyTemplate(ep: Endpoint): string {
  return `# Cloudflare Ruby SDK
require "cloudflare"
cf = Cloudflare.new(token: "your_token")

# ${ep.method} ${ep.path}
# response = cf.${sdkMethodChainRb(ep)}

def format(response)
  "#{response.class}: #{response.to_s[0..60]}…"
end
`;
}

function goTemplate(ep: Endpoint): string {
  return `// Cloudflare Go SDK
package main

import (
    "context"
    "fmt"

    "github.com/cloudflare/cloudflare-go/v3"
    "github.com/cloudflare/cloudflare-go/v3/option"
)

// ${ep.method} ${ep.path}
func format(response interface{}) string {
    return fmt.Sprintf("%T: %v", response, response)
}

func main() {
    cf := cloudflare.NewClient(option.WithAPIToken("your_token"))
    _ = cf
    _ = context.Background()
}
`;
}

// Crude but readable mapping of REST path → SDK method chain.
// Cloudflare's TS SDK uses dot-notation grouped by tag.
function sdkMethodChain(ep: Endpoint): string {
  const segs = ep.path.split("/").filter(Boolean);
  const params: string[] = [];
  const chain: string[] = [];
  for (const s of segs) {
    if (s.startsWith("{") && s.endsWith("}")) {
      params.push(camelCase(s.slice(1, -1)));
    } else {
      chain.push(camelCase(s));
    }
  }
  const verb = ep.method.toLowerCase();
  const action =
    verb === "get"    && params.length === 0 ? "list"   :
    verb === "get"                             ? "get"    :
    verb === "post"                            ? "create" :
    verb === "put"                             ? "update" :
    verb === "patch"                           ? "edit"   :
    verb === "delete"                          ? "delete" :
    verb;
  return `${chain.join(".")}.${action}(${params.join(", ")})`;
}

function sdkMethodChainPy(ep: Endpoint): string {
  return sdkMethodChain(ep).replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

function sdkMethodChainRb(ep: Endpoint): string {
  return sdkMethodChainPy(ep);
}

function camelCase(s: string): string {
  return s.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
}

// ---- Editor ------------------------------------------------------------
//
// Light textarea-backed editor. Monaco / CodeMirror upgrade is queued
// for after the runtimes are wired up; this gets the live-eval flow
// running today with a 4-line implementation.

let editorEl: HTMLTextAreaElement | null = null;

function mountEditor(): void {
  const ta = document.createElement("textarea");
  ta.className = "editor-textarea";
  ta.spellcheck = false;
  ta.autocapitalize = "off";
  ta.setAttribute("autocorrect", "off");
  ta.setAttribute("autocomplete", "off");
  ta.addEventListener("input", () => {
    editorSources[currentLang] = ta.value;
    debouncedRun();
  });
  els.editor.replaceChildren(ta);
  editorEl = ta;
}

function setEditor(text: string): void {
  if (!editorEl) return;
  editorEl.value = text;
  editorSources[currentLang] = text;
}

let runTimer: number | undefined;
function debouncedRun(): void {
  window.clearTimeout(runTimer);
  runTimer = window.setTimeout(() => void runEditor("input"), 250);
}

// ---- Runtimes ----------------------------------------------------------
//
// JS runs natively. Python / Ruby / Go are placeholders that report
// their loading state and will be replaced with real interpreters
// (micropython.wasm, mruby.wasm, yaegi-wasm) in a follow-up.

async function runEditor(reason: "select" | "input" | "fire"): Promise<string> {
  if (!selected) return "";
  const code = editorEl?.value ?? editorSources[currentLang];
  let result: string;
  try {
    if (currentLang === "js") {
      result = await runJs(code, selected.mock);
    } else {
      result = await runStub(currentLang, code);
    }
  } catch (err) {
    result = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  els.preview.textContent = result || "(empty)";
  // Fire a bubble on explicit fire only — doing it on every keystroke
  // would mash the globe with bubbles. The preview area shows the live
  // result on every input.
  if (reason === "fire") globeHandle?.fireBubble(selected.id, result);
  return result;
}

async function runJs(source: string, response: unknown): Promise<string> {
  // Strip the decorative import + client lines so the user's `format`
  // function is what we eval. We expose `response` and `format` as
  // globals inside a fresh Function scope.
  const trimmed = source
    .replace(/^\s*import[^\n]*\n/gm, "// import skipped — running mock\n")
    .replace(/^\s*export\s+default\s+/m, "var __default = ");
  const factory = new Function("response", `${trimmed}
    var __fn = (typeof __default === "function") ? __default
              : (typeof format === "function") ? format
              : null;
    if (!__fn) throw new Error("define a function called 'format' or 'export default'");
    var __out = __fn(response);
    return __out == null ? "" : (typeof __out === "string" ? __out : String(__out));
  `);
  const out = factory(response);
  return typeof out === "string" ? out : String(out);
}

async function runStub(lang: Lang, _code: string): Promise<string> {
  // Tier-2: real interpreters land here. Until then, signal status and
  // fall back to a JS-rendered preview of the mocked response so the
  // page is still useful.
  const labels: Record<Lang, string> = {
    js: "JS",
    python: "micropython.wasm (loading…)",
    ruby:   "mruby.wasm (loading…)",
    go:     "yaegi.wasm (loading…)",
  };
  setStatus(`${labels[lang]} runtime not yet available; showing mock preview.`);
  return JSON.stringify(selected?.mock).slice(0, 80) + "…";
}

// ---- Tabs --------------------------------------------------------------

function bindLangTabs(): void {
  for (const t of els.langTabs) {
    t.addEventListener("click", () => {
      const lang = t.dataset.lang as Lang;
      currentLang = lang;
      for (const o of els.langTabs) o.setAttribute("aria-selected", String(o === t));
      setEditor(editorSources[lang]);
      void runEditor("select");
    });
  }
}

// ---- Globe canvas ------------------------------------------------------
//
// The actual orange globe (three.js / globe.gl) lazy-loads here so the
// inspector + editor stay usable on slow connections while three.js
// (~150 KB gz) is in flight.

import type { GlobeEndpoint, GlobeHandle } from "./globe-renderer.js";

let globeHandle: GlobeHandle | null = null;

async function mountGlobe(): Promise<void> {
  els.globeCanvas.innerHTML = `
    <div class="globe-placeholder">
      <span class="globe-spinner" aria-hidden="true"></span>
      <span>Loading globe&hellip;</span>
    </div>
  `;
  let mod;
  try {
    mod = await import("./globe-renderer.js");
  } catch (err) {
    els.globeCanvas.innerHTML = `
      <div class="globe-placeholder">
        <span style="color:#ff7043">Globe failed to load.</span>
        <span style="font-size:0.72rem;color:#6a7882">${(err as Error).message}</span>
      </div>
    `;
    return;
  }
  els.globeCanvas.innerHTML = "";
  globeHandle = mod.mountGlobeRenderer({
    container:   els.globeCanvas,
    bubbleLayer: els.bubbleLayer,
    initial:     toGlobeEndpoints(endpoints),
    onSelect:    (ep) => {
      const real = endpoints.find((e) => e.id === ep.id);
      if (real) selectEndpoint(real);
    },
  });
}

function toGlobeEndpoints(eps: Endpoint[]): GlobeEndpoint[] {
  return eps.map((e) => ({
    id: e.id, path: e.path, method: e.method, tag: e.tag,
    lat: e.lat, lng: e.lng, pop: e.pop,
  }));
}

// ---- Misc helpers ------------------------------------------------------

function setStatus(text: string): void {
  els.status.textContent = text;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// ---- Boot --------------------------------------------------------------

mountEditor();
bindLangTabs();
els.fire.addEventListener("click", () => void runEditor("fire"));
els.search.addEventListener("input", () => applyFilter(els.search.value));
void mountGlobe();
void loadEndpoints();
