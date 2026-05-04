// Runtime-schema demo: no generated reader/builder for this page.
// Defines the Worker's User wire shape as JS data, builds bytes,
// dynamically picks fields, and round-trips through /api/echo.

// @ts-ignore — runtime imports from the parent capnwasm package.
import { load } from "../../../js/browser.mjs";
// @ts-ignore — dynamic runtime has no local .d.ts in this workspace.
import { defineSchema, buildDynamic, openDynamic } from "../../../js/dynamic.mjs";
import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("typescript", typescriptLang);
const codeBlock = document.getElementById("dynamic-code-block");
if (codeBlock) hljs.highlightElement(codeBlock as HTMLElement);

const statusEl = document.getElementById("status")!;
const resultEl = document.getElementById("result")!;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function row(k: string, v: unknown): string {
  return `<dt>${k}</dt><dd>${String(v)}</dd>`;
}

const User = defineSchema({
  id:         { kind: "uint64", offset: 0 },
  name:       { kind: "text",   slot: 0 },
  email:      { kind: "text",   slot: 1 },
  joinedAtMs: { kind: "uint64", offset: 8 },
  active:     { kind: "bool",   bitOffset: 128 },
  avatar:     { kind: "data",   slot: 2 },
}, { dataWords: 3, ptrWords: 3 });

try {
  const cpp = await load();
  const avatar = new Uint8Array(16);
  for (let i = 0; i < avatar.length; i++) avatar[i] = (i * 17) & 0xff;

  const source = {
    id: 42n,
    name: "Dynamic Ada",
    email: "dynamic@example.com",
    joinedAtMs: BigInt(Date.UTC(2026, 4, 3)),
    active: true,
    avatar,
  };

  const built = buildDynamic(cpp, User).fromObject(source).finalize();
  const reader = openDynamic(cpp, User, built);
  const picked = reader.pick(["id", "name", "active"]);

  const echoRes = await fetch("/api/echo", {
    method: "POST",
    headers: { "content-type": "application/capnp" },
    body: built,
  });
  if (!echoRes.ok) throw new Error(`/api/echo failed: HTTP ${echoRes.status}`);
  const echoed = new Uint8Array(await echoRes.arrayBuffer());
  const roundTrip = openDynamic(cpp, User, echoed).toObject();

  statusEl.textContent = "Dynamic schema round-trip succeeded.";
  statusEl.className = "status-line ok";
  resultEl.innerHTML = [
    row("encoded bytes", fmtBytes(built.length)),
    row("picked id", picked.id),
    row("picked name", picked.name),
    row("picked active", picked.active),
    row("Worker echoed bytes", fmtBytes(echoed.length)),
    row("round-trip email", roundTrip.email),
    row("round-trip avatar", `${roundTrip.avatar.length} raw bytes`),
  ].join("");
} catch (err) {
  statusEl.textContent = err instanceof Error ? err.message : String(err);
  statusEl.className = "status-line error";
}
