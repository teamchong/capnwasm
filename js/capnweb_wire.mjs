// capnweb-wire compat shim. Speak capnweb's newline-delimited JSON
// protocol so capnwasm clients can talk to capnweb servers (and vice
// versa) without changing the server side.
//
// This is a minimum viable implementation of the wire protocol described
// in capnweb/protocol.md:
//
//   ["push", expression]            outbound call
//   ["pull", importId]              ask for the result
//   ["resolve", exportId, expr]     successful return
//   ["reject", exportId, expr]      thrown error
//   ["release", importId, refcount] drop an import
//   ["abort", expression]           session-fatal error
//
// Expressions:
//   literal JSON       → as-is (string, number, bool, null, object)
//   [["..."]]          → escaped array literal
//   ["pipeline", id, propPath, args]  → method call against import id
//   ["bigint", "123"]  → BigInt
//   ["bytes", base64]  → Uint8Array
//   ["date", millis]   → Date
//   ["error", type, msg]  → Error
//
// Not implemented (would expand the surface significantly):
//   - Promise pipelining beyond a single hop
//   - Capabilities returned in results (one-shot calls only)
//   - .map() / "remap" expressions
//   - "pipe" / "stream" framing for ReadableStream
//
// Use: capnwasm client → capnweb server, simple-method-call workloads.

const SHARED_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();

/**
 * A minimal JSON-wire RPC client compatible with capnweb's protocol.
 *
 *   import { JsonWireSession } from "capnwasm/capnweb-wire";
 *
 *   const port1 = ...;    // a MessagePort connected to a capnweb peer
 *   const session = new JsonWireSession(messagePortTransport(port1));
 *   const result = await session.call(["echo"], ["hello"]);
 *
 * `call(propertyPath, args)` issues a Push against the bootstrap (import 0).
 * propertyPath is the chain of property accesses from the bootstrap to the
 * method (e.g. ["sub", "doThing"] for `bootstrap.sub.doThing(...)`).
 */
export class JsonWireSession {
  #transport;
  #pending = new Map();           // importId → { resolve, reject }
  #nextImportId = 1;              // positive IDs allocated by us as importer
  #closed = false;

  constructor(transport) {
    this.#transport = transport;
    transport.onMessage((line) => this.#handleLine(line));
    transport.onClose?.(() => this.#shutdown(new Error("transport closed")));
  }

  /**
   * Push an expression and pull its resolution. Returns the decoded result.
   * Bootstrap is always import 0; pass propertyPath = [] to call it as a
   * function, or [...path] to drill into properties / call methods.
   */
  call(propertyPath, args = []) {
    if (this.#closed) throw new Error("JsonWireSession closed");
    const importId = this.#nextImportId++;
    const expression = encodePipeline(0, propertyPath, args);
    // Push followed by Pull on the same line. Capnweb processes multiple
    // top-level messages per line if newline-separated, but two lines in
    // one transport.send is also fine (newline-delimited framing).
    this.#sendLine(JSON.stringify(["push", expression]));
    this.#sendLine(JSON.stringify(["pull", importId]));
    return new Promise((resolve, reject) => {
      this.#pending.set(importId, { resolve, reject });
    });
  }

  close() {
    if (this.#closed) return;
    this.#shutdown(new Error("session closed by application"));
    this.#transport.close?.();
  }

  #sendLine(line) {
    // capnweb's framing for non-WebSocket transports is newline-delimited.
    // For WebSocket / MessagePort each transport message is one RPC
    // message. No extra newline needed. Transport decides.
    this.#transport.send(line);
  }

  #handleLine(data) {
    // The transport may hand us a Uint8Array (real WS) or a string
    // (MessagePort sends strings). Normalize to lines.
    const text = typeof data === "string" ? data : SHARED_DECODER.decode(data);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try { msg = JSON.parse(trimmed); }
      catch (err) { this.#shutdown(new Error(`bad JSON from peer: ${err.message}`)); return; }
      this.#handleMessage(msg);
    }
  }

  #handleMessage(msg) {
    if (!Array.isArray(msg) || msg.length < 1) return;
    switch (msg[0]) {
      case "resolve": {
        const importId = msg[1];
        const expression = msg[2];
        const p = this.#pending.get(importId);
        if (!p) return;
        this.#pending.delete(importId);
        try {
          p.resolve(decodeExpression(expression));
        } catch (err) {
          p.reject(err);
        }
        // Capnweb expects us to release the import after resolution.
        this.#sendLine(JSON.stringify(["release", importId, 1]));
        return;
      }
      case "reject": {
        const importId = msg[1];
        const expression = msg[2];
        const p = this.#pending.get(importId);
        if (!p) return;
        this.#pending.delete(importId);
        const decoded = decodeExpression(expression);
        const err = decoded instanceof Error
          ? decoded
          : new Error(typeof decoded === "string" ? decoded : JSON.stringify(decoded));
        p.reject(err);
        this.#sendLine(JSON.stringify(["release", importId, 1]));
        return;
      }
      case "abort": {
        this.#shutdown(new Error("peer aborted: " + JSON.stringify(msg[1])));
        return;
      }
      // push/pull/release/stream: server-initiated; client-only impl ignores.
      default:
        return;
    }
  }

  #shutdown(err) {
    if (this.#closed) return;
    this.#closed = true;
    for (const p of this.#pending.values()) p.reject(err);
    this.#pending.clear();
  }
}

// ---- Expression encoding / decoding --------------------------------------

function encodePipeline(importId, propertyPath, args) {
  // ["pipeline", importId, propertyPath, callArguments]
  // Per protocol.md: omitting callArguments means "evaluate to the
  // property" (return it as a capability reference), NOT "call with no
  // args". A method invocation must always include callArguments. Even
  // an empty array. So capnweb knows to call the function instead of
  // returning a reference to it.
  return ["pipeline", importId, propertyPath, args.map(encodeValue)];
}

function encodeValue(v) {
  if (v === undefined) return ["undefined"];
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (Number.isFinite(v)) return v;
    if (Number.isNaN(v)) return ["nan"];
    return v > 0 ? ["inf"] : ["-inf"];
  }
  if (typeof v === "bigint") return ["bigint", v.toString()];
  if (v instanceof Uint8Array) return ["bytes", uint8ToBase64(v)];
  if (v instanceof Date) return ["date", v.getTime()];
  if (v instanceof Error) {
    const type = v.constructor.name;
    return ["error", type, v.message];
  }
  if (Array.isArray(v)) {
    // Wrap in an array literal: [[...elements...]]
    return [v.map(encodeValue)];
  }
  if (typeof v === "object") {
    const out = {};
    for (const [k, vv] of Object.entries(v)) out[k] = encodeValue(vv);
    return out;
  }
  throw new TypeError(`JsonWireSession: cannot encode value of type ${typeof v}`);
}

function decodeExpression(e) {
  if (e === null || typeof e !== "object") return e;
  if (Array.isArray(e)) {
    if (e.length === 1 && Array.isArray(e[0])) {
      // Array literal. Recursively decode each element.
      return e[0].map(decodeExpression);
    }
    if (typeof e[0] !== "string") return e;     // shouldn't happen in well-formed messages
    switch (e[0]) {
      case "undefined": return undefined;
      case "null":      return null;
      case "inf":       return Infinity;
      case "-inf":      return -Infinity;
      case "nan":       return NaN;
      case "bigint":    return BigInt(e[1]);
      case "bytes":     return base64ToUint8(e[1]);
      case "date":      return new Date(e[1]);
      case "error": {
        const type = e[1] || "Error";
        const msg = e[2] || "";
        const Ctor = globalThis[type] && typeof globalThis[type] === "function"
          ? globalThis[type]
          : Error;
        return new Ctor(msg);
      }
      case "headers": {
        const h = new Headers();
        for (const [k, v] of e[1] ?? []) h.append(k, v);
        return h;
      }
      // Capability references. Preserve the raw expression so the caller
      // can inspect it if needed. Full capability support is out of scope
      // for this minimal client.
      case "import": case "export": case "pipeline":
        return { $rpcRef: e };
      default:
        return e;
    }
  }
  // Plain object: recurse into properties.
  const out = {};
  for (const [k, v] of Object.entries(e)) out[k] = decodeExpression(v);
  return out;
}

function uint8ToBase64(u8) {
  // Avoid a String.fromCharCode.apply spread for large arrays.
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- Transport adapters ---------------------------------------------------

/**
 * Wrap a MessagePort so it satisfies the JsonWireSession transport contract.
 * Compatible with capnweb's MessagePortTransport on the other end.
 */
export function messagePortTransport(port) {
  let cb = null;
  let closeCb = null;
  port.start?.();
  port.addEventListener("message", (ev) => {
    if (ev.data === null) {
      if (closeCb) { closeCb(); closeCb = null; }
      return;
    }
    if (cb) cb(ev.data);
  });
  return {
    send(line) { port.postMessage(line); },
    onMessage(handler) { cb = handler; },
    onClose(handler) { closeCb = handler; },
    close() {
      try { port.postMessage(null); } catch {}
      try { port.close?.(); } catch {}
      cb = null;
    },
  };
}
