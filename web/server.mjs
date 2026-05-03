// WebSocket RPC server for the playground's RPC bench. Hosts BOTH a
// capnwasm RPC endpoint and a capnweb RPC endpoint so the in-browser
// page can run the same workloads against the same server, side by side.
//
// Endpoints (all on the same port):
//   ws://HOST:PORT/capnwasm   capnwasm RpcSession + InterfaceRegistry
//   ws://HOST:PORT/capnweb    capnweb RpcSession + RpcTarget
//
// Both implement the same surface:
//   echoU8(u8: number) -> { u8: number }
//   echoText(s: string) -> string
//   echoBinary(bytes: Uint8Array) -> Uint8Array
//   getChild() -> Echo (a fresh sub-target/cap)
//
// Run separately from vite (it's a long-lived process):
//   node server.mjs                # default port 8081
//   PORT=9000 node server.mjs

import { WebSocketServer } from "ws";
import { load as loadWasm } from "../dist/inlined.mjs";
import { RpcSession, InterfaceRegistry, wsTransport } from "../js/rpc.mjs";
// PrimitivesReader/Builder is the project's existing primitives schema  - 
// has u8 + text + data fields that map cleanly onto the three echo
// methods this server exposes. Available because the bench schemas are
// shipped in js/ alongside the runtime.
import { PrimitivesBuilder, PrimitivesReader } from "../js/conformance_schema.gen.mjs";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";

const PORT = parseInt(process.env.PORT ?? "8081", 10);

// ---- capnwasm side: interface IDs --------------------------------------
const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8     = 0;
const M_ECHO_TEXT   = 1;
const M_ECHO_BINARY = 2;
const M_GET_CHILD   = 3;

const cppServer = await loadWasm();
const reg = new InterfaceRegistry();
reg.register(IFC, M_ECHO_U8, (_t, ctx) => {
  const p = ctx.openParams(PrimitivesReader);
  const u8 = p.u8;
  const reply = ctx.beginResults(PrimitivesBuilder);
  reply.u8 = u8;
});
reg.register(IFC, M_ECHO_TEXT, (_t, ctx) => {
  const p = ctx.openParams(PrimitivesReader);
  const t = p.text;
  const reply = ctx.beginResults(PrimitivesBuilder);
  reply.text = t;  // echo verbatim; the bench measures wire + decode, not transform
});
reg.register(IFC, M_ECHO_BINARY, (_t, ctx) => {
  // PrimitivesReader has an `avatar`-shaped Data field exposed under the
  // `data` getter. Reply mirrors the bytes back; capnwasm ships them
  // raw, capnweb has to base64-encode.
  const p = ctx.openParams(PrimitivesReader);
  const bytes = p.data;
  const reply = ctx.beginResults(PrimitivesBuilder);
  reply.data = bytes;
});
reg.register(IFC, M_GET_CHILD, () => ({ caps: [{ kind: "child" }] }));

// ---- capnweb side: a single root target with the same methods ----------
class CapnwebEcho extends RpcTarget {
  echoU8(o)     { return { u8: o.u8 }; }
  echoText(s)   { return s; }
  echoBinary(b) { return b; }
  getChild()    { return new CapnwebEcho(); }
}

// ---- WebSocket dispatch ------------------------------------------------
const wss = new WebSocketServer({ port: PORT });
console.log(`[server] listening on ws://localhost:${PORT}`);
console.log(`[server] capnwasm at /capnwasm, capnweb at /capnweb`);

wss.on("connection", (ws, req) => {
  const url = req.url ?? "/";
  if (url.startsWith("/capnwasm")) {
    // Each connection gets its own wasm instance; independent scratch
    // buffers means concurrent connections can't clobber each other.
    loadWasm().then((cpp) => {
      new RpcSession(cpp, wsTransport(ws), reg, { bootstrap: { kind: "root" } });
    });
  } else if (url.startsWith("/capnweb")) {
    newWebSocketRpcSession(ws, new CapnwebEcho());
  } else {
    ws.close(1002, "unknown endpoint; use /capnwasm or /capnweb");
  }
});

process.on("SIGINT",  () => { wss.close(() => process.exit(0)); });
process.on("SIGTERM", () => { wss.close(() => process.exit(0)); });
