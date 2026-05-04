// Generated-reader syntax explorer. No eval: each tab shows a TypeScript
// snippet and runs the matching preset against real capnp bytes.

// @ts-ignore — runtime imports from the parent capnwasm package.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated playground schema.
import { buildUser, openUser } from "../playground/users.capnp.gen.mjs";
import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import capnpLang from "highlight.js/lib/languages/protobuf";
import jsonLang from "highlight.js/lib/languages/json";
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("typescript", typescriptLang);
hljs.registerLanguage("capnp", capnpLang);
hljs.registerLanguage("json", jsonLang);

const source = document.getElementById("source")!;
const output = document.getElementById("output")!;
const statusEl = document.getElementById("status")!;
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tabs button"));

const SCHEMA = `struct User {
  id         @0 :UInt64;
  name       @1 :Text;
  email      @2 :Text;
  joinedAtMs @3 :UInt64;
  active     @4 :Bool;
  avatar     @5 :Data;
}`;

const seed = {
  id: 42n,
  name: "Ada Browser",
  email: "ada@example.com",
  joinedAtMs: 1700000000000n,
  active: true,
  avatar: new Uint8Array([1, 1, 2, 3, 5, 8, 13, 21]),
};

type Tab = "draft" | "getters" | "object" | "builder" | "schema";

const snippets: Record<Tab, string> = {
  draft: `// Batched sparse read. Good for render paths.
const user = openUser(cpp, bytes);

const card = user.draft(u => ({
  id: u.id,
  title: u.name,
  enabled: u.active,
}));`,
  getters: `// Direct getters. Best for one-off access.
const user = openUser(cpp, bytes);

const label = \`${'${user.id}'} · ${'${user.name}'}\`;
const avatarBytes = user.avatar.length;`,
  object: `// Materialize the whole struct.
const user = openUser(cpp, bytes);

const obj = user.toObject();`,
  builder: `// Edit/build by writing through a generated Builder.
const edited = UserBuilder.from(cpp, {
  ...seed,
  name: "Edited Ada",
  active: false,
}).toBytes();

const reread = openUser(cpp, edited).draft(u => ({
  name: u.name,
  active: u.active,
}));`,
  schema: SCHEMA,
};

let active: Tab = "draft";
let cppPromise: Promise<any> | null = null;
const initialTab = (localStorage.getItem("capnwasm-editor-tab") as Tab | null) || active;

async function cpp() {
  return (cppPromise ??= load(new URL("/capnp.slim.wasm", location.origin)));
}

function stringify(value: unknown) {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return `${v}n`;
    if (v instanceof Uint8Array) return `Uint8Array(${v.length}) [${Array.from(v).join(", ")}]`;
    return v;
  }, 2);
}

async function sampleBytes(c: any) {
  return buildUser(c).fromObject(seed).toBytes();
}

function highlightInto(el: HTMLElement, code: string, language: string) {
  // hljs.highlightElement is a no-op once data-highlighted is set, and it
  // also leaves residual <span> children behind from a previous pass. Reset
  // both so every tab switch re-highlights cleanly.
  el.removeAttribute("data-highlighted");
  el.textContent = code;
  el.className = `language-${language}`;
  hljs.highlightElement(el);
}

async function run(tab: Tab) {
  highlightInto(source as HTMLElement, snippets[tab], tab === "schema" ? "capnp" : "typescript");
  if (tab === "schema") {
    highlightInto(output as HTMLElement, SCHEMA, "capnp");
    statusEl.className = "status";
    statusEl.textContent = "Generated reader/builder target schema.";
    return;
  }
  try {
    const c = await cpp();
    const bytes = await sampleBytes(c);
    const user = openUser(c, bytes);
    let result: unknown;
    if (tab === "draft") {
      result = user.draft((u: any) => ({ id: u.id, title: u.name, enabled: u.active }));
    } else if (tab === "getters") {
      result = { label: `${user.id} · ${user.name}`, avatarBytes: user.avatar.length };
    } else if (tab === "object") {
      result = user.toObject();
    } else {
      const edited = buildUser(c).fromObject({ ...seed, name: "Edited Ada", active: false }).toBytes();
      result = openUser(c, edited).draft((u: any) => ({ name: u.name, active: u.active }));
    }
    highlightInto(output as HTMLElement, stringify(result), "json");
    statusEl.className = "status";
    statusEl.textContent = `Ran ${tab} example against ${bytes.length} Cap'n Proto bytes.`;
  } catch (err) {
    statusEl.className = "status error";
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    active = (tab.dataset.tab || "draft") as Tab;
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    localStorage.setItem("capnwasm-editor-tab", active);
    void run(active);
  });
  if (tab.dataset.tab === initialTab) {
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
  }
}

active = initialTab;
void run(active);
