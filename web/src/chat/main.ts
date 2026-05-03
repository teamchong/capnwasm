// Live chat demo wiring up the three high-level helpers from
// capnwasm/client. The actual chat logic is intentionally short — the
// point is to show that createClient + subscribeQuery + optimistic make
// the top-level shape of an RPC client app fit on a single screen.
//
// Wire format here is plain JSON over the stream for readability; the
// helpers don't care. A production deployment would use a Cap'n Proto
// schema for `Message` and `PostParams` and skip the JSON encode/decode.

import { load } from "../../../js/browser.mjs";
// connectWebSocket and subscribeQuery imports are intentionally written
// against the source files — when this is published the same code paths
// resolve through the published `capnwasm/client` entry. The dev server
// vite config maps `../../../js/...` so devs can hack on both at once.
import { connectWebSocket } from "../../../js/rpc.mjs";
import { subscribeQuery, optimistic } from "../../../js/client.mjs";

// Chat-specific RPC IDs. In a typed deployment the codegen output would
// expose these as named constants.
const CHAT_IFC      = 0xc4a7c4a7c4a7c4a7n;
const M_POST        = 0;   // post a new message; params = JSON({author, text}); returns nothing useful
const M_SUBSCRIBE   = 1;   // server-driven stream of all messages, oldest first

// 1-segment empty Cap'n Proto frame — used as the unit value when the
// method takes no params (all of our subscribeMessages calls).
const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const $ = (id: string) => document.getElementById(id)!;
const log    = $("log");
const status = $("status");
const form   = $("form") as HTMLFormElement;
const inputAuthor = $("author") as HTMLInputElement;
const inputText   = $("text")   as HTMLInputElement;
const button = $("send")  as HTMLButtonElement;

inputAuthor.value = localStorage.getItem("chat-author") || `guest-${Math.floor(Math.random() * 1000)}`;
inputAuthor.addEventListener("change", () => localStorage.setItem("chat-author", inputAuthor.value));

interface Msg { id: number; author: string; text: string; ts: number; }

// Track local pending entries so the stream's authoritative copy can
// replace them when it arrives. Keyed by client-generated UUID; the
// server doesn't know that key, so we match on (author, text) for the
// first-seen pair after each post.
const pending = new Map<string, HTMLElement>();
const seenIds = new Set<number>();

function escape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderConfirmed(m: Msg) {
  if (seenIds.has(m.id)) return;
  seenIds.add(m.id);

  // If a pending entry matches this server message (same author + text),
  // replace it in place. Otherwise append.
  for (const [key, el] of pending) {
    if (el.dataset.author === m.author && el.dataset.text === m.text) {
      el.classList.remove("pending");
      el.dataset.confirmed = "1";
      pending.delete(key);
      return;
    }
  }

  const el = document.createElement("div");
  el.className = "msg";
  el.innerHTML = `<span class="who">${escape(m.author)}:</span><span class="text">${escape(m.text)}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function renderPending(author: string, text: string): { key: string; el: HTMLElement } {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const el = document.createElement("div");
  el.className = "msg pending";
  el.dataset.author = author;
  el.dataset.text = text;
  el.innerHTML = `<span class="who">${escape(author)}:</span><span class="text">${escape(text)}</span>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  pending.set(key, el);
  return { key, el };
}

function markFailed(key: string, error: unknown) {
  const el = pending.get(key);
  if (!el) return;
  el.classList.remove("pending");
  el.classList.add("failed");
  const errSpan = document.createElement("span");
  errSpan.style.marginLeft = "0.5em";
  errSpan.style.fontSize = "0.85em";
  errSpan.textContent = `(failed: ${error instanceof Error ? error.message : String(error)})`;
  el.appendChild(errSpan);
  pending.delete(key);
}

async function main() {
  status.textContent = "Loading runtime…";

  // The bench server uses a single WS path that switches on subprotocol;
  // capnwasm/client's createClient works against any URL but here the
  // chat is gated to /chat-ws (the /chat path is the static HTML page).
  // We hand-wire the steps so we can use the
  // browser-friendly `load()` from capnwasm/browser instead of the
  // base64-inlined runtime that createClient uses by default.
  const cpp = await load();
  const wsHost = location.hostname === "localhost"
    ? `127.0.0.1${location.port ? `:${location.port}` : ""}`
    : location.host;
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + wsHost + "/chat-ws";
  const session = await connectWebSocket(cpp, wsUrl);
  const cap = session.bootstrap();

  status.textContent = "Connected";
  status.classList.add("connected");

  // Subscribe — the server yields every existing message first, then
  // continues streaming new ones as they post. The for-await loop never
  // terminates under normal operation; the page unloading cleans up.
  const sub = subscribeQuery(cap, CHAT_IFC, M_SUBSCRIBE, EMPTY);
  (async () => {
    try {
      for await (const chunk of sub.updates) {
        const m = JSON.parse(decoder.decode(chunk)) as Msg;
        renderConfirmed(m);
      }
    } catch (e) {
      status.textContent = "Disconnected: " + (e instanceof Error ? e.message : String(e));
      status.classList.remove("connected");
      status.classList.add("error");
      button.disabled = true;
    }
  })();

  // Send — apply locally, send to server, revert on failure. The server's
  // authoritative copy will replace our local entry when the stream chunk
  // for this message arrives (within milliseconds).
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const author = inputAuthor.value.trim() || "anon";
    const text = inputText.value.trim();
    if (!text) return;
    inputText.value = "";

    let pendingKey: string;
    try {
      await optimistic({
        apply: () => { pendingKey = renderPending(author, text).key; },
        send: () => cap.call(CHAT_IFC, M_POST, encoder.encode(JSON.stringify({ author, text }))).promise,
        revert: () => { markFailed(pendingKey, "send failed"); },
      });
    } catch (err) {
      markFailed(pendingKey!, err);
    }
  });

  // Tear down cleanly on page unload so the server-side stream handler
  // doesn't keep iterating for a phantom client.
  window.addEventListener("beforeunload", () => {
    sub.unsubscribe();
    session.close();
  });
}

main().catch((err) => {
  status.textContent = "Failed to load: " + (err instanceof Error ? err.message : String(err));
  status.classList.add("error");
});
