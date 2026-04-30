// Vite plugin that mounts the playground's RPC server onto Vite's own
// HTTP server. Two attach points:
//
//   configureServer        — `vite dev`. RPC endpoints sit alongside
//                            HMR on the same port.
//   configurePreviewServer — `vite preview`. Same endpoints attached
//                            to the static-file server, so the same
//                            `npm run preview` produces a working
//                            production-shaped bench without anyone
//                            running a second process.
//
// Implementation: attach our own WebSocketServer in `noServer` mode to
// the underlying http.Server's `upgrade` event. Vite has its own HMR
// WebSocket; we only handle paths starting with /capnwasm or /capnweb
// and let Vite handle everything else.

import { WebSocketServer } from "ws";
import { load as loadWasm } from "../dist/inlined.mjs";
import { RpcSession, InterfaceRegistry, wsTransport } from "../js/rpc.mjs";
import { PrimitivesBuilder, PrimitivesReader } from "../js/conformance_schema.gen.mjs";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";

const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8     = 0;
const M_ECHO_TEXT   = 1;
const M_ECHO_BINARY = 2;
const M_GET_CHILD   = 3;

// Chat IFC — used by web/chat.html. Constants must agree with web/src/chat/main.ts.
const CHAT_IFC      = 0xc4a7c4a7c4a7c4a7n;
const CHAT_M_POST   = 0;
const CHAT_M_SUBSCR = 1;

// In-memory chat state, shared across every client connection on this
// dev server. One ring buffer of recent messages plus a Set of waiter
// callbacks parked on "next post". When a post lands the snapshot of
// listeners fires; each one immediately re-arms by waiting on a fresh
// promise via nextChatMessage(). Production would back this with a
// real broker — Redis Streams, Postgres LISTEN/NOTIFY, etc.
const CHAT_HISTORY_LIMIT = 100;
const chatHistory = [];
const chatListeners = new Set();
let nextChatId = 1;

function postChatMessage(author, text) {
  const m = { id: nextChatId++, author, text, ts: Date.now() };
  chatHistory.push(m);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
  // Snapshot before firing — a listener that re-subscribes during its
  // callback can't re-enter mid-loop.
  const fire = Array.from(chatListeners);
  chatListeners.clear();
  for (const cb of fire) cb(m);
  return m;
}

function nextChatMessage() {
  return new Promise((resolve) => chatListeners.add(resolve));
}

function buildRegistry() {
  const reg = new InterfaceRegistry();
  reg.register(IFC, M_ECHO_U8, (_t, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder).u8 = p.u8;
  });
  reg.register(IFC, M_ECHO_TEXT, (_t, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder).text = p.text;
  });
  reg.register(IFC, M_ECHO_BINARY, (_t, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder).data = p.data;
  });
  reg.register(IFC, M_GET_CHILD, () => ({ caps: [{ kind: "child" }] }));

  // Chat handlers. The wire format here is plain JSON inside Cap'n Proto
  // text fields — the helpers (subscribeQuery, optimistic) don't care
  // about wire format. A production app would use a Cap'n Proto schema
  // for the message struct and skip the JSON encode/decode.
  reg.register(CHAT_IFC, CHAT_M_POST, (_t, ctx) => {
    const params = JSON.parse(new TextDecoder().decode(ctx.paramsBytes()));
    if (typeof params.author !== "string" || typeof params.text !== "string" || !params.text.trim()) {
      throw new Error("invalid post: need {author, text}");
    }
    // Bound abuse a little: trim and limit length so a busted client
    // can't flood the buffer.
    const author = params.author.slice(0, 32);
    const text = params.text.slice(0, 240);
    postChatMessage(author, text);
  });

  reg.registerStream(CHAT_IFC, CHAT_M_SUBSCR, async function* () {
    // Replay history first so a fresh tab sees recent context.
    for (const m of chatHistory) {
      yield new TextEncoder().encode(JSON.stringify(m));
    }
    // Then keep yielding new messages forever (until the iterator
    // unwinds via Finish from the client).
    while (true) {
      const m = await nextChatMessage();
      yield new TextEncoder().encode(JSON.stringify(m));
    }
  });

  return reg;
}

class CapnwebEcho extends RpcTarget {
  echoU8(o)     { return { u8: o.u8 }; }
  echoText(s)   { return s; }
  echoBinary(b) { return b; }
  getChild()    { return new CapnwebEcho(); }
}

// Wire RPC handling onto an existing http.Server. Used identically by
// the dev hook and the preview hook so dev/preview behaviour matches.
function attachRpc(httpServer, registry, label, log) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req, kind) => {
    if (kind === "capnwasm" || kind === "chat") {
      loadWasm().then((cpp) => {
        new RpcSession(cpp, wsTransport(ws), registry, { bootstrap: { kind: "root" } });
      });
    } else if (kind === "capnweb") {
      newWebSocketRpcSession(ws, new CapnwebEcho());
    }
  });

  httpServer?.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const isCapnwasm = url.startsWith("/capnwasm");
    const isCapnweb  = url.startsWith("/capnweb");
    const isChat     = url.startsWith("/chat");
    if (!isCapnwasm && !isCapnweb && !isChat) return;  // Vite's own HMR upgrades pass through
    const which = isCapnwasm ? "capnwasm" : isCapnweb ? "capnweb" : "chat";
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, which);
    });
  });

  log?.info(`  \x1b[36m\x1b[1m➜\x1b[0m  RPC server attached at /capnwasm, /capnweb, /chat (${label})`);
  return wss;
}

export function rpcDevServer() {
  const reg = buildRegistry();
  let wss = null;

  return {
    name: "capnwasm-rpc-dev-server",
    configureServer(server) {
      wss = attachRpc(server.httpServer, reg, "dev", server.config.logger);
    },
    configurePreviewServer(server) {
      wss = attachRpc(server.httpServer, reg, "preview", server.config.logger);
    },
    closeBundle() {
      wss?.close();
    },
  };
}
