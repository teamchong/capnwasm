// Sturdyref: persistable handles for capabilities.
//
// A sturdyref is an opaque token a caller can persist and later use to
// reconstruct a capability on a fresh session. Even after the original
// session has dropped, even after a process restart (when the store is
// durable). Cap'n Proto's "Persistent" interface pattern; here it's an
// opt-in helper rather than a wire-level primitive, so it works against
// the C++ runtime we ship without adding new RPC frames.
//
// Server side:
//
//   import { InMemorySturdyrefStore, registerSturdyrefHandlers }
//     from "capnwasm/sturdyref";
//
//   const store = new InMemorySturdyrefStore();
//   const registry = new InterfaceRegistry();
//   registerSturdyrefHandlers(registry, store);
//   // ...other handlers...
//   const session = new RpcSession(cpp, transport, registry, { bootstrap });
//
// Client side:
//
//   import { persist, restoreRef } from "capnwasm/sturdyref";
//
//   const cap = session.bootstrap();
//   const token = await persist(cap);     // Uint8Array, hand to caller
//   // ...later, possibly different session...
//   const cap2 = await restoreRef(otherSession.bootstrap(), token);
//
// Pluggable storage: implement `SturdyrefStore` (mint/lookup/forget) over
// Redis, Cloudflare Workers KV, Postgres, anything. The default in-memory
// store is for dev / single-process scenarios.

const SHARED_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();

// Reserved interface ID for the sturdyref helper. Bit pattern picked to
// minimize collision risk with user schemas. Stable. Change here would
// break existing tokens, so don't.
export const STURDYREF_INTERFACE_ID = 0xcafe5e5d51e7e1f0n;
export const STURDYREF_METHOD_SAVE = 0;
export const STURDYREF_METHOD_RESTORE = 1;

// Token framing: 4 bytes "CWSR" magic + 4 bytes version (LE u32) + payload.
// The magic+version lets a future change in the wire token (e.g. add a
// signature, switch hash) be detected and rejected cleanly.
const TOKEN_MAGIC = SHARED_ENCODER.encode("CWSR");
const TOKEN_VERSION = 1;

function frameToken(payload) {
  const out = new Uint8Array(8 + payload.length);
  out.set(TOKEN_MAGIC, 0);
  new DataView(out.buffer).setUint32(4, TOKEN_VERSION, true);
  out.set(payload, 8);
  return out;
}

function unframeToken(token) {
  if (!(token instanceof Uint8Array) || token.length < 8) {
    throw new Error("invalid sturdyref token: too short");
  }
  for (let i = 0; i < 4; i++) {
    if (token[i] !== TOKEN_MAGIC[i]) {
      throw new Error("invalid sturdyref token: bad magic");
    }
  }
  const version = new DataView(token.buffer, token.byteOffset, token.byteLength).getUint32(4, true);
  if (version !== TOKEN_VERSION) {
    throw new Error(`unsupported sturdyref version ${version}`);
  }
  return token.subarray(8);
}

/**
 * In-memory sturdyref store. Keyed by random 32-byte tokens; the values are
 * raw target objects (whatever you registered the cap as). Suitable for
 * single-process dev/test; for production, implement the same shape over
 * durable storage.
 */
export class InMemorySturdyrefStore {
  #map = new Map();   // hex(token) → target

  mint(target) {
    const raw = randomBytes(32);
    this.#map.set(toHex(raw), target);
    return raw;
  }

  lookup(payload) {
    return this.#map.get(toHex(payload)) ?? null;
  }

  forget(payload) {
    return this.#map.delete(toHex(payload));
  }

  get size() { return this.#map.size; }
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
  } else {
    // Fallback for runtimes without WebCrypto (very old Node).
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// Cap'n Proto framed message holding a single inline-data field as the
// root payload. Used as both the params shape (for restore: token bytes)
// and the result shape (for save: token bytes). Hand-coded to avoid
// pulling in the codegen machinery for a single helper.
//
// Layout: 4 segCount(=0 → 1 segment) + 4 segWords + 8 root pointer +
// (data words). Root pointer kind=1 (list), elementSize=2 (byte), count=N.
function buildBytesMessage(payload) {
  const dataWords = Math.ceil(payload.length / 8);
  const segWords = 1 + dataWords;   // root pointer + data
  const totalBytes = 8 + segWords * 8;
  const out = new Uint8Array(totalBytes);
  const dv = new DataView(out.buffer);
  // Segment table: count-1 = 0, segWords
  dv.setUint32(0, 0, true);
  dv.setUint32(4, segWords, true);
  // Root pointer (offset 8): list pointer pointing 0 words after itself,
  // element size 2 (byte = 8-bit), element count = payload.length.
  // Layout: [type:2 bits=1][offset:30 bits][element-size:3 bits=2][count:29 bits]
  // type=1 (list), offset=0 → low word = 0x01.
  // element-size=2, count=N → high word = (N << 3) | 2.
  dv.setUint32(8, 0x01, true);
  dv.setUint32(12, (payload.length << 3) | 2, true);
  // Payload after the root pointer.
  out.set(payload, 16);
  return out;
}

function readBytesMessage(framed) {
  if (framed.length < 16) throw new Error("sturdyref: malformed payload");
  const dv = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  // Skip segment table; read root pointer at offset 8.
  const lo = dv.getUint32(8, true);
  const hi = dv.getUint32(12, true);
  const ptrType = lo & 0x3;
  if (ptrType !== 1) throw new Error(`sturdyref: expected list pointer, got type ${ptrType}`);
  const elemSize = hi & 0x7;
  if (elemSize !== 2) throw new Error(`sturdyref: expected byte list, got elemSize ${elemSize}`);
  const count = hi >>> 3;
  if (16 + count > framed.length) throw new Error("sturdyref: payload length exceeds frame");
  return framed.subarray(16, 16 + count);
}

/**
 * Register the sturdyref save/restore handlers on the given registry.
 * Server side. The store is the source of truth. Pass an
 * InMemorySturdyrefStore for dev or a durable adapter for prod.
 */
export function registerSturdyrefHandlers(registry, store) {
  if (!registry || typeof registry.register !== "function") {
    throw new Error("registerSturdyrefHandlers: registry is required");
  }
  if (!store || typeof store.mint !== "function" || typeof store.lookup !== "function") {
    throw new Error("registerSturdyrefHandlers: store must implement mint() and lookup()");
  }
  // SAVE: invoked on the cap to persist. target = the local object the cap
  // points at. Mint a token for it, frame it as a list-of-bytes payload.
  registry.register(STURDYREF_INTERFACE_ID, STURDYREF_METHOD_SAVE, async (target) => {
    if (!target) throw new Error("sturdyref: save called against null target");
    const raw = await store.mint(target);
    return buildBytesMessage(frameToken(raw));
  });
  // RESTORE: invoked anywhere; ignores target. Reads token from params,
  // looks up the original object, returns it as a cap.
  registry.register(STURDYREF_INTERFACE_ID, STURDYREF_METHOD_RESTORE, async (_target, ctx) => {
    const params = ctx.paramsBytes();
    const token = readBytesMessage(params);
    const payload = unframeToken(token);
    const target = await store.lookup(payload);
    if (!target) throw new Error("sturdyref: token not found");
    return { caps: [target] };
  });
}

/**
 * Client side: ask the server to persist the given cap. Returns an opaque
 * Uint8Array token the caller persists. Hand the token back to
 * `restoreRef()` later to get a fresh cap pointing at the same object.
 */
export async function persist(cap) {
  if (!cap || typeof cap.call !== "function") {
    throw new Error("persist: cap must be an RpcCap");
  }
  const r = await cap.call(STURDYREF_INTERFACE_ID, STURDYREF_METHOD_SAVE, EMPTY_PARAMS, []).promise;
  return readBytesMessage(r.bytes);
}

/**
 * Client side: hand the server a token, get back a cap that points at the
 * object the token was minted for. Call this against any cap on the target
 * server (typically the bootstrap).
 */
export async function restoreRef(serverCap, token) {
  if (!serverCap || typeof serverCap.call !== "function") {
    throw new Error("restoreRef: serverCap must be an RpcCap");
  }
  if (!(token instanceof Uint8Array)) {
    throw new Error("restoreRef: token must be a Uint8Array");
  }
  const params = buildBytesMessage(token);
  const r = await serverCap.call(STURDYREF_INTERFACE_ID, STURDYREF_METHOD_RESTORE, params, []).promise;
  if (!r.caps || r.caps.length === 0) {
    throw new Error("restoreRef: server returned no cap");
  }
  return r.caps[0];
}

const EMPTY_PARAMS = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
