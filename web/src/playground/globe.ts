// /playground — orange globe of Cloudflare PoPs.
//
// Every endpoint in cloudflare-openapi.json (built into
// /data/cf-endpoints.json by web/scripts/build-globe-data.mjs) is a
// dot on the SVG globe at its real PoP. Each dot is randomly assigned
// a language; clicking sends a Cap'n Proto envelope to the matching
// /chat/<lang> Cloudflare Worker, which decodes, replies in the
// language's idiom, re-encodes, and ships the bytes back. The reply
// pulses the dot and bubbles out at the dot's lat/lng.
//
// One wire format every runtime decodes — that's the OpenAPI / capnwasm
// pitch made literal here. No editor, no chat thread, no inspector.

// @ts-ignore — runtime modules without bundled .d.ts.
import { prepareEnvelope, decodeEnvelope } from "./runtime-capnwasm.js";
import type { GlobeEndpoint, GlobeHandle } from "./globe-renderer.js";
import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import pythonLang from "highlight.js/lib/languages/python";
import rubyLang from "highlight.js/lib/languages/ruby";
import goLang from "highlight.js/lib/languages/go";
import javaLang from "highlight.js/lib/languages/java";
import jsonLang from "highlight.js/lib/languages/json";
import "highlight.js/styles/github-dark.css";

type Lang = "js" | "python" | "ruby" | "go" | "java";

const LANG_POOL: Lang[] = ["js", "python", "ruby", "go", "java"];

hljs.registerLanguage("typescript", typescriptLang);
hljs.registerLanguage("python", pythonLang);
hljs.registerLanguage("ruby", rubyLang);
hljs.registerLanguage("go", goLang);
hljs.registerLanguage("java", javaLang);
hljs.registerLanguage("json", jsonLang);

const LANG_LABEL: Record<Lang, string> = {
  js: "TypeScript",
  python: "Python",
  ruby: "Ruby",
  go: "Go",
  java: "Java",
};

// ---- DOM -------------------------------------------------------------

const $  = <T extends Element>(s: string) => document.querySelector(s) as T;
const els = {
  globeCanvas: $<HTMLDivElement>("#globe-canvas"),
  bubbleLayer: $<HTMLDivElement>("#bubble-layer"),
  status:      $<HTMLDivElement>("#globe-status"),
  wireStats:   $<HTMLElement>("#wire-stats"),
  endpointCount: $<HTMLElement>("#endpoint-count"),
  endpointList:  $<HTMLDivElement>("#endpoint-list"),
  endpointSearch: $<HTMLInputElement>("#endpoint-search"),
  dialog: $<HTMLDialogElement>("#endpoint-dialog"),
  dialogTitle: $<HTMLElement>("#dialog-title"),
  dialogSummary: $<HTMLElement>("#dialog-summary"),
  requestPayload: $<HTMLTextAreaElement>("#request-payload"),
  runEndpoint: $<HTMLButtonElement>("#run-endpoint"),
  runStatus: $<HTMLElement>("#run-status"),
  languageTabs: $<HTMLDivElement>("#language-tabs"),
  languageCode: $<HTMLElement>("#language-code"),
  mockResponse: $<HTMLElement>("#mock-response"),
};

// ---- State -----------------------------------------------------------

interface Endpoint extends GlobeEndpoint {
  lang: Lang;
  summary?: string | null;
  description?: string | null;
  params?: Array<{ name: string; in: string; type: string; required: boolean }>;
  mock?: unknown;
}

let endpoints: Endpoint[] = [];
let globeHandle: GlobeHandle | null = null;
let endpointFilter = "";
let selectedEndpoint: Endpoint | null = null;
let selectedLang: Lang = "js";
let hoverClearTimer: number | null = null;

function pickLang(): Lang {
  return LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)];
}

function setStatus(text: string): void {
  if (els.status) els.status.textContent = text;
}

// ---- Boot ------------------------------------------------------------

async function mountGlobe(): Promise<void> {
  try {
    const mod = await import("./globe-renderer.js");
    globeHandle = mod.mountGlobeRenderer({
      container:   els.globeCanvas,
      bubbleLayer: els.bubbleLayer,
      initial:     [],
      onSelect:    (ep) => openEndpointDialog(ep.id),
      onHover:     (ep) => hoverEndpoint(ep.id),
      onLeave:     endEndpointHover,
      onBubbleClick: (ep) => openEndpointDialog(ep.id),
    });
  } catch (err) {
    setStatus(`Globe failed to mount: ${(err as Error).message}`);
  }
}

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
    setStatus(`Endpoint index missing (${res.status}). Run \`pnpm prepare:assets\`.`);
    return;
  }
  const data = await res.json();
  const raw = (data.endpoints ?? []) as Array<Omit<Endpoint, "lang">>;
  endpoints = raw.map((ep) => ({ ...ep, lang: pickLang() }));
  if (globeHandle) globeHandle.setEndpoints(endpoints);
  renderEndpointList();
  setStatus(`${endpoints.length.toLocaleString()} endpoints across ${data.stats?.tags ?? "?"} tags · hover rows or dots, click bubble to open`);
}

function renderEndpointList(): void {
  const filtered = endpointFilter
    ? endpoints.filter((ep) => endpointMatches(ep, endpointFilter))
    : endpoints;
  if (els.endpointCount) {
    els.endpointCount.textContent = endpointFilter
      ? `${filtered.length.toLocaleString()} of ${endpoints.length.toLocaleString()}`
      : `${endpoints.length.toLocaleString()} endpoints`;
  }
  if (!els.endpointList) return;
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "endpoint-empty";
    empty.textContent = `No endpoints match "${endpointFilter}".`;
    els.endpointList.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const ep of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "endpoint-row";
    row.dataset.id = ep.id;
    row.setAttribute("role", "listitem");

    const method = document.createElement("span");
    method.className = "endpoint-method";
    method.textContent = ep.method;

    const body = document.createElement("span");
    const path = document.createElement("span");
    path.className = "endpoint-path";
    path.textContent = ep.path;
    const meta = document.createElement("span");
    meta.className = "endpoint-meta";
    meta.textContent = `${ep.tag} · ${ep.pop} · ${ep.lang}`;
    body.append(path, meta);

    row.append(method, body);
    row.addEventListener("mouseenter", () => hoverEndpoint(ep.id));
    row.addEventListener("focus", () => hoverEndpoint(ep.id));
    row.addEventListener("mouseleave", endEndpointHover);
    row.addEventListener("blur", endEndpointHover);
    row.addEventListener("click", () => openEndpointDialog(ep.id));
    frag.appendChild(row);
  }
  els.endpointList.replaceChildren(frag);
}

function focusEndpoint(endpointId: string): void {
  markActiveEndpoint(endpointId);
  globeHandle?.focus(endpointId);
}

function hoverEndpoint(endpointId: string): void {
  const ep = endpoints.find((e) => e.id === endpointId);
  if (!ep) return;
  if (hoverClearTimer !== null) {
    window.clearTimeout(hoverClearTimer);
    hoverClearTimer = null;
  }
  focusEndpoint(endpointId);
  globeHandle?.showBubble(ep.id, bubbleText(ep), `lang-${ep.lang}`);
}

function endEndpointHover(): void {
  globeHandle?.resume();
  if (hoverClearTimer !== null) window.clearTimeout(hoverClearTimer);
  hoverClearTimer = window.setTimeout(() => {
    globeHandle?.clearBubble();
    hoverClearTimer = null;
  }, 1400);
}

function endpointMatches(ep: Endpoint, q: string): boolean {
  const haystack = `${ep.method} ${ep.path} ${ep.tag} ${ep.pop} ${ep.lang}`.toLowerCase();
  return q.split(/\s+/).every((part) => haystack.includes(part));
}

function bubbleText(ep: Endpoint): string {
  const summary = ep.summary ? ` · ${ep.summary}` : "";
  return `${ep.pop}: ${ep.method} ${ep.path}${summary} · click this bubble to open request`;
}

// ---- Endpoint dialog ---------------------------------------------------

function openEndpointDialog(endpointId: string): void {
  const ep = endpoints.find((e) => e.id === endpointId);
  if (!ep) return;
  selectedEndpoint = ep;
  if (hoverClearTimer !== null) {
    window.clearTimeout(hoverClearTimer);
    hoverClearTimer = null;
  }
  selectedLang = ep.lang;
  focusEndpoint(endpointId);
  globeHandle?.showBubble(ep.id, bubbleText(ep), `lang-${ep.lang}`);
  els.dialogTitle.textContent = `${ep.method} ${ep.path}`;
  els.dialogSummary.textContent = ep.summary || ep.description || `${ep.tag} endpoint at ${ep.pop}`;
  els.requestPayload.value = JSON.stringify(examplePayload(ep), null, 2);
  renderLanguageTabs();
  renderDialogCode();
  renderMockResponse(ep.mock ?? { success: true, result: null, errors: [], messages: [] });
  els.runStatus.textContent = "Edit the payload, then run it through the Worker.";
  if (!els.dialog.open) els.dialog.showModal();
}

function renderLanguageTabs(): void {
  els.languageTabs.replaceChildren();
  for (const lang of LANG_POOL) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "language-tab";
    btn.dataset.lang = lang;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", lang === selectedLang ? "true" : "false");
    btn.textContent = LANG_LABEL[lang];
    btn.addEventListener("click", () => {
      selectedLang = lang;
      renderLanguageTabs();
      renderDialogCode();
    });
    els.languageTabs.appendChild(btn);
  }
}

function renderDialogCode(): void {
  if (!selectedEndpoint) return;
  const payload = parsePayload();
  const code = snippetFor(selectedLang, selectedEndpoint, payload);
  const langClass = selectedLang === "js" ? "typescript" : selectedLang;
  els.languageCode.textContent = code;
  els.languageCode.className = `language-${langClass}`;
  delete els.languageCode.dataset.highlighted;
  hljs.highlightElement(els.languageCode);
}

function renderMockResponse(value: unknown): void {
  els.mockResponse.textContent = JSON.stringify(value, null, 2);
  els.mockResponse.className = "language-json";
  delete els.mockResponse.dataset.highlighted;
  hljs.highlightElement(els.mockResponse);
}

function examplePayload(ep: Endpoint): Record<string, unknown> {
  const path: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  for (const p of ep.params ?? []) {
    const value = sampleParamValue(p.name, p.type);
    if (p.in === "path") path[p.name] = value;
    else if (p.in === "query") query[p.name] = value;
  }
  const out: Record<string, unknown> = { path, query };
  if (!["GET", "DELETE", "HEAD"].includes(ep.method)) {
    out.body = { name: "example", enabled: true };
  }
  return out;
}

function sampleParamValue(name: string, type: string): unknown {
  if (type === "integer" || type === "number") return 1;
  if (type === "boolean") return true;
  if (/zone/i.test(name)) return "example.com";
  if (/account/i.test(name)) return "0123456789abcdef0123456789abcdef";
  return `example-${name}`;
}

function parsePayload(): unknown {
  try {
    return JSON.parse(els.requestPayload.value || "{}");
  } catch {
    return {};
  }
}

function snippetFor(lang: Lang, ep: Endpoint, payload: unknown): string {
  const body = JSON.stringify(payload, null, 2);
  const path = ep.path.replace(/\{([^}]+)\}/g, "${$1}");
  switch (lang) {
    case "python":
      return `from Cloudflare import Cloudflare\n\nclient = Cloudflare()\npayload = ${pyLiteral(payload)}\nresponse = client.request(\n    method="${ep.method}",\n    path=f"${path}",\n    json=payload,\n)\nprint(response)`;
    case "ruby":
      return `require "cloudflare"\n\nclient = Cloudflare::Client.new\npayload = ${rubyLiteral(payload)}\nresponse = client.request(\n  method: "${ep.method}",\n  path: "${ep.path}",\n  body: payload\n)\nputs response`;
    case "go":
      return `package main\n\nimport (\n  "context"\n  "fmt"\n\n  "github.com/cloudflare/cloudflare-go"\n)\n\nfunc main() {\n  api, _ := cloudflare.NewWithAPIToken("$CLOUDFLARE_API_TOKEN")\n  payload := []byte(\`${body}\`)\n  resp, _ := api.MakeRequestContext(context.Background(), "${ep.method}", "${ep.path}", payload)\n  fmt.Println(string(resp))\n}`;
    case "java":
      return `Cloudflare client = Cloudflare.fromEnv();\nString payload = """\n${body}\n""";\n\nCloudflareResponse response = client.request(\n    "${ep.method}",\n    "${ep.path}",\n    payload\n);\nSystem.out.println(response.body());`;
    case "js":
    default:
      return `import Cloudflare from "cloudflare";\n\nconst client = new Cloudflare();\nconst payload = ${body};\n\nconst response = await client.request("${ep.method}", "${ep.path}", {\n  body: payload,\n});\nconsole.log(response);`;
  }
}

function pyLiteral(value: unknown): string {
  return JSON.stringify(value, null, 4).replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None");
}

function rubyLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/:/g, " =>");
}

els.requestPayload?.addEventListener("input", renderDialogCode);

els.runEndpoint?.addEventListener("click", () => {
  if (selectedEndpoint) void runEndpointFromDialog(selectedEndpoint);
});

async function runEndpointFromDialog(ep: Endpoint): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(els.requestPayload.value || "{}");
  } catch (err) {
    els.runStatus.textContent = `Payload is not valid JSON: ${(err as Error).message}`;
    return;
  }
  els.runStatus.textContent = `${LANG_LABEL[selectedLang]} request encoding as Cap'n Proto…`;
  const speaker = `${ep.method} ${ep.path}`;
  try {
    const requestEnv = await prepareEnvelope({
      speaker,
      body: JSON.stringify({ language: selectedLang, payload }),
      replyTo: "openapi-dialog",
    });
    const res = await fetch(`/chat/${selectedLang}`, {
      method: "POST",
      headers: { "content-type": "application/capnp" },
      body: requestEnv.bytes,
    });
    if (!res.ok) throw new Error(`/chat/${selectedLang} ${res.status}`);
    const respBytes = new Uint8Array(await res.arrayBuffer());
    const reader = await decodeEnvelope(respBytes);
    renderMockResponse(ep.mock ?? { success: true, result: null, errors: [], messages: [] });
    globeHandle?.fireBubble(ep.id, `${ep.pop} (${selectedLang}): mock response returned`, `lang-${selectedLang}`);
    showWireStats(requestEnv.bytes.length, requestEnv.stats.jsonBytes,
                  requestEnv.stats.encodeMs, requestEnv.stats.decodeMs);
    els.runStatus.textContent = `Worker replied: ${reader.body || "mock response returned"}`;
  } catch (err) {
    els.runStatus.textContent = `Run failed: ${(err as Error).message}`;
  }
}

// ---- Fire an endpoint -----------------------------------------------

async function fireEndpoint(endpointId: string): Promise<void> {
  const ep = endpoints.find((e) => e.id === endpointId);
  if (!ep) return;
  focusEndpoint(endpointId);
  const speaker = `${ep.method} ${ep.path}`;
  setStatus(`${ep.pop} (${ep.lang}) firing ${speaker}…`);
  try {
    const requestEnv = await prepareEnvelope({ speaker, body: speaker, replyTo: "" });
    const res = await fetch(`/chat/${ep.lang}`, {
      method: "POST",
      headers: { "content-type": "application/capnp" },
      body:    requestEnv.bytes,
    });
    if (!res.ok) throw new Error(`/chat/${ep.lang} ${res.status}`);
    const respBytes = new Uint8Array(await res.arrayBuffer());
    const reader = await decodeEnvelope(respBytes);
    const replyText = reader.body ?? "";
    if (globeHandle) {
      globeHandle.fireBubble(ep.id, `${ep.pop} (${ep.lang}): ${replyText}`, `lang-${ep.lang}`);
    }
    showWireStats(requestEnv.bytes.length, requestEnv.stats.jsonBytes,
                  requestEnv.stats.encodeMs, requestEnv.stats.decodeMs);
    setStatus(`${ep.pop} (${ep.lang}) replied — click another dot`);
  } catch (err) {
    if (globeHandle) {
      globeHandle.fireBubble(ep.id, `${ep.pop} (${ep.lang}) error: ${(err as Error).message}`, `lang-${ep.lang}`);
    }
    setStatus(`${ep.pop} (${ep.lang}) error — try again`);
  }
}

function markActiveEndpoint(endpointId: string): void {
  if (!els.endpointList) return;
  for (const row of els.endpointList.querySelectorAll(".endpoint-row.is-active")) {
    row.classList.remove("is-active");
  }
  els.endpointList.querySelector(`[data-id="${CSS.escape(endpointId)}"]`)?.classList.add("is-active");
}

function showWireStats(capnp: number, json: number, encMs: number, decMs: number): void {
  if (!els.wireStats) return;
  els.wireStats.textContent =
    `last wire — capnp ${capnp} B vs json ${json} B · encode ${encMs.toFixed(2)} ms · decode ${decMs.toFixed(2)} ms`;
}

els.endpointSearch?.addEventListener("input", () => {
  endpointFilter = els.endpointSearch.value.trim().toLowerCase();
  renderEndpointList();
});

// Mount globe first so the page paints; load endpoints after.
void mountGlobe().then(loadEndpoints);
