// capnwasm.teamchong.net Worker.
//
// Two jobs, one origin:
//
//   1. Static site (the docs + playground + benches) is served by the
//      `assets` binding (configured in wrangler.json). Anything under
//      `/`, `/playground.html`, etc. comes from web/dist.
//
//   2. This worker handles the live demo endpoints that need Worker
//      runtime behavior:
//
//        WS   /capnwasm       → capnwasm RPC demo endpoint
//        WS   /capnweb        → capnweb comparison endpoint
//        WS   /chat-ws        → capnwasm streaming chat demo
//        POST /capnwasm-http  → capnwasm HTTP-batch RPC endpoint
//        POST /capnweb-http   → capnweb HTTP-batch comparison endpoint
//
//      It also handles `/api/*` to prove that the same wasm runtime
//      shipped to the browser also runs inside a Workers isolate:
//
//        GET  /api/users/:id   → returns a capnp-encoded User message
//        POST /api/echo        → accepts capnp bytes, decodes, re-encodes,
//                                returns the round-tripped message
//
// Both endpoints exercise the precompiled-wasm + dynamic schema reader /
// builder path. If those work in a Worker, the README's
// "Workers-compatible at runtime" claim is live, not hypothetical.
//
// SECURITY / COST: this worker is a public demo on the author's
// Cloudflare account. The library's defaults can stay permissive for
// forks; the public demo can't, or anyone piping 10 MB capnp bytes at
// /api/echo for an hour will run up the bill. The shape of the demo
// dictates the shape of the defense:
//
//   - The playground page fires many /api/users/:id requests in
//     parallel for the render bench. Rate-limiting that breaks the
//     demo. Those requests are cheap (synthesize-and-encode a small
//     User struct).
//   - /api/echo is the expensive one: it accepts arbitrary capnp
//     bytes and decodes them. That's where abuse hurts.
//
// So the defense splits along two axes:
//
//   - Body cap (64 KB) on /api/echo, applied to everyone. Doesn't
//     affect the demo since real round-trip bodies are well under
//     1 KB; rejects the 10 MB-pipe case at the door.
//   - Origin gating on /api/echo: same-origin (Origin / Referer
//     matches capnwasm.teamchong.net) gets in unconditionally. Other
//     origins (curl with no Referer, scripts from elsewhere) get a
//     30/min/IP rate limit on /api/echo specifically.
//
// /api/users/:id and /api/health stay fully open in both axes, so the
// playground bench works exactly as designed. For a hard cross-fleet
// limit, configure Cloudflare WAF rate-limiting rules at the zone level;
// what's here is a per-isolate speed bump that's cheap and defends the
// expensive surface without breaking the cheap surfaces.

import wasmModule from "../dist/capnp.slim.wasm";
import { CapnCpp } from "../js/browser.mjs";
import { defineSchema, buildDynamic, openDynamic } from "../js/dynamic.mjs";
import { RpcSession, InterfaceRegistry, wsTransport } from "../js/rpc.mjs";
import { createHttpBatchHandler } from "../js/http_batch.mjs";
import { PrimitivesBuilder, PrimitivesReader } from "../js/conformance_schema.gen.mjs";
import { WideUserDataBuilder } from "../js/typed_schema.gen.mjs";
import { RpcTarget, newWorkersRpcResponse } from "capnweb";

// The chat demo's WebSocket endpoints (`/chat-ws` and `/capnweb-chat-ws`)
// route through a Durable Object so all clients share one in-memory chat
// room and one I/O context. That's what makes live broadcast work on
// workerd: a POST event on socket A can wake a sleeping subscribe stream
// on socket B because both events run in the same DO instance.
export { ChatRoom } from "./chat_room.mjs";

const MAX_ECHO_BODY_BYTES = 64 * 1024;
const SAME_ORIGIN_HOST = "capnwasm.teamchong.net";
const ECHO_RATE_LIMIT_WINDOW_MS = 60_000;
const ECHO_RATE_LIMIT_MAX = 30;
const echoRateLimitState = new Map(); // ip → { count, windowStart }

const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8     = 0;
const M_ECHO_TEXT   = 1;
const M_ECHO_BINARY = 2;
const M_GET_CHILD   = 3;

const RENDER_IFC          = 0xb1a5c0deb1a5c0den;
const RENDER_M_USER_LIST  = 0;
const RENDER_M_METADATA   = 1;
const RENDER_M_BLOB       = 2;

// One CapnCpp instance per isolate. Each instance is ~25 MB of linear
// memory; sharing across requests is cheap and avoids re-instantiation
// cost on every `fetch`.
let cppPromise = null;
function cpp() {
  return (cppPromise ??= CapnCpp.load(wasmModule));
}

// User schema (same shape as web/users.capnp). Defined inline so the
// worker has no codegen step. The dynamic builder/reader path is the
// "no-codegen" entry capnwasm offers to runtime-schema consumers.
const USER_SCHEMA = defineSchema({
  id:         { kind: "uint64", offset: 0 },
  name:       { kind: "text",   slot: 0 },
  email:      { kind: "text",   slot: 1 },
  joinedAtMs: { kind: "uint64", offset: 8 },
  active:     { kind: "bool",   bitOffset: 128 },
  avatar:     { kind: "data",   slot: 2 },
}, { dataWords: 3, ptrWords: 3 });

const USER_LIST_SCHEMA = defineSchema({
  users: { kind: "listStruct", slot: 0, element: USER_SCHEMA },
}, { dataWords: 0, ptrWords: 1 });

const BLOB_SCHEMA = defineSchema({
  data: { kind: "data", slot: 0 },
}, { dataWords: 0, ptrWords: 1 });

// Tiny synthetic-user generator so /api/users/:id always returns
// something interesting. No DB; this exists to prove the wasm round-trip,
// not to be a real user service.
function synthesizeUser(id) {
  const idNum = BigInt(id);
  return {
    id: idNum,
    name: `User ${id}`,
    email: `user${id}@capnwasm.demo`,
    joinedAtMs: BigInt(Date.UTC(2024, 0, 1)),
    active: idNum % 2n === 0n,
    avatar: new Uint8Array(0),
  };
}

function makeUser(i) {
  return {
    id: BigInt(i + 1),
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    joinedAtMs: BigInt(1700000000000 + i * 86400000),
    active: (i & 1) === 0,
    avatar: new Uint8Array(0),
  };
}

function makeMetadata() {
  const out = {};
  for (let i = 0; i < 32; i++) out[`field${i}`] = `value-${i}-${"x".repeat(40)}`;
  return out;
}

function makeBlob(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = i & 0xff;
  return out;
}

const registry = buildRegistry();

function buildRegistry() {
  const reg = new InterfaceRegistry();

  reg.register(IFC, M_ECHO_U8, (_target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder).u8 = p.u8;
  });
  reg.register(IFC, M_ECHO_TEXT, (_target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder).text = p.text;
  });
  reg.register(IFC, M_ECHO_BINARY, (_target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder).data = p.data;
  });
  reg.register(IFC, M_GET_CHILD, () => ({ caps: [{ kind: "child" }] }));

  // Chat handlers live in the ChatRoom Durable Object — see chat_room.mjs.
  // The /chat-ws and /capnweb-chat-ws endpoints below route into the DO
  // so all clients share one chat room and one I/O context (which is
  // what makes live broadcast actually deliver in workerd).

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
  reg.register(RENDER_IFC, RENDER_M_METADATA, (target) => {
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

  getUserList(n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = {
        id: i + 1,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        joinedAtMs: 1700000000000 + i * 86400000,
        active: (i & 1) === 0,
      };
    }
    return out;
  }
  getMetadata() { return makeMetadata(); }
  getBlob(n) { return makeBlob(n); }
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/capnwasm") {
      return acceptCapnwasmWebSocket(req);
    }
    if (url.pathname === "/chat-ws"
        || url.pathname === "/capnweb-chat-ws"
        || url.pathname === "/chat-http"
        || url.pathname === "/capnweb-chat-http") {
      // All chat traffic — both framings, both transports — fans into
      // one shared ChatRoom DO so every connection sees every message.
      const id = env.CHAT_ROOM.idFromName("global");
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(req);
    }
    if (url.pathname === "/capnweb") {
      return newWorkersRpcResponse(req, new CapnwebEcho());
    }
    if (url.pathname === "/capnwasm-http" && req.method === "POST") {
      const c = await cpp();
      return createHttpBatchHandler(c, registry, {
        bootstrap: { kind: "root", cpp: c },
      })(req);
    }
    if (url.pathname === "/capnweb-http") {
      return newWorkersRpcResponse(req, new CapnwebEcho());
    }

    // /api/users/:id — encode a User to capnp bytes, return them.
    const userMatch = url.pathname.match(/^\/api\/users\/(\w+)$/);
    if (req.method === "GET" && userMatch) {
      try {
        const c = await cpp();
        const b = buildDynamic(c, USER_SCHEMA);
        const obj = synthesizeUser(userMatch[1]);
        b.set("id", obj.id);
        b.set("name", obj.name);
        b.set("email", obj.email);
        b.set("joinedAtMs", obj.joinedAtMs);
        b.set("active", obj.active);
        b.set("avatar", obj.avatar);
        const bytes = b.finalize();
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "application/capnp",
            "x-capnwasm-runtime": "wasm-in-worker",
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return jsonError(500, "encode_failed", err);
      }
    }

    // POST /api/echo — accept capnp bytes, decode, re-encode, return.
    // Proves the worker can both READ and WRITE the wire format.
    //
    // This is the expensive endpoint, so it gets the abuse defenses:
    // off-origin callers hit a per-IP rate limit; everyone hits a body
    // cap. Same-origin callers (the demo page) bypass the rate limit.
    if (req.method === "POST" && url.pathname === "/api/echo") {
      if (!isSameOrigin(req)) {
        const limited = checkEchoRateLimit(req);
        if (limited) return limited;
      }
      // Reject oversize bodies before reading them. Two checks: the
      // declared content-length (cheap) and the actual byte count
      // (defends against streamed bodies with a lying Content-Length).
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_ECHO_BODY_BYTES) {
        return jsonError(413, "body_too_large", { max: MAX_ECHO_BODY_BYTES, declared });
      }
      try {
        const buf = new Uint8Array(await req.arrayBuffer());
        if (buf.length > MAX_ECHO_BODY_BYTES) {
          return jsonError(413, "body_too_large", { max: MAX_ECHO_BODY_BYTES, actual: buf.length });
        }
        if (buf.length === 0) return jsonError(400, "empty_body");
        const c = await cpp();
        const reader = openDynamic(c, USER_SCHEMA, buf);
        const obj = reader.toObject();
        const b = buildDynamic(c, USER_SCHEMA);
        for (const [k, v] of Object.entries(obj)) b.set(k, v);
        const bytes = b.finalize();
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "application/capnp",
            "x-capnwasm-runtime": "wasm-in-worker",
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return jsonError(400, "decode_failed", err);
      }
    }

    // GET /api/health — quick liveness check the docs site can ping.
    if (req.method === "GET" && url.pathname === "/api/health") {
      const c = await cpp();
      return new Response(JSON.stringify({
        ok: true,
        runtime: "capnwasm in Cloudflare Workers",
        scratchBytes: c?._cap ?? null,
        ts: Date.now(),
      }), {
        status: 200,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    }

    // Anything else under /api/* → 404 with a small hint.
    if (url.pathname.startsWith("/api/")) {
      return jsonError(404, "no_such_endpoint", { tried: url.pathname });
    }

    // Non-/api paths fall through to the assets binding (the static
    // docs site in web/dist). Return undefined to defer.
    return env.ASSETS.fetch(req);
  },
};

async function acceptCapnwasmWebSocket(req) {
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("This endpoint only accepts WebSocket requests.", { status: 400 });
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const c = await cpp();
  new RpcSession(c, wsTransport(server), registry, { bootstrap: { kind: "root", cpp: c } });
  return new Response(null, { status: 101, webSocket: client });
}

function jsonError(status, code, detail) {
  return new Response(JSON.stringify({
    error: code,
    detail: detail instanceof Error ? String(detail.message ?? detail) : detail,
  }), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function isSameOrigin(req) {
  // Trust requests whose Origin or Referer points at the demo host.
  // Both headers are easily spoofed, so this is not a security
  // boundary; it's a way to keep the demo's own playground page free
  // of rate limits while still slowing down the obvious abuse case
  // (curl / scripts hitting /api/echo with no Referer or a different
  // one). Combined with the hard body cap, that's enough for a public
  // demo. For real cross-fleet enforcement, layer Cloudflare WAF
  // rate-limiting rules at the zone level.
  const origin = req.headers.get("origin");
  if (origin) {
    try { return new URL(origin).hostname === SAME_ORIGIN_HOST; } catch { return false; }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try { return new URL(referer).hostname === SAME_ORIGIN_HOST; } catch { return false; }
  }
  return false;
}

function checkEchoRateLimit(req) {
  // Off-origin callers only. Identify by CF-Connecting-IP (Cloudflare's
  // authoritative origin IP header), falling back to a loopback marker
  // for local dev. Sliding 60 s window per isolate; Workers spread
  // across isolates so this is a per-isolate speed bump, not a global
  // limit.
  const ip = req.headers.get("cf-connecting-ip") ?? "127.0.0.1";
  const now = Date.now();
  let entry = echoRateLimitState.get(ip);
  if (!entry || now - entry.windowStart >= ECHO_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    echoRateLimitState.set(ip, entry);
  }
  entry.count++;
  if (entry.count > ECHO_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.windowStart + ECHO_RATE_LIMIT_WINDOW_MS - now) / 1000);
    return new Response(JSON.stringify({
      error: "rate_limited",
      detail: { max: ECHO_RATE_LIMIT_MAX, windowSeconds: ECHO_RATE_LIMIT_WINDOW_MS / 1000 },
    }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfter),
        ...CORS_HEADERS,
      },
    });
  }
  return null;
}
