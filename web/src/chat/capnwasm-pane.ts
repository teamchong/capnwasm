// Capnwasm chat pane. Supports two transports backed by the same DO:
//
//   "ws"   – /chat-ws         : subscribe stream + post()
//   "rest" – /chat-http       : poll getMessagesSince(cursor) + post()
//
// Both directions are real Cap'n Proto: PostParams in, ChatMessage(s)
// out (one frame per chunk in WS mode; a ChatMessageList per poll in
// REST mode). No JSON in the chat path.
//
// Each pane is stateful for one transport mode. Toggling modes is
// handled by the orchestrator, which destroys + recreates the pane.

import { load } from "../../../js/browser.mjs";
// @ts-ignore — generated chat schema (vite plugin emits this from web/chat.capnp).
import {
  PostParamsBuilder,
  GetSinceParamsBuilder,
  ChatMessageListReader,
  openChatMessage,
} from "./chat.capnp.gen.mjs";
import { connectWebSocket } from "../../../js/rpc.mjs";
import { connectHttpBatch } from "../../../js/http_batch.mjs";
import { subscribeQuery } from "../../../js/client.mjs";

const CHAT_IFC      = 0xc4a7c4a7c4a7c4a7n;
const M_POST        = 0;
const M_SUBSCRIBE   = 1;
const M_GET_SINCE   = 2;

const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();

const POLL_INTERVAL_MS = 500;

export type ChatTransport = "ws" | "rest";

export interface ChatPaneOptions {
  logEl: HTMLElement;
  statusEl: HTMLElement;
  mode: ChatTransport;
}

export interface ChatPaneHandle {
  post(author: string, text: string): Promise<void>;
  destroy(): void;
}

interface Msg {
  id: number;
  author: string;
  text: string;
  ts: number;
  image?: Uint8Array;
  /** bytes-on-wire for this message (capnwasm side: the framed
   *  ChatMessage chunk size). Surfaced as a per-message badge so the
   *  binary-vs-JSON cost is visible without prose. */
  wireBytes?: number;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function imageObjectUrl(bytes: Uint8Array | undefined, urls: string[]): string {
  if (!bytes || bytes.length === 0) return "";
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  urls.push(url);
  return url;
}

export async function setupCapnwasmPane(opts: ChatPaneOptions): Promise<ChatPaneHandle> {
  const { logEl, statusEl, mode } = opts;
  logEl.textContent = "";

  const seenIds = new Set<number>();
  const objectUrls: string[] = [];
  let received = 0;
  let statusBase = mode === "ws" ? "WebSocket connected" : "REST polling";

  function render(m: Msg) {
    if (seenIds.has(m.id)) return;
    seenIds.add(m.id);
    received++;
    const el = document.createElement("div");
    el.className = "msg";
    const image = m.image && m.image.length > 0
      ? `<img class="server-image" src="${imageObjectUrl(m.image, objectUrls)}" alt="server-rendered PNG response for this message" />`
      : `<span class="missing-image">missing server PNG bytes</span>`;
    const size = m.wireBytes != null ? `<span class="size">${formatBytes(m.wireBytes)}</span>` : "";
    el.innerHTML = `
      <div class="user-message"><span class="who">${escape(m.author)}</span><span class="text">${escape(m.text)}</span></div>
      <div class="server-response"><div class="server-label">server PNG ${size}</div>${image}</div>
    `;
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
    if (statusEl.classList.contains("connected")) {
      statusEl.textContent = `${statusBase} · ${received} received`;
    }
  }

  statusEl.textContent = mode === "ws" ? "Connecting (WebSocket)…" : "Polling (REST)…";
  statusEl.classList.remove("connected", "error");

  const cpp = await load();

  const inner = mode === "ws"
    ? await setupWs({ logEl, statusEl, cpp, render, setStatusBase: (s) => { statusBase = s; } })
    : await setupRest({ logEl, statusEl, cpp, render, setStatusBase: (s) => { statusBase = s; } });
  return {
    post: inner.post,
    destroy() {
      inner.destroy();
      for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
    },
  };
}

// ------------------------------- WebSocket ---------------------------------

async function setupWs(args: {
  logEl: HTMLElement; statusEl: HTMLElement; cpp: any; render: (m: Msg) => void; setStatusBase: (s: string) => void;
}): Promise<ChatPaneHandle> {
  const { statusEl, cpp, render, setStatusBase } = args;
  const wsHost = location.host;
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + wsHost + "/chat-ws";
  const session = await connectWebSocket(cpp, wsUrl);
  const cap = session.bootstrap();

  setStatusBase("WebSocket connected");
  statusEl.textContent = `WebSocket connected · 0 received`;
  statusEl.classList.add("connected");

  const sub = subscribeQuery(cap, CHAT_IFC, M_SUBSCRIBE, EMPTY);
  let alive = true;
  (async () => {
    try {
      for await (const chunk of sub.updates) {
        if (!alive) break;
        const r = openChatMessage(cpp, chunk);
        // r.image returns a Uint8Array view INTO wasm memory; copy it
        // into a JS-owned buffer because the next chunk's decode will
        // overwrite the same scratch.
        const imageView = r.image as Uint8Array | undefined;
        const image = imageView && imageView.length > 0 ? new Uint8Array(imageView) : undefined;
        render({
          id: Number(r.id),
          author: r.author,
          text: r.text,
          ts: Number(r.ts),
          image,
          wireBytes: chunk.length,
        });
      }
    } catch (e) {
      if (!alive) return;
      statusEl.textContent = "WS disconnected: " + (e instanceof Error ? e.message : String(e));
      statusEl.classList.remove("connected");
      statusEl.classList.add("error");
    }
  })();

  return {
    async post(author, text) {
      const r = cap.callBuilder(CHAT_IFC, M_POST, PostParamsBuilder);
      r.params.author = author;
      r.params.text = text;
      await r.send().promise;
    },
    destroy() {
      alive = false;
      try { sub.unsubscribe(); } catch {}
      try { session.close(); } catch {}
    },
  };
}

// ----------------------------------- REST ----------------------------------

async function setupRest(args: {
  logEl: HTMLElement; statusEl: HTMLElement; cpp: any; render: (m: Msg) => void; setStatusBase: (s: string) => void;
}): Promise<ChatPaneHandle> {
  const { statusEl, cpp, render, setStatusBase } = args;
  const httpUrl = location.origin + "/chat-http";
  const session = connectHttpBatch(cpp, httpUrl);
  const cap = session.bootstrap();

  const restStatus = "REST polling (every " + POLL_INTERVAL_MS + " ms)";
  setStatusBase(restStatus);
  statusEl.textContent = `${restStatus} · 0 received`;
  statusEl.classList.add("connected");

  let cursor = 0;
  let alive = true;

  async function pollOnce() {
    const r = cap.callBuilder(CHAT_IFC, M_GET_SINCE, GetSinceParamsBuilder);
    r.params.since = BigInt(cursor);
    try {
      await r.send({
        resultsReader: ChatMessageListReader,
        extract: (rdr: any) => {
          const items = rdr.items;
          for (let i = 0; i < items.length; i++) {
            const m = items.at(i);
            const id = Number(m.id);
            const imageView = m.image as Uint8Array | undefined;
            const image = imageView && imageView.length > 0 ? new Uint8Array(imageView) : undefined;
            // REST poll bundles many messages per response; for the
            // wire-size badge we approximate per-message cost as the
            // reader's slice into the response (header + author/text +
            // image bytes ≈ 4.2 KB at our identicon size).
            const wireBytes = (image?.length ?? 0) + (m.author?.length ?? 0) + (m.text?.length ?? 0) + 32;
            render({ id, author: m.author, text: m.text, ts: Number(m.ts), image, wireBytes });
            if (id > cursor) cursor = id;
          }
          return null;
        },
      }).promise;
    } catch (e) {
      if (!alive) return;
      statusEl.textContent = "REST poll failed: " + (e instanceof Error ? e.message : String(e));
      statusEl.classList.remove("connected");
      statusEl.classList.add("error");
    }
  }

  // Kick off the first poll immediately (no delay until the first
  // history is on screen) and then continue on a fixed cadence.
  await pollOnce();
  let timer: number | null = null;
  function schedule() {
    if (!alive) return;
    timer = window.setTimeout(async () => { await pollOnce(); schedule(); }, POLL_INTERVAL_MS);
  }
  schedule();

  return {
    async post(author, text) {
      const r = cap.callBuilder(CHAT_IFC, M_POST, PostParamsBuilder);
      r.params.author = author;
      r.params.text = text;
      await r.send().promise;
    },
    destroy() {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
      try { session.close(); } catch {}
    },
  };
}
