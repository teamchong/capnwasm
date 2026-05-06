// OpenAPI <-> Cap'n Proto conversion demo. Direction-toggleable.
//
// OpenAPI -> .capnp:    pure JS, runs fully in-browser.
// .capnp  -> OpenAPI:   lazy-loads the bundled wasm capnp compiler the
//                       first time it's needed, then runs the same
//                       parse + manifest + emit pipeline as the CLI.
//
// UI: one prominent "Result" pre-block shows the converted output; a
// secondary "Round-trip back to OpenAPI" sanity check is shown only
// when going OpenAPI -> .capnp (where reading the round-tripped OpenAPI
// next to the input is informative).

// @ts-ignore local JS modules without bundled d.ts here.
import { parseOpenApi } from "../../../js/openapi_parser.mjs";
// @ts-ignore
import { buildManifest } from "../../../js/manifest.mjs";
// @ts-ignore
import { buildCapnp } from "../../../js/emit_capnp.mjs";
// @ts-ignore
import { buildOpenApiJson } from "../../../js/emit_openapi.mjs";
// @ts-ignore
import { parseCapnpText } from "../../../js/capnp_text_parser.mjs";

const input = document.getElementById("input") as HTMLTextAreaElement;
const statusEl = document.getElementById("status")!;
const summaryEl = document.getElementById("summary")!;
const primaryOut = document.getElementById("primary-out")!;
const secondaryOut = document.getElementById("secondary-out")!;
const secondaryBlock = document.getElementById("secondary-block")!;
const button = document.getElementById("convert") as HTMLButtonElement;
const dropzone = document.getElementById("dropzone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const dlCapnp = document.getElementById("download-capnp") as HTMLButtonElement;
const dlManifest = document.getElementById("download-manifest") as HTMLButtonElement;
const dlOpenapi = document.getElementById("download-openapi") as HTMLButtonElement;
const directionRadios = document.querySelectorAll<HTMLInputElement>('input[name="direction"]');
const inputTitle = document.getElementById("input-title")!;
const dropzoneText = document.getElementById("dropzone-text")!;
const primaryOutTitle = document.getElementById("primary-out-title")!;
const cliRows = document.getElementById("cli-rows")!;

type Direction = "openapi-to-capnp" | "capnp-to-openapi";

let direction: Direction = "openapi-to-capnp";
let lastBaseName = "books";
let lastCapnp = "";
let lastManifest: any = null;
let lastOpenapi = "";

const SAMPLE_OPENAPI = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Books API", version: "1.0.0" },
  servers: [{ url: "https://api.example.test" }],
  paths: {
    "/books/{id}": {
      get: {
        operationId: "getBook",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer", format: "int64" } },
          { name: "include_reviews", in: "query", required: false, schema: { type: "boolean" } },
        ],
        responses: {
          "200": {
            description: "Book",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Book" } } },
          },
        },
      },
    },
    "/books": {
      post: {
        operationId: "createBook",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/NewBook" } } },
        },
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Book" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Book: {
        type: "object",
        required: ["id", "title", "author"],
        properties: {
          id: { type: "integer", format: "int64" },
          title: { type: "string" },
          author: { type: "string" },
          cover: { type: "string", format: "binary" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      NewBook: {
        type: "object",
        required: ["title", "author"],
        properties: {
          title: { type: "string" },
          author: { type: "string" },
          cover: { type: "string", format: "binary" },
        },
      },
    },
  },
}, null, 2);

// Sample is exactly the shape `emit-capnp` produces from the default
// OpenAPI sample (inline method params, # HTTP comments). Round-tripping
// it back through capnp -> OpenAPI then yields paths + components again.
const SAMPLE_CAPNP = `# Sample Books API.
# HTTP path + verb travel as comments above each method, which is the
# form emit-capnp emits and what the parser scans for on the way back.

@0x9f8a7b6c5d4e3f2a;

struct Book {
  id     @0 :Int64;
  title  @1 :Text;
  author @2 :Text;
  cover  @3 :Data;
  tags   @4 :List(Text);
}

struct NewBook {
  title  @0 :Text;
  author @1 :Text;
  cover  @2 :Data;
}

interface BooksApi {
  # HTTP GET /books/{id}
  getBook @0 (id :Int64, includeReviews :Bool) -> (result :Book);

  # HTTP POST /books
  createBook @1 (body :NewBook) -> (result :Book);
}
`;

let capnpCompilerPromise: Promise<any> | null = null;
async function getCapnpCompiler() {
  if (!capnpCompilerPromise) {
    setStatus("Loading capnp compiler (~260 KB gz)…", "status");
    // @ts-ignore — no bundled .d.ts.
    capnpCompilerPromise = import("../../../dist/codegen.mjs").then((m) => m.CapnpCompiler.load());
  }
  return capnpCompilerPromise;
}

function setStatus(text: string, cls = "status") {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function setDownloadEnabled(enabled: boolean) {
  for (const b of [dlCapnp, dlManifest, dlOpenapi]) b.disabled = !enabled;
}

function downloadBlob(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function applyDirectionLabels() {
  if (direction === "openapi-to-capnp") {
    inputTitle.textContent = "OpenAPI input (JSON)";
    dropzoneText.textContent = "Drop an OpenAPI JSON file here, or click to upload.";
    fileInput.accept = ".json,application/json,application/yaml,.yaml,.yml";
    primaryOutTitle.textContent = "Result: .capnp";
    secondaryBlock.style.display = "";
  } else {
    inputTitle.textContent = "Cap'n Proto input (.capnp)";
    dropzoneText.textContent = "Drop a .capnp file here, or click to upload.";
    fileInput.accept = ".capnp,text/plain";
    primaryOutTitle.textContent = "Result: OpenAPI (JSON)";
    // No round-trip pre for capnp -> openapi (we'd be re-emitting the
    // same .capnp text the user pasted, which is just visual noise).
    secondaryBlock.style.display = "none";
  }
  updateCliEquiv();
}

function updateCliEquiv() {
  // Show the equivalent `npx capnwasm convert` invocation for whatever
  // is loaded in the input pane. The page and the CLI run the same
  // parser/emitter modules, so the commands shown here produce
  // byte-identical output to the in-browser conversion.
  const stem = lastBaseName || (direction === "openapi-to-capnp" ? "spec" : "schema");
  const inputName = direction === "openapi-to-capnp"
    ? `${stem}.openapi.json`
    : `${stem}.capnp`;
  const rows: { cmd: string; note?: string }[] = [];
  if (direction === "openapi-to-capnp") {
    rows.push({
      cmd: `npx capnwasm convert ${inputName}`,
      note: `# emits ${stem}.capnp next to ${inputName}`,
    });
  } else {
    rows.push({
      cmd: `npx capnwasm convert ${inputName} -o ${stem}.openapi.yaml`,
      note: `# YAML output (needs the optional 'yaml' npm package)`,
    });
    rows.push({
      cmd: `npx capnwasm convert ${inputName} -o ${stem}.openapi.json`,
      note: `# canonical JSON, no extra deps`,
    });
  }

  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const prompt = document.createElement("span");
    prompt.className = "prompt";
    prompt.textContent = "$";
    row.appendChild(prompt);
    const cmd = document.createElement("span");
    cmd.className = "cmd";
    cmd.textContent = r.cmd;
    if (r.note) {
      cmd.appendChild(document.createElement("br"));
      const note = document.createElement("span");
      note.style.color = "#778897";
      note.textContent = "  " + r.note;
      cmd.appendChild(note);
    }
    row.appendChild(cmd);
    const copy = document.createElement("button");
    copy.className = "copy";
    copy.type = "button";
    copy.textContent = "copy";
    copy.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        await navigator.clipboard.writeText(r.cmd);
        copy.textContent = "copied";
        copy.classList.add("ok");
        setTimeout(() => { copy.textContent = "copy"; copy.classList.remove("ok"); }, 1200);
      } catch {
        copy.textContent = "copy failed";
      }
    });
    row.appendChild(copy);
    frag.appendChild(row);
  }
  cliRows.replaceChildren(frag);
}

function loadSampleForDirection() {
  input.value = direction === "openapi-to-capnp" ? SAMPLE_OPENAPI : SAMPLE_CAPNP;
  lastBaseName = "books";
}

async function convert() {
  try {
    setStatus("Converting…", "status");
    if (direction === "openapi-to-capnp") {
      await convertOpenApiToCapnp();
    } else {
      await convertCapnpToOpenApi();
    }
    setDownloadEnabled(true);
  } catch (err) {
    primaryOut.textContent = "—";
    secondaryOut.textContent = "—";
    summaryEl.textContent = "Conversion failed.";
    lastCapnp = "";
    lastManifest = null;
    lastOpenapi = "";
    setDownloadEnabled(false);
    setStatus(err instanceof Error ? err.message : String(err), "status error");
  }
}

async function convertOpenApiToCapnp() {
  const spec = JSON.parse(input.value);
  const model = parseOpenApi(spec);
  const manifest = buildManifest(model, {
    source: { name: `${lastBaseName}.openapi.json`, format: "openapi" },
  });
  const capnp = buildCapnp(manifest);
  const openapi = buildOpenApiJson(manifest);

  lastCapnp = capnp.text;
  lastManifest = manifest;
  lastOpenapi = openapi;

  summaryEl.innerHTML = renderSummary({
    label: manifest.restApis[0]?.name ?? "API",
    rows: [
      ["methods", String(manifest.restApis[0]?.methods?.length ?? 0)],
      ["OpenAPI schemas", String(Object.keys(manifest.openapi?.components?.schemas ?? {}).length)],
      ["emitted structs", String(capnp.summary.structs)],
      ["emitted interfaces", String(capnp.summary.interfaces)],
      ["dropped notes", String(capnp.summary.dropped.length)],
    ],
  });
  primaryOut.textContent = capnp.text;
  secondaryOut.textContent = openapi;
  setStatus("Converted.", "status ok");
}

async function convertCapnpToOpenApi() {
  const compiler = await getCapnpCompiler();
  const model = await parseCapnpText(compiler, `${lastBaseName}.capnp`, input.value);
  const manifest = buildManifest(model, {
    source: { name: `${lastBaseName}.capnp`, format: "capnp" },
  });
  const openapi = buildOpenApiJson(manifest);

  lastCapnp = input.value;
  lastManifest = manifest;
  lastOpenapi = openapi;

  const restApi = manifest.restApis[0];
  const parsedDoc = JSON.parse(openapi);
  const pathCount = Object.keys(parsedDoc.paths ?? {}).length;
  const schemaCount = Object.keys(parsedDoc.components?.schemas ?? {}).length;

  summaryEl.innerHTML = renderSummary({
    label: restApi?.name ?? `${model.structs.length} struct${model.structs.length === 1 ? "" : "s"}`,
    rows: [
      ["interfaces", String(model.interfaces.length)],
      ["structs", String(model.structs.length)],
      ["REST methods", String(restApi?.methods?.length ?? 0)],
      ["emitted OpenAPI paths", String(pathCount)],
      ["emitted OpenAPI schemas", String(schemaCount)],
    ],
  });
  primaryOut.textContent = openapi;
  secondaryOut.textContent = "";
  setStatus("Converted.", "status ok");
}

function renderSummary({ label, rows }: { label: string; rows: [string, string][] }) {
  return `<strong>${escapeHtml(label)}</strong><br>` +
    rows.map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join("<br>");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

async function loadFile(file: File) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (direction === "openapi-to-capnp" && (lower.endsWith(".yaml") || lower.endsWith(".yml"))) {
    setStatus("YAML upload not supported in-browser yet — paste JSON, or use the CLI.", "status error");
    return;
  }
  const text = await file.text();
  input.value = text;
  // Strip the conventional `.openapi.json` / `.openapi.yaml` / `.capnp` /
  // plain `.json` / `.yaml` / `.yml` suffix to recover the project stem.
  lastBaseName = file.name
    .replace(/\.openapi\.(json|ya?ml)$/i, "")
    .replace(/\.(json|ya?ml|capnp)$/i, "") || "spec";
  updateCliEquiv();
  await convert();
}

button.addEventListener("click", () => { void convert(); });
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});

dlCapnp.addEventListener("click", () => {
  if (!lastCapnp) return;
  downloadBlob(`${lastBaseName}.capnp`, lastCapnp, "text/plain");
});
dlManifest.addEventListener("click", () => {
  if (!lastManifest) return;
  downloadBlob(`${lastBaseName}.manifest.json`, JSON.stringify(lastManifest, null, 2) + "\n", "application/json");
});
dlOpenapi.addEventListener("click", () => {
  if (!lastOpenapi) return;
  downloadBlob(`${lastBaseName}.openapi.json`, lastOpenapi, "application/json");
});

for (const r of directionRadios) {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    direction = r.value as Direction;
    applyDirectionLabels();
    loadSampleForDirection();
    void convert();
  });
}

applyDirectionLabels();
loadSampleForDirection();
void convert();
