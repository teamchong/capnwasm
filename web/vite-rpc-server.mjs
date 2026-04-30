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

// Wire RPC handling onto an existing http.Server. Used identically by
// the dev hook and the preview hook so dev/preview behaviour matches.
function attachRpc(httpServer, registry, label, log) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req, kind) => {
    if (kind === "capnwasm") {
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
    if (!isCapnwasm && !isCapnweb) return;  // Vite's own HMR upgrades pass through
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, isCapnwasm ? "capnwasm" : "capnweb");
    });
  });

  log?.info(`  \x1b[36m\x1b[1m➜\x1b[0m  RPC bench server attached at /capnwasm and /capnweb (${label})`);
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
