// Three-party handoff (3PH): Alice holds a cap on Bob, wants to share it
// with Carol. Without 3PH Carol must call through Alice (extra hop, Alice
// stays in the path). With 3PH, Alice mints an introduction token bound
// to Carol's identity; Carol presents the token to Bob and gets a direct
// cap. Calls then go Carol → Bob with no Alice involvement.
//
// Tokens bind to an opaque "recipient identity" string, and Carol proves
// she is that recipient by presenting the same string. For production,
// plug a real verifier (signature check, JWT, mTLS subject) into the
// store's `verify()` callback.
//
// Server side (the cap-bearing peer, "Bob"):
//
//   import {
//     InMemoryHandoffStore,
//     registerHandoffHandlers,
//   } from "capnwasm/handoff";
//
//   const store = new InMemoryHandoffStore({
//     verify: (claimed, expected) => claimed === expected,
//   });
//   const registry = new InterfaceRegistry();
//   registerHandoffHandlers(registry, store);
//
// Introducer side ("Alice"):
//
//   import { introduce } from "capnwasm/handoff";
//   const token = await introduce(aliceCapOnBob, "carol-identity");
//   // Send token to Carol via any channel.
//
// Recipient side ("Carol"):
//
//   import { redeem } from "capnwasm/handoff";
//   const carolCap = await redeem(carolBootstrapOnBob, token, "carol-identity");
//   // carolCap calls go Carol → Bob directly.

const SHARED_DECODER = new TextDecoder();
const SHARED_ENCODER = new TextEncoder();

export const HANDOFF_INTERFACE_ID = 0xcafe5e5d51e7e1f2n;
export const HANDOFF_METHOD_INTRODUCE = 0;
export const HANDOFF_METHOD_REDEEM = 1;

// Token framing: 4 bytes "CWHO" magic + 4 bytes version (LE u32) + payload.
const TOKEN_MAGIC = SHARED_ENCODER.encode("CWHO");
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
    throw new Error("invalid handoff token: too short");
  }
  for (let i = 0; i < 4; i++) {
    if (token[i] !== TOKEN_MAGIC[i]) {
      throw new Error("invalid handoff token: bad magic");
    }
  }
  const version = new DataView(token.buffer, token.byteOffset, token.byteLength).getUint32(4, true);
  if (version !== TOKEN_VERSION) {
    throw new Error(`unsupported handoff token version ${version}`);
  }
  return token.subarray(8);
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * In-memory handoff store. Tokens are random 32-byte payloads; entries
 * record the cap target and the expected recipient identity.
 *
 * @param {object} [opts]
 * @param {(claimed: string, expected: string) => boolean} [opts.verify]
 *   Identity verifier. Default is strict string equality. For prod, plug
 *   in signature/cert verification (e.g. verify a JWT signed by a key
 *   that proves the holder is `expected`).
 * @param {boolean} [opts.consumeOnRedeem=false] Drop the entry after
 *   successful redemption. Turns the token into a one-shot.
 */
export class InMemoryHandoffStore {
  #map = new Map();
  #verify;
  #consumeOnRedeem;

  constructor({ verify, consumeOnRedeem = false } = {}) {
    this.#verify = verify ?? ((claimed, expected) => claimed === expected);
    this.#consumeOnRedeem = consumeOnRedeem;
  }

  mint(target, recipient) {
    if (!recipient) throw new Error("handoff: recipient is required");
    const raw = randomBytes(32);
    this.#map.set(toHex(raw), { target, recipient });
    return raw;
  }

  /** Returns the target if `claimedRecipient` verifies, else null. */
  redeem(payload, claimedRecipient) {
    const key = toHex(payload);
    const entry = this.#map.get(key);
    if (!entry) return null;
    if (!this.#verify(claimedRecipient, entry.recipient)) return null;
    if (this.#consumeOnRedeem) this.#map.delete(key);
    return entry.target;
  }

  forget(payload) {
    return this.#map.delete(toHex(payload));
  }

  get size() { return this.#map.size; }
}

function packIntroduceParams(recipient) {
  // Single byte payload: u32 recipientLen + recipientBytes.
  const recBytes = SHARED_ENCODER.encode(recipient);
  const buf = new Uint8Array(4 + recBytes.length);
  new DataView(buf.buffer).setUint32(0, recBytes.length, true);
  buf.set(recBytes, 4);
  return frameBytesPayload(buf);
}

function unpackIntroduceParams(framed) {
  const inner = unframeBytesPayload(framed);
  const dv = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  const recLen = dv.getUint32(0, true);
  if (4 + recLen > inner.length) throw new Error("handoff: truncated introduce params");
  return SHARED_DECODER.decode(inner.subarray(4, 4 + recLen));
}

function packRedeemParams(token, claimedRecipient) {
  const recBytes = SHARED_ENCODER.encode(claimedRecipient);
  const buf = new Uint8Array(4 + token.length + 4 + recBytes.length);
  const dv = new DataView(buf.buffer);
  let p = 0;
  dv.setUint32(p, token.length, true); p += 4;
  buf.set(token, p); p += token.length;
  dv.setUint32(p, recBytes.length, true); p += 4;
  buf.set(recBytes, p);
  return frameBytesPayload(buf);
}

function unpackRedeemParams(framed) {
  const inner = unframeBytesPayload(framed);
  const dv = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  let p = 0;
  const tokLen = dv.getUint32(p, true); p += 4;
  if (p + tokLen > inner.length) throw new Error("handoff: truncated redeem params (token)");
  const token = inner.subarray(p, p + tokLen);
  p += tokLen;
  const recLen = dv.getUint32(p, true); p += 4;
  if (p + recLen > inner.length) throw new Error("handoff: truncated redeem params (recipient)");
  const recipient = SHARED_DECODER.decode(inner.subarray(p, p + recLen));
  return { token, recipient };
}

function frameBytesPayload(payload) {
  const dataWords = Math.ceil(payload.length / 8);
  const segWords = 1 + dataWords;
  const out = new Uint8Array(8 + segWords * 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, segWords, true);
  dv.setUint32(8, 0x01, true);
  dv.setUint32(12, (payload.length << 3) | 2, true);
  out.set(payload, 16);
  return out;
}

function unframeBytesPayload(framed) {
  if (framed.length < 16) throw new Error("handoff: malformed payload");
  const dv = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  const lo = dv.getUint32(8, true);
  const hi = dv.getUint32(12, true);
  if ((lo & 0x3) !== 1) throw new Error("handoff: expected list pointer");
  if ((hi & 0x7) !== 2) throw new Error("handoff: expected byte list");
  const count = hi >>> 3;
  if (16 + count > framed.length) throw new Error("handoff: payload length exceeds frame");
  return framed.subarray(16, 16 + count);
}

/**
 * Server side: register the handoff introduce/redeem handlers.
 */
export function registerHandoffHandlers(registry, store) {
  if (!registry || typeof registry.register !== "function") {
    throw new Error("registerHandoffHandlers: registry is required");
  }
  if (!store || typeof store.mint !== "function" || typeof store.redeem !== "function") {
    throw new Error("registerHandoffHandlers: store must implement mint() and redeem()");
  }

  // INTRODUCE: target = the cap to hand off (the local object the cap points
  // at). Params = recipient identity. Returns a token bound to (target,
  // recipient).
  registry.register(HANDOFF_INTERFACE_ID, HANDOFF_METHOD_INTRODUCE, async (target, ctx) => {
    if (!target) throw new Error("handoff: introduce called against null target");
    const recipient = unpackIntroduceParams(ctx.paramsBytes());
    const raw = await store.mint(target, recipient);
    return frameBytesPayload(frameToken(raw));
  });

  // REDEEM: target is irrelevant. Params = (token, claimedRecipient).
  // Returns the bound cap if the recipient verifies.
  registry.register(HANDOFF_INTERFACE_ID, HANDOFF_METHOD_REDEEM, async (_target, ctx) => {
    const { token, recipient } = unpackRedeemParams(ctx.paramsBytes());
    const payload = unframeToken(token);
    const target = await store.redeem(payload, recipient);
    if (!target) throw new Error("handoff: token not redeemable for this recipient");
    return { caps: [target] };
  });
}

/**
 * Introducer side: ask the server to mint a token bound to `recipient`.
 * Call this against the cap you want to hand off (Alice's cap on Bob).
 */
export async function introduce(cap, recipient) {
  if (!cap || typeof cap.call !== "function") {
    throw new Error("introduce: cap must be an RpcCap");
  }
  if (typeof recipient !== "string" || recipient.length === 0) {
    throw new Error("introduce: recipient must be a non-empty string");
  }
  const params = packIntroduceParams(recipient);
  const r = await cap.call(HANDOFF_INTERFACE_ID, HANDOFF_METHOD_INTRODUCE, params, []).promise;
  // The handler returns the framed token (magic+version+payload) wrapped in
  // a byte-list payload; we unwrap one layer here to get the framed token.
  // Caller holds it opaquely and hands it back to redeem() unchanged.
  return unframeBytesPayload(r.bytes);
}

/**
 * Recipient side: present a token + identity proof to the server, get a cap
 * pointing at the bound target. Call against any cap on the target server
 * (typically the bootstrap).
 */
export async function redeem(serverCap, token, claimedRecipient) {
  if (!serverCap || typeof serverCap.call !== "function") {
    throw new Error("redeem: serverCap must be an RpcCap");
  }
  if (!(token instanceof Uint8Array)) {
    throw new Error("redeem: token must be a Uint8Array");
  }
  if (typeof claimedRecipient !== "string") {
    throw new Error("redeem: claimedRecipient must be a string");
  }
  const params = packRedeemParams(token, claimedRecipient);
  const r = await serverCap.call(HANDOFF_INTERFACE_ID, HANDOFF_METHOD_REDEEM, params, []).promise;
  if (!r.caps || r.caps.length === 0) {
    throw new Error("redeem: server returned no cap");
  }
  return r.caps[0];
}
