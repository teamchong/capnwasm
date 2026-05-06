// Multi-language chatroom over Cap'n Proto.
//
// On page load, N agents pick random names + random languages from the
// pool. A user message goes through capnwasm wire format on the way to
// each agent, each agent decodes it through its own language's runtime
// and produces a reply (in that language's idiom), the reply is encoded
// back through capnwasm and rendered as a bubble. After all agents
// reply, one random agent chimes in on a different agent's reply
// (one-hop cross-talk so the room feels alive without runaway loops).
//
// The capnwasm envelope is the same shape every agent sees:
//   { speaker :Text; body :Text; replyTo :Text; }
// Language doesn't matter for interop — the wire format is the lingua
// franca. That's the OpenAPI / capnwasm pitch made literal here.

// @ts-ignore — runtime modules without bundled .d.ts.
import { prepareEnvelope, decodeEnvelope, formatStats } from "./runtime-capnwasm.js";

// ---- Agents ----------------------------------------------------------

type Lang = "js" | "python" | "ruby" | "go" | "java";

const LANG_POOL: Lang[] = ["js", "python", "ruby", "go", "java"];

const NAMES = [
  "Alice", "Bob", "Carol", "Dave", "Eve", "Frank",
  "Grace", "Heidi", "Ivan", "Judy", "Mallory", "Niaj",
  "Olivia", "Peggy", "Rupert", "Sybil", "Trent", "Victor",
];

interface Agent {
  id: string;
  name: string;
  lang: Lang;
}

let agents: Agent[] = [];

function rollAgents(count = 4): Agent[] {
  const names = pickN(NAMES, count);
  return names.map((name, i) => ({
    id:   `a${i}_${name.toLowerCase()}`,
    name,
    lang: LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)],
  }));
}

function pickN<T>(pool: T[], n: number): T[] {
  const copy = pool.slice();
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// ---- DOM -------------------------------------------------------------

const $  = <T extends Element>(s: string) => document.querySelector(s) as T;
const els = {
  thread:    $<HTMLElement>("#chat-thread"),
  empty:     $<HTMLElement>("#chat-empty"),
  form:      $<HTMLFormElement>("#chat-form"),
  input:     $<HTMLInputElement>("#chat-input"),
  send:      $<HTMLButtonElement>("#chat-send"),
  rosterEl:  $<HTMLUListElement>("#roster-list"),
  shuffle:   $<HTMLButtonElement>("#roster-shuffle"),
  wireStats: $<HTMLElement>("#wire-stats"),
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!),
  );
}

function renderRoster(): void {
  const frag = document.createDocumentFragment();
  for (const a of agents) {
    const li = document.createElement("li");
    li.className = "roster-row";
    li.innerHTML = `
      <span class="roster-name">${escapeHtml(a.name)}</span>
      <span class="roster-lang lang-${a.lang}">${a.lang}</span>
    `;
    frag.appendChild(li);
  }
  els.rosterEl.replaceChildren(frag);
}

// ---- Wire ------------------------------------------------------------
//
// Every chat message — user-authored or agent-authored — is encoded
// through capnwasm into a small envelope before reaching any other
// participant. Each agent decodes the same wire bytes via its own
// language's capnwasm-bridged runtime.

interface WireOutcome {
  encoded: Uint8Array;
  bytesIn: number;     // JSON-equivalent for the same payload
  bytesOut: number;    // capnwasm-encoded bytes
  encodeMs: number;
  decodeMs: number;
}

async function shipOverWire(speaker: string, body: string, replyTo: string): Promise<WireOutcome> {
  // capnwasm encode (host side; the per-language decode happens inside
  // each agent's runtime call below).
  const out = await prepareEnvelope({ speaker, body, replyTo });
  return {
    encoded:   out.bytes,
    bytesIn:   out.stats.jsonBytes,
    bytesOut:  out.stats.capnpBytes,
    encodeMs:  out.stats.encodeMs,
    decodeMs:  out.stats.decodeMs,
  };
}

// ---- Per-language reply ---------------------------------------------
//
// Each language has a fixed bot script. Given (name, body) the script
// returns a reply string in its language's idiom. The host-side adapter
// loads the runtime once, registers the bot, and exposes `reply()`.
//
// JS is in this file. Python / Ruby / Go land in runtime-{lang}.ts and
// are imported lazily on first use of that language.

async function callLangBot(lang: Lang, speaker: string, body: string): Promise<string> {
  // Round-trip through the language's Worker route. Both halves of
  // the trip are Cap'n Proto wire bytes encoded via capnwasm —
  // browser encodes the request envelope here, sends, the Worker
  // decodes and re-encodes the reply envelope, we decode it again
  // on this side. Same schema both ways.
  const requestEnv = await prepareEnvelope({ speaker, body, replyTo: "" });
  const res = await fetch(`/chat/${lang}`, {
    method: "POST",
    headers: { "content-type": "application/capnp" },
    body: requestEnv.bytes,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`/chat/${lang} ${res.status}: ${detail.slice(0, 200)}`);
  }
  const respBytes = new Uint8Array(await res.arrayBuffer());
  const reader = await decodeEnvelope(respBytes);
  // The Worker stamps speaker as "<lang>-bot"; we discard that and let
  // the page-side rendering attribute the bubble to the actual agent.
  const replyText = reader.body ?? "";
  return replyText;
}

// ---- Turn dispatch ---------------------------------------------------

function appendUserMsg(body: string): HTMLElement {
  const turn = document.createElement("div");
  turn.className = "chat-turn";
  const msg = document.createElement("div");
  msg.className = "chat-msg from-user";
  msg.textContent = body;
  turn.appendChild(msg);
  els.thread.appendChild(turn);
  els.empty.style.display = "none";
  els.thread.scrollTop = els.thread.scrollHeight;
  return turn;
}

function appendAgentBubble(turn: HTMLElement, agent: Agent, replyTo?: { name: string; lang: Lang }): HTMLElement {
  const msg = document.createElement("div");
  msg.className = `chat-msg from-agent lang-${agent.lang} pending`;
  const tag = document.createElement("span");
  tag.className = "agent-tag";
  tag.textContent = replyTo
    ? `${agent.name} · ${agent.lang} → ${replyTo.name} (${replyTo.lang})`
    : `${agent.name} · ${agent.lang}`;
  const body = document.createElement("span");
  body.className = "body";
  body.textContent = "thinking…";
  const meta = document.createElement("span");
  meta.className = "meta";
  msg.append(tag, document.createElement("br"), body, meta);
  turn.appendChild(msg);
  els.thread.scrollTop = els.thread.scrollHeight;
  return msg;
}

function fillBubble(bubble: HTMLElement, text: string, wire: WireOutcome): void {
  bubble.classList.remove("pending");
  const body = bubble.querySelector(".body")!;
  body.textContent = text;
  const meta = bubble.querySelector(".meta")!;
  meta.textContent = `wire ${wire.bytesOut} B (capnp) · ${wire.bytesIn} B (json) · encode ${wire.encodeMs.toFixed(2)} ms · decode ${wire.decodeMs.toFixed(2)} ms`;
  els.thread.scrollTop = els.thread.scrollHeight;
}

function fillBubbleError(bubble: HTMLElement, err: unknown): void {
  bubble.classList.remove("pending");
  bubble.classList.add("error");
  const body = bubble.querySelector(".body")!;
  body.textContent = err instanceof Error ? err.message : String(err);
}

let lastWire: WireOutcome | null = null;
function showWireStats(): void {
  if (!lastWire) return;
  els.wireStats.textContent =
    `last wire — capnp ${lastWire.bytesOut} B vs json ${lastWire.bytesIn} B · ` +
    `encode ${lastWire.encodeMs.toFixed(2)} ms · decode ${lastWire.decodeMs.toFixed(2)} ms`;
}

async function handleSubmit(ev: Event): Promise<void> {
  ev.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  els.send.disabled = true;
  try {
    const turn = appendUserMsg(text);
    // Encode the user message via capnwasm; record the wire stats so
    // the chat shows the round-trip cost.
    const userWire = await shipOverWire("user", text, "");
    lastWire = userWire;
    showWireStats();

    // Phase 1: every agent replies to the user.
    const bubbles = agents.map((a) => ({ agent: a, bubble: appendAgentBubble(turn, a) }));
    const replies = await Promise.allSettled(
      bubbles.map(async ({ agent }) => {
        const reply = await callLangBot(agent.lang, agent.name, text);
        const wire = await shipOverWire(agent.name, reply, "user");
        return { reply, wire };
      }),
    );
    for (let i = 0; i < bubbles.length; i++) {
      const r = replies[i];
      if (r.status === "fulfilled") {
        fillBubble(bubbles[i].bubble, r.value.reply, r.value.wire);
        lastWire = r.value.wire;
      } else {
        fillBubbleError(bubbles[i].bubble, r.reason);
      }
    }
    showWireStats();

    // Phase 2: one random agent chimes in on a different agent's
    // successful reply (one-hop cross-talk so the room feels alive).
    const goodReplies = replies
      .map((r, i) => ({ r, agent: bubbles[i].agent }))
      .filter((x) => x.r.status === "fulfilled") as Array<{ r: PromiseFulfilledResult<{ reply: string; wire: WireOutcome }>; agent: Agent }>;
    if (goodReplies.length >= 2) {
      const targetIdx = Math.floor(Math.random() * goodReplies.length);
      const target = goodReplies[targetIdx];
      const otherAgents = agents.filter((a) => a.id !== target.agent.id);
      if (otherAgents.length > 0) {
        const speaker = otherAgents[Math.floor(Math.random() * otherAgents.length)];
        const bubble = appendAgentBubble(turn, speaker, { name: target.agent.name, lang: target.agent.lang });
        try {
          const reply = await callLangBot(speaker.lang, speaker.name, target.r.value.reply);
          const wire = await shipOverWire(speaker.name, reply, target.agent.name);
          fillBubble(bubble, reply, wire);
          lastWire = wire;
          showWireStats();
        } catch (err) {
          fillBubbleError(bubble, err);
        }
      }
    }
  } finally {
    els.send.disabled = false;
    els.input.focus();
  }
}

// ---- Boot ------------------------------------------------------------

agents = rollAgents(4);
renderRoster();
els.form.addEventListener("submit", (e) => { void handleSubmit(e); });
els.shuffle.addEventListener("click", () => {
  agents = rollAgents(4);
  renderRoster();
});
els.input.focus();
