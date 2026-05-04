// Vite plugin that mounts the playground's RPC server onto Vite's own
// HTTP server. Two attach points:
//
//   configureServer       ; `vite dev`. RPC endpoints sit alongside
//                            HMR on the same port.
//   configurePreviewServer; `vite preview`. Same endpoints attached
//                            to the static-file server, so the same
//                            `pnpm -C web preview` produces a working
//                            production-shaped bench without anyone
//                            running a second process.
//
// Implementation: attach our own WebSocketServer in `noServer` mode to
// the underlying http.Server's `upgrade` event. Vite has its own HMR
// WebSocket; we only handle paths starting with /capnwasm or /capnweb
// and let Vite handle everything else. Chat uses /chat-ws so it does not
// collide with the static /chat page route.

import { WebSocketServer } from "ws";
import { load as loadWasm } from "../dist/inlined.mjs";
import { RpcSession, InterfaceRegistry, wsTransport } from "../js/rpc.mjs";
import { createHttpBatchHandler } from "../js/http_batch.mjs";
import { PrimitivesBuilder, PrimitivesReader } from "../js/conformance_schema.gen.mjs";
import {
  PostParamsReader,
  ChatMessageBuilder,
  GetSinceParamsReader,
} from "./src/chat/chat.capnp.gen.mjs";
import { WideUserDataBuilder, WideUserDataReader } from "../js/typed_schema.gen.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";
import { newWebSocketRpcSession, nodeHttpBatchRpcResponse, RpcTarget } from "capnweb";

const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8     = 0;
const M_ECHO_TEXT   = 1;
const M_ECHO_BINARY = 2;
const M_GET_CHILD   = 3;

// --- render-bench interface ---------------------------------------------
// Methods exposed for web/render-bench.html. Each is mirrored on the
// capnweb side so the page can hit both libraries with identical
// semantics. RENDER_M_GET_BLOB takes a UInt32 size and echoes that many
// deterministic bytes; the other methods return fixed-shape payloads
// the page knows how to render.
const RENDER_IFC          = 0xb1a5c0deb1a5c0den;
const RENDER_M_USER_LIST  = 0;  // params: CountParams { n }      → UserList
const RENDER_M_METADATA   = 1;  // params: empty                   → WideUserData
const RENDER_M_BLOB       = 2;  // params: CountParams { n }       → BlobReply

// Inline schema for User (mirror of web/users.capnp). The codegen builder
// can't write List(User) yet (the gen path skips struct lists in
// fromObject), so the server hand-builds the response via buildDynamic.
// Wire dimensions match the codegen reader on the client side, which is
// what matters for round-trip correctness.
const USER_SCHEMA = defineSchema({
  id:         { kind: "uint64", offset: 0 },
  joinedAtMs: { kind: "uint64", offset: 8 },
  active:     { kind: "bool",   bitOffset: 128 }, // bit 128 == byte 16, bit 0
  name:       { kind: "text",   slot: 0 },
  email:      { kind: "text",   slot: 1 },
  avatar:     { kind: "data",   slot: 2 },
}, { dataWords: 3, ptrWords: 3 });
const USER_LIST_SCHEMA = defineSchema({
  users: { kind: "listStruct", slot: 0, element: USER_SCHEMA },
}, { dataWords: 0, ptrWords: 1 });
const BLOB_SCHEMA = defineSchema({
  data: { kind: "data", slot: 0 },
}, { dataWords: 0, ptrWords: 1 });

function makeUser(i) {
  return {
    id: BigInt(i + 1),
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    joinedAtMs: BigInt(1700000000000 + i * 86400000),
    active: (i & 1) === 0,
  };
}

// 32-field metadata payload; matches the WideUserData schema so the
// client can read it via the codegen reader. Fields are uniform so the
// only thing varying between iterations is the wire path / decode cost.
function makeMetadata() {
  const o = {};
  for (let i = 0; i < 32; i++) o["field" + i] = "value-" + i + "-" + "x".repeat(40);
  return o;
}

// Deterministic byte payload of a given size. Uses a tight loop so the
// allocation cost is consistent across runs (no Math.random, no per-call
// JIT bailouts).
function makeBlob(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = i & 0xff;
  return out;
}

// Chat IFC; used by web/chat.html. Constants must agree with web/src/chat/main.ts.
const CHAT_IFC         = 0xc4a7c4a7c4a7c4a7n;
const CHAT_M_POST      = 0;
const CHAT_M_SUBSCR    = 1;
const CHAT_M_GET_SINCE = 2;

// Wire-shape mirror of the ChatMessage / ChatMessageList structs in
// chat.capnp. Same dimensions as the codegen Builder's static fields.
const CHAT_MESSAGE_SCHEMA = defineSchema({
  id:     { kind: "uint64", offset: 0 },
  author: { kind: "text",   slot: 0 },
  text:   { kind: "text",   slot: 1 },
  ts:     { kind: "uint64", offset: 8 },
  image:  { kind: "data",   slot: 2 },
}, { dataWords: 2, ptrWords: 3 });

const CHAT_MESSAGE_LIST_SCHEMA = defineSchema({
  items: { kind: "listStruct", slot: 0, element: CHAT_MESSAGE_SCHEMA },
}, { dataWords: 0, ptrWords: 1 });

const CHAT_HISTORY_LIMIT = 100;

// Two independent in-memory chat sides, one per library framing. A
// post via /chat-ws or /chat-http only appears on the capnwasm side;
// a post via /capnweb-chat-ws or /capnweb-chat-http only appears on
// the capnweb side. Same shape as the worker DO; this is the vite-dev
// shim's mirror of that state.
function makeSide(name) {
  return {
    name,
    history: [],
    streamWakers: new Set(),
    stubSubscribers: new Set(),
    nextId: 1,
  };
}
const sideCapnwasm = makeSide("capnwasm");
const sideCapnweb  = makeSide("capnweb");

// Text-keyed PNG cache, shared across both sides.
const pngCache = new Map();
const PNG_TEXT_ENCODER = new TextEncoder();

// First cpp instance to finish loading wins; subsequent calls reuse
// the same wasm linear memory for avatar rendering.
let chatCpp = null;
function setChatCpp(cpp) { chatCpp ??= cpp; }

function renderTextPng(text) {
  let cached = pngCache.get(text);
  if (cached) return cached;
  if (!chatCpp) return new Uint8Array(0);
  const exp = chatCpp._exports;
  const bytes = PNG_TEXT_ENCODER.encode(text);
  chatCpp._u8.set(bytes, exp.cpp_in_ptr());
  const len = exp.cpp_chat_render_text_png(bytes.length);
  if (!len) return new Uint8Array(0);
  const out = exp.cpp_out_ptr();
  const png = chatCpp._u8.slice(out, out + len);
  pngCache.set(text, png);
  return png;
}

function postTo(side, author, text) {
  const m = {
    id: side.nextId++,
    author,
    text,
    ts: Date.now(),
    // Server-rendered binary echo for this message. Seed includes the
    // message text so the PNG bytes vary per message, not just per author.
    image: renderTextPng(`${author}\n${text}`),
  };
  side.history.push(m);
  if (side.history.length > CHAT_HISTORY_LIMIT) side.history.shift();
  // Snapshot before firing; a listener that re-subscribes during its
  // callback can't re-enter mid-loop.
  const fire = Array.from(side.streamWakers);
  side.streamWakers.clear();
  for (const cb of fire) cb(m);
  for (const stub of side.stubSubscribers) {
    stub.onMessage(m).catch(() => side.stubSubscribers.delete(stub));
  }
  return m;
}

function nextChatMessage(side) {
  return new Promise((resolve) => side.streamWakers.add(resolve));
}

function messagesSince(side, cursor) {
  if (cursor <= 0) return side.history.slice();
  return side.history.filter((m) => m.id > cursor);
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

  // Chat handlers. Capnwasm side only — the registry maps directly to
  // sideCapnwasm. capnweb has its own RpcTarget (CapnwebChat below)
  // that operates on sideCapnweb.
  reg.register(CHAT_IFC, CHAT_M_POST, (_t, ctx) => {
    const p = ctx.openParams(PostParamsReader);
    const author = p.author;
    const text = p.text;
    if (!text.trim()) throw new Error("invalid post: text is empty");
    postTo(sideCapnwasm, author.slice(0, 32), text.slice(0, 240));
  });

  reg.registerStream(CHAT_IFC, CHAT_M_SUBSCR, async function* (_t, ctx) {
    for (const m of sideCapnwasm.history) {
      yield new ChatMessageBuilder(ctx.cpp).fromObject(m).toBytes();
    }
    while (true) {
      const m = await nextChatMessage(sideCapnwasm);
      yield new ChatMessageBuilder(ctx.cpp).fromObject(m).toBytes();
    }
  });

  reg.register(CHAT_IFC, CHAT_M_GET_SINCE, (_t, ctx) => {
    const p = ctx.openParams(GetSinceParamsReader);
    const items = messagesSince(sideCapnwasm, Number(p.since));
    const b = buildDynamic(ctx.cpp, CHAT_MESSAGE_LIST_SCHEMA);
    b.set("items", items.map((m) => ({
      id: BigInt(m.id),
      author: m.author,
      text: m.text,
      ts: BigInt(m.ts),
      image: m.image,
    })));
    return b.finalize();
  });

  // ---- render-bench methods --------------------------------------------
  // All three return raw Cap'n Proto bytes built via the dynamic API or
  // the WideUserData codegen builder. Bootstrap target carries the per-
  // connection cpp instance so each handler can build into its own arena
  // (separate connections never share scratch buffers).
  // Params shape for getUserList/getBlob is `CountParams { n :UInt32 }`.
  // Skip the codegen reader and pull the first u32 out of the params'
  // data section directly; saves one wasm boundary call. The framed
  // Call params start with: 4 B segCount-1 | 4 B segLen | 8 B root ptr,
  // so the data section starts at byte 16.
  function paramN(pBytes, fallback) {
    if (pBytes.length < 20) return fallback;
    return new DataView(pBytes.buffer, pBytes.byteOffset + 16, 4).getUint32(0, true);
  }

  reg.register(RENDER_IFC, RENDER_M_USER_LIST, (target, ctx) => {
    const n = paramN(ctx.paramsBytes(), 100);
    const users = new Array(n);
    for (let i = 0; i < n; i++) users[i] = makeUser(i);
    const b = buildDynamic(target.cpp, USER_LIST_SCHEMA);
    b.set("users", users);
    return b.finalize();
  });

  reg.register(RENDER_IFC, RENDER_M_METADATA, (target, _ctx) => {
    return new WideUserDataBuilder(target.cpp).fromObject(makeMetadata()).toBytes();
  });

  reg.register(RENDER_IFC, RENDER_M_BLOB, (target, ctx) => {
    const n = paramN(ctx.paramsBytes(), 4096);
    const b = buildDynamic(target.cpp, BLOB_SCHEMA);
    b.set("data", makeBlob(n));
    return b.finalize();
  });

  return reg;
}

class CapnwebEcho extends RpcTarget {
  echoU8(o)     { return { u8: o.u8 }; }
  echoText(s)   { return s; }
  echoBinary(b) { return b; }
  getChild()    { return new CapnwebEcho(); }

  // Render-bench methods. Same shape as the capnwasm side so the
  // browser bench can hit either library with one method-name table.
  // capnweb sends JSON, so the response is a plain JS object; the
  // page renders both libraries' results identically.
  getUserList(n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = {
        id: i + 1,                              // capnweb JSON: number, not BigInt
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        joinedAtMs: 1700000000000 + i * 86400000,
        active: (i & 1) === 0,
      };
    }
    return out;
  }
  getMetadata() {
    const o = {};
    for (let i = 0; i < 32; i++) o["field" + i] = "value-" + i + "-" + "x".repeat(40);
    return o;
  }
  getBlob(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = i & 0xff;
    return out;
  }
}

// capnweb chat target. Mirror of `CapnwebChatRoomTarget` in
// src/chat_room.mjs; operates on `sideCapnweb` only.
class CapnwebChat extends RpcTarget {
  post(author, text) {
    if (typeof author !== "string" || typeof text !== "string") {
      throw new Error("post(author, text) expects strings");
    }
    if (!text.trim()) throw new Error("invalid post: text is empty");
    postTo(sideCapnweb, author.slice(0, 32), text.slice(0, 240));
  }
  subscribe(callback) {
    const held = callback.dup();
    for (const m of sideCapnweb.history) held.onMessage(m).catch(() => {});
    sideCapnweb.stubSubscribers.add(held);
  }
  getMessagesSince(since) {
    if (typeof since !== "number" && typeof since !== "bigint") return [];
    return messagesSince(sideCapnweb, Number(since));
  }
}

// Wire RPC handling onto an existing http.Server. Used identically by
// the dev hook and the preview hook so dev/preview behaviour matches.
function attachRpc(httpServer, registry, label, log) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req, kind) => {
    if (kind === "capnwasm" || kind === "chat") {
      loadWasm().then((cpp) => {
        setChatCpp(cpp);
        // Bootstrap target carries the per-connection cpp instance so
        // render-bench handlers can build into THIS connection's arena.
        new RpcSession(cpp, wsTransport(ws), registry, { bootstrap: { kind: "root", cpp } });
      });
    } else if (kind === "capnweb") {
      newWebSocketRpcSession(ws, new CapnwebEcho());
    } else if (kind === "capnweb-chat") {
      // Make sure cpp is loaded before the target starts dispatching
      // post() — the avatar renderer reads the wasm scratch.
      loadWasm().then((cpp) => {
        setChatCpp(cpp);
        newWebSocketRpcSession(ws, new CapnwebChat());
      });
    }
  });

  httpServer?.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const isCapnwasm   = url.startsWith("/capnwasm");
    const isCapnwebChat = url.startsWith("/capnweb-chat-ws");
    const isCapnweb    = url.startsWith("/capnweb");  // matches /capnweb and /capnweb-http
    const isChat       = url.startsWith("/chat-ws");
    if (!isCapnwasm && !isCapnweb && !isCapnwebChat && !isChat) return;  // Vite's own HMR upgrades pass through
    let which;
    if (isCapnwasm)         which = "capnwasm";
    else if (isCapnwebChat) which = "capnweb-chat";
    else if (isCapnweb)     which = "capnweb";
    else                    which = "chat";
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, which);
    });
  });

  log?.info(`  \x1b[36m\x1b[1m➜\x1b[0m  RPC server attached at /capnwasm, /capnweb, /chat-ws, /capnweb-chat-ws (${label})`);
  return wss;
}

// Mount the HTTP batch endpoints on Vite's connect middleware stack.
// /capnwasm-http: capnwasm createHttpBatchHandler; each request is a
//                 fresh stateless RpcSession over a per-request wasm.
// /capnweb-http:  capnweb nodeHttpBatchRpcResponse; same per-request
//                 isolation, takes Node IncomingMessage directly.
// Both handlers pre-load their state once at startup so the cold call
// from a fresh tab still includes wasm-load time on the first hit.
function attachHttp(middlewares, registry, log) {
  // Per-request capnwasm session via createHttpBatchHandler. Wasm is
  // loaded once and reused across requests (the handler creates a fresh
  // RpcSession per call; only the wasm linear memory is shared).
  let cppPromise = null;
  function getCpp() {
    if (!cppPromise) cppPromise = loadWasm();
    return cppPromise;
  }

  middlewares.use("/capnwasm-http", async (req, res, next) => {
    if (req.method !== "POST") return next();
    try {
      const cpp = await getCpp();
      const handler = createHttpBatchHandler(cpp, registry, {
        bootstrap: { kind: "root", cpp },
      });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const webReq = new Request("http://localhost" + (req.url ?? "/"), {
        method: "POST",
        headers: { "Content-Type": req.headers["content-type"] ?? "application/x-capnwasm-batch" },
        body,
      });
      const webRes = await handler(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });

  middlewares.use("/capnweb-http", async (req, res, next) => {
    if (req.method !== "POST") return next();
    try {
      await nodeHttpBatchRpcResponse(req, res, new CapnwebEcho());
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });

  // /chat-http: capnwasm REST mode for the chat. Same registry as the
  // WS path, so post() and getMessagesSince() see the same in-process
  // chatHistory. The request body is a capnwasm Call frame (one per
  // method invocation), exactly like /capnwasm-http.
  middlewares.use("/chat-http", async (req, res, next) => {
    if (req.method !== "POST") return next();
    try {
      const cpp = await getCpp();
      setChatCpp(cpp);
      const handler = createHttpBatchHandler(cpp, registry, {
        bootstrap: { kind: "root", cpp },
      });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const webReq = new Request("http://localhost" + (req.url ?? "/"), {
        method: "POST",
        headers: { "Content-Type": req.headers["content-type"] ?? "application/x-capnwasm-batch" },
        body,
      });
      const webRes = await handler(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });

  // /capnweb-chat-http: capnweb REST mode. Same target as the WS
  // path; clients fetch this with a single Call frame per poll/post.
  middlewares.use("/capnweb-chat-http", async (req, res, next) => {
    if (req.method !== "POST") return next();
    try {
      // Ensure cpp is loaded for the avatar renderer.
      setChatCpp(await getCpp());
      await nodeHttpBatchRpcResponse(req, res, new CapnwebChat());
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });

  log?.info("  \x1b[36m\x1b[1m➜\x1b[0m  HTTP batch attached at /capnwasm-http, /capnweb-http, /chat-http, /capnweb-chat-http");
}

export function rpcDevServer() {
  const reg = buildRegistry();
  let wss = null;

  return {
    name: "capnwasm-rpc-dev-server",
    configureServer(server) {
      wss = attachRpc(server.httpServer, reg, "dev", server.config.logger);
      attachHttp(server.middlewares, reg, server.config.logger);
    },
    configurePreviewServer(server) {
      wss = attachRpc(server.httpServer, reg, "preview", server.config.logger);
      attachHttp(server.middlewares, reg, server.config.logger);
    },
    closeBundle() {
      wss?.close();
    },
  };
}
