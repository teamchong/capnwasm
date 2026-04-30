// Vite plugin that mounts the playground's RPC server onto Vite's own
// HTTP server during dev. Lets the WebSocket bench page connect to
// ws://localhost:5173/capnwasm and /capnweb without spinning up a
// second process — `npm run dev` is enough.
//
// The plugin only runs in the dev server (`vite serve`); production
// `vite build` is static, so users running `vite preview` against the
// built site need to start the server out-of-band (`npm run server`).
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
  return reg;
}

class CapnwebEcho extends RpcTarget {
  echoU8(o)     { return { u8: o.u8 }; }
  echoText(s)   { return s; }
  echoBinary(b) { return b; }
  getChild()    { return new CapnwebEcho(); }
}

export function rpcDevServer() {
  const reg = buildRegistry();
  let wss = null;

  return {
    name: "capnwasm-rpc-dev-server",
    apply: "serve",
    configureServer(server) {
      // Vite's HTTP server handles the HMR /__vite/ upgrade. We attach a
      // separate noServer-mode WSS and route based on URL path so HMR
      // keeps working alongside the bench endpoints.
      wss = new WebSocketServer({ noServer: true });

      wss.on("connection", (ws, req, kind) => {
        if (kind === "capnwasm") {
          loadWasm().then((cpp) => {
            new RpcSession(cpp, wsTransport(ws), reg, { bootstrap: { kind: "root" } });
          });
        } else if (kind === "capnweb") {
          newWebSocketRpcSession(ws, new CapnwebEcho());
        }
      });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = req.url ?? "";
        const isCapnwasm = url.startsWith("/capnwasm");
        const isCapnweb  = url.startsWith("/capnweb");
        if (!isCapnwasm && !isCapnweb) return;  // let Vite's HMR handle it
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, isCapnwasm ? "capnwasm" : "capnweb");
        });
      });

      server.config.logger.info(
        "  \x1b[36m\x1b[1m➜\x1b[0m  RPC bench server attached at /capnwasm and /capnweb"
      );
    },
    closeBundle() {
      wss?.close();
    },
  };
}
