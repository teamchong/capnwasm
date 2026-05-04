// Capnweb chat pane. Mirrors capnwasm-pane but in capnweb's RPC
// shape (JSON wire, RpcTarget on both sides).
//
//   "ws"   – /capnweb-chat-ws   : subscribe(callback) + post()
//   "rest" – /capnweb-chat-http : poll getMessagesSince(cursor) + post()

import { newWebSocketRpcSession, newHttpBatchRpcSession, RpcTarget } from "capnweb";

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
  /** Estimated wire bytes for this message via capnweb's JSON
   *  serialization. Computed as a pretty-close approximation:
   *  JSON-stringify with the image bytes counted at base64 cost
   *  (image.length * 4/3 + framing), plus the JSON envelope.
   *  Capnweb's actual on-wire framing has small overhead beyond
   *  this; the badge is for showing scale, not exact accounting. */
  wireBytes?: number;
}

const POLL_INTERVAL_MS = 500;

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

/** capnweb may hand us either Uint8Array (workerd) or a plain object
 *  with a typed-array buffer attached (Node), depending on runtime
 *  version. Normalize. */
function asUint8(value: unknown): Uint8Array | undefined {
  if (!value) return undefined;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value as any)) {
    const v = value as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return undefined;
}

function estimateCapnwebWire(m: Msg): number {
  // Capnweb's frame for an `onMessage(m)` call is roughly:
  //   [tag, [m]]  with m serialized as JSON-shaped tokens.
  // The image bytes are sent base64-style — about 4/3 the raw size —
  // wrapped in a string in the JSON. Plus the small per-field keys.
  const imageBase64Cost = m.image ? Math.ceil(m.image.length * 4 / 3) : 0;
  const textCost = (m.author?.length ?? 0) + (m.text?.length ?? 0);
  const framing = 64;  // brackets, commas, quotes, key names
  return imageBase64Cost + textCost + framing;
}

class CapnwebSubscriber extends RpcTarget {
  private cb: (m: Msg) => void;
  constructor(cb: (m: Msg) => void) { super(); this.cb = cb; }
  onMessage(m: any) {
    const image = asUint8(m.image);
    const norm: Msg = {
      id: Number(m.id),
      author: m.author,
      text: m.text,
      ts: Number(m.ts),
      image,
    };
    norm.wireBytes = estimateCapnwebWire(norm);
    this.cb(norm);
  }
}

export async function setupCapnwebPane(opts: ChatPaneOptions): Promise<ChatPaneHandle> {
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

  const inner = mode === "ws"
    ? await setupWs({ statusEl, render, setStatusBase: (s) => { statusBase = s; } })
    : await setupRest({ statusEl, render, setStatusBase: (s) => { statusBase = s; } });
  return {
    post: inner.post,
    destroy() {
      inner.destroy();
      for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
    },
  };
}

async function setupWs(args: {
  statusEl: HTMLElement; render: (m: Msg) => void; setStatusBase: (s: string) => void;
}): Promise<ChatPaneHandle> {
  const { statusEl, render, setStatusBase } = args;
  const wsHost = location.hostname === "localhost"
    ? `127.0.0.1${location.port ? `:${location.port}` : ""}`
    : location.host;
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + wsHost + "/capnweb-chat-ws";
  const main: any = newWebSocketRpcSession(wsUrl);

  const subscriber = new CapnwebSubscriber(render);
  try {
    await main.subscribe(subscriber);
    setStatusBase("WebSocket connected");
    statusEl.textContent = "WebSocket connected · 0 received";
    statusEl.classList.add("connected");
  } catch (err) {
    statusEl.textContent = "WS disconnected: " + (err instanceof Error ? err.message : String(err));
    statusEl.classList.remove("connected");
    statusEl.classList.add("error");
  }

  return {
    async post(author, text) { await main.post(author, text); },
    destroy() {
      try { (main[Symbol.dispose] as () => void)?.(); } catch {}
    },
  };
}

async function setupRest(args: {
  statusEl: HTMLElement; render: (m: Msg) => void; setStatusBase: (s: string) => void;
}): Promise<ChatPaneHandle> {
  const { statusEl, render, setStatusBase } = args;
  const httpUrl = location.origin + "/capnweb-chat-http";

  let cursor = 0;
  let alive = true;
  let timer: number | null = null;

  // capnweb http-batch is single-shot: each call opens a fresh session,
  // sends one frame, gets one back. So the poll uses a new session per
  // tick. Same for post().

  async function pollOnce() {
    try {
      const main: any = newHttpBatchRpcSession(httpUrl);
      const items: any[] = await main.getMessagesSince(cursor);
      for (const raw of items) {
        const image = asUint8(raw.image);
        const m: Msg = {
          id: Number(raw.id),
          author: raw.author,
          text: raw.text,
          ts: Number(raw.ts),
          image,
        };
        m.wireBytes = estimateCapnwebWire(m);
        render(m);
        if (m.id > cursor) cursor = m.id;
      }
    } catch (err) {
      if (!alive) return;
      statusEl.textContent = "REST poll failed: " + (err instanceof Error ? err.message : String(err));
      statusEl.classList.remove("connected");
      statusEl.classList.add("error");
    }
  }

  await pollOnce();
  const restStatus = "REST polling (every " + POLL_INTERVAL_MS + " ms)";
  setStatusBase(restStatus);
  statusEl.textContent = `${restStatus} · 0 received`;
  statusEl.classList.add("connected");

  function schedule() {
    if (!alive) return;
    timer = window.setTimeout(async () => { await pollOnce(); schedule(); }, POLL_INTERVAL_MS);
  }
  schedule();

  return {
    async post(author, text) {
      const main: any = newHttpBatchRpcSession(httpUrl);
      await main.post(author, text);
    },
    destroy() {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    },
  };
}
