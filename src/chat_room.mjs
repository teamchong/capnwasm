// ChatRoom Durable Object.
//
// Two independent chat streams live on the same DO instance, one per
// library framing:
//
//   capnwasm side:  /chat-ws         + /chat-http
//   capnweb side:   /capnweb-chat-ws + /capnweb-chat-http
//
// Each side has its own history, id sequence, and subscriber set.
// Posts on one side never appear on the other — each pane in the chat
// page reflects only what its own library sent and received. The DO
// is just a convenient single home for both states; it's the only
// place on workerd where a POST event on socket A can wake a sleeping
// subscribe stream on socket B (workerd's per-event request isolation
// otherwise drops cross-event resolves).

import wasmModule from "../dist/capnp.slim.wasm";
import { DurableObject } from "cloudflare:workers";
import { CapnCpp } from "../js/browser.mjs";
import { RpcSession, InterfaceRegistry, wsTransport } from "../js/rpc.mjs";
import { createHttpBatchHandler } from "../js/http_batch.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";
import {
  PostParamsReader,
  ChatMessageBuilder,
  GetSinceParamsReader,
} from "../web/src/chat/chat.capnp.gen.mjs";
import { RpcTarget, newWorkersWebSocketRpcResponse, newWorkersRpcResponse } from "capnweb";

const CHAT_IFC      = 0xc4a7c4a7c4a7c4a7n;
const CHAT_M_POST   = 0;
const CHAT_M_SUBSCR = 1;
const CHAT_M_GET_SINCE = 2;

// Wire-shape mirror of the ChatMessage / ChatMessageList structs in
// chat.capnp. The codegen builder doesn't yet emit `fromObject`
// support for List(Struct), so the REST/poll handler builds the
// response with `buildDynamic` instead. Field offsets must match the
// codegen Builder/Reader (2 data words + 3 ptr words; image at slot 2).
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
const PNG_CACHE_LIMIT = 200;

const PNG_TEXT_ENCODER = new TextEncoder();

/** Single chat-side state: history + waker set + id sequence.
 *  A library has one of these for its own endpoints; posting on the
 *  capnwasm side appends to the capnwasm Side and notifies only
 *  capnwasm subscribers, never the capnweb subscribers (and vice
 *  versa). The two sides only share the PNG cache via the parent DO,
 *  so the same rendered message bytes are reused across framings. */
class Side {
  constructor(name) {
    this.name = name;
    /** @type {Array<{id:number,author:string,text:string,ts:number,image:Uint8Array}>} */
    this.history = [];
    /** Set of resolve(m) callbacks parked by capnwasm subscribe streams. */
    this.streamWakers = new Set();
    /** Set of capnweb client callback stubs (only one of these two
     *  Sets is non-empty per library — capnwasm uses streamWakers,
     *  capnweb uses stubSubscribers — but keeping both on every Side
     *  keeps the postMessage code uniform). */
    this.stubSubscribers = new Set();
    this.nextId = 1;
  }

  appendAndNotify(m) {
    this.history.push(m);
    if (this.history.length > CHAT_HISTORY_LIMIT) this.history.shift();

    const wake = Array.from(this.streamWakers);
    this.streamWakers.clear();
    for (const cb of wake) cb(m);

    for (const stub of this.stubSubscribers) {
      stub.onMessage(m).catch(() => this.stubSubscribers.delete(stub));
    }
  }

  nextMessage() {
    return new Promise((resolve) => this.streamWakers.add(resolve));
  }

  messagesSince(cursor) {
    if (cursor <= 0) return this.history.slice();
    return this.history.filter((m) => m.id > cursor);
  }
}

export class ChatRoom extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.capnwasm = new Side("capnwasm");
    this.capnweb  = new Side("capnweb");
    /** Lazily-loaded shared CapnCpp; reused across every WS in this DO. */
    this.cppPromise = null;
    /** Resolved cpp instance once cpp() finishes for the first time. */
    this.cppSync = null;
    /** Text-keyed PNG cache, shared across both sides. Same server
     *  input text produces identical PNG bytes regardless of framing. */
    this.pngCache = new Map();
    /** RpcRegistry for the capnwasm side. Routes M_POST / M_SUBSCR /
     *  M_GET_SINCE into `this.capnwasm`. */
    this.registry = this.#buildRegistry();
  }

  cpp() {
    if (!this.cppPromise) {
      this.cppPromise = CapnCpp.load(wasmModule).then((c) => {
        this.cppSync = c;
        return c;
      });
    }
    return this.cppPromise;
  }

  /** Render (or look up) the server-side PNG for `text`. Bytes flow
   *  through the wasm scratch buffers — caller must have finished any
   *  inbound-frame access (rpc_reader, openParams) before invoking. */
  renderTextPng(text) {
    let cached = this.pngCache.get(text);
    if (cached) return cached;
    if (!this.cppSync) return new Uint8Array(0);
    const cpp = this.cppSync;
    const exp = cpp._exports;
    const enc = PNG_TEXT_ENCODER.encode(text);
    cpp._u8.set(enc, exp.cpp_in_ptr());
    const len = exp.cpp_chat_render_text_png(enc.length);
    if (!len) return new Uint8Array(0);
    const out = exp.cpp_out_ptr();
    const png = cpp._u8.slice(out, out + len);
    this.pngCache.set(text, png);
    if (this.pngCache.size > PNG_CACHE_LIMIT) {
      const oldest = this.pngCache.keys().next().value;
      this.pngCache.delete(oldest);
    }
    return png;
  }

  /** Post into one specific Side. The PNG is rendered (or cache-hit)
   *  once per message text; both sides share the cache. */
  postTo(side, author, text) {
    const m = {
      id: side.nextId++,
      author,
      text,
      ts: Date.now(),
      // The PNG is the server-rendered binary echo for this message.
      // Include both author and text in the seed so every message gets
      // its own image bytes, not just a per-author avatar.
      image: this.renderTextPng(`${author}\n${text}`),
    };
    side.appendAndNotify(m);
    return m;
  }

  #buildRegistry() {
    const reg = new InterfaceRegistry();
    const room = this;
    const side = this.capnwasm;

    reg.register(CHAT_IFC, CHAT_M_POST, (_target, ctx) => {
      const p = ctx.openParams(PostParamsReader);
      const author = p.author;
      const text = p.text;
      if (!text.trim()) throw new Error("invalid post: text is empty");
      room.postTo(side, author.slice(0, 32), text.slice(0, 240));
    });

    reg.registerStream(CHAT_IFC, CHAT_M_SUBSCR, async function* (_target, ctx) {
      // Replay history first so a fresh tab sees recent context.
      for (const m of side.history) {
        yield new ChatMessageBuilder(ctx.cpp).fromObject(m).toBytes();
      }
      while (true) {
        const m = await side.nextMessage();
        yield new ChatMessageBuilder(ctx.cpp).fromObject(m).toBytes();
      }
    });

    reg.register(CHAT_IFC, CHAT_M_GET_SINCE, (_target, ctx) => {
      const p = ctx.openParams(GetSinceParamsReader);
      const items = side.messagesSince(Number(p.since));
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
    return reg;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const upgrade = req.headers.get("Upgrade")?.toLowerCase() === "websocket";

    if (url.pathname === "/chat-ws") {
      if (!upgrade) return new Response("expected WebSocket", { status: 400 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const cpp = await this.cpp();
      new RpcSession(cpp, wsTransport(server), this.registry, {
        bootstrap: { kind: "root", cpp },
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/capnweb-chat-ws") {
      if (!upgrade) return new Response("expected WebSocket", { status: 400 });
      await this.cpp();
      return newWorkersWebSocketRpcResponse(req, new CapnwebChatRoomTarget(this, this.capnweb));
    }

    if (url.pathname === "/chat-http" && req.method === "POST") {
      const cpp = await this.cpp();
      const handler = createHttpBatchHandler(cpp, this.registry, {
        bootstrap: { kind: "root", cpp },
      });
      return handler(req);
    }

    if (url.pathname === "/capnweb-chat-http" && req.method === "POST") {
      await this.cpp();
      return newWorkersRpcResponse(req, new CapnwebChatRoomTarget(this, this.capnweb));
    }

    return new Response("not found", { status: 404 });
  }
}

/** capnweb-side RPC target. Operates on the capnweb Side only. */
class CapnwebChatRoomTarget extends RpcTarget {
  constructor(room, side) {
    super();
    this.room = room;
    this.side = side;
  }

  post(author, text) {
    if (typeof author !== "string" || typeof text !== "string") {
      throw new Error("post(author, text) expects strings");
    }
    if (!text.trim()) throw new Error("invalid post: text is empty");
    this.room.postTo(this.side, author.slice(0, 32), text.slice(0, 240));
  }

  /** Subscribe holds a duplicated stub past the call boundary. capnweb
   *  implicitly disposes stubs received in params when the call
   *  returns; .dup() keeps a copy alive for future broadcasts. */
  subscribe(callback) {
    const held = callback.dup();
    for (const m of this.side.history) {
      held.onMessage(m).catch(() => {});
    }
    this.side.stubSubscribers.add(held);
  }

  getMessagesSince(since) {
    if (typeof since !== "number" && typeof since !== "bigint") return [];
    return this.side.messagesSince(Number(since));
  }
}
