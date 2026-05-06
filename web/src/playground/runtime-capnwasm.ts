// capnwasm bridge for the multi-language chatroom.
//
// Every chat message — whether the user types it or an agent generates
// it — gets encoded through capnwasm into a small envelope before
// reaching another participant. Each agent decodes the same wire bytes
// via its own language's runtime (Python/Ruby/Go/Java/JS), so the
// envelope is the lingua franca and capnwasm is what every runtime
// shares.
//
// Envelope schema:
//
//   struct ChatEnvelope {
//     speaker  :Text;     # who's speaking (user or an agent name)
//     body     :Text;     # the message
//     replyTo  :Text;     # speaker name we're responding to ("" for top-level)
//   }
//
// The wire bytes the page emits are produced by capnwasm's dynamic
// builder; the reader is dynamic too, with a Proxy wrapper so the
// editor / agent code can use plain `env.body` syntax.

// @ts-ignore — capnwasm browser entry; ships with the package.
import { load as loadCapnCpp } from "../../../js/browser.mjs";
// @ts-ignore — runtime dynamic schema/reader.
import { defineSchema, encodeDynamic, openDynamic } from "../../../js/dynamic.mjs";

// ---- Schema -----------------------------------------------------------

const ENVELOPE_SCHEMA = defineSchema(
  {
    speaker: { kind: "text", slot: 0 },
    body:    { kind: "text", slot: 1 },
    replyTo: { kind: "text", slot: 2 },
  },
  { dataWords: 0, ptrWords: 3 },
);

// ---- Capnwasm runtime bootstrap --------------------------------------

let cppPromise: Promise<any> | null = null;
let cppInstance: any = null;

function getCpp(): Promise<any> {
  if (cppInstance) return Promise.resolve(cppInstance);
  if (cppPromise) return cppPromise;
  cppPromise = loadCapnCpp(new URL("/capnp.slim.wasm", location.origin)).then((cpp) => {
    cppInstance = cpp;
    return cpp;
  });
  return cppPromise;
}

// ---- Public API -------------------------------------------------------

export interface CapnwasmStats {
  jsonBytes:   number;
  capnpBytes:  number;
  encodeMs:    number;
  decodeMs:    number;
}

export interface PreparedEnvelope {
  /** capnwasm-decoded Reader, Proxy-wrapped so `env.body` works. */
  reader: any;
  /** Same payload as a plain JS object. */
  json:   { speaker: string; body: string; replyTo: string };
  /** Wire bytes produced by capnwasm. */
  bytes:  Uint8Array;
  /** Stats for the page's wire panel. */
  stats:  CapnwasmStats;
}

/**
 * Encode a chat envelope through capnwasm and return a Reader the
 * receiver can decode field-by-field. The Reader is wrapped in a Proxy
 * so `env.speaker` / `env.body` / `env.replyTo` translate to wasm
 * Text-pointer derefs, not plain JS object access.
 */
export async function prepareEnvelope(payload: { speaker: string; body: string; replyTo: string }): Promise<PreparedEnvelope> {
  const cpp = await getCpp();
  const obj = {
    speaker: payload.speaker ?? "",
    body:    payload.body ?? "",
    replyTo: payload.replyTo ?? "",
  };
  const t0 = performance.now();
  const bytes = encodeDynamic(cpp, ENVELOPE_SCHEMA, obj) as Uint8Array;
  const t1 = performance.now();
  const rawReader = openDynamic(cpp, ENVELOPE_SCHEMA, bytes);
  const reader = wrapReader(rawReader);
  // Touch a field once so the timing reflects steady-state decode.
  void reader.body;
  const t2 = performance.now();

  const jsonBytes = JSON.stringify(obj).length;
  return {
    reader,
    json: obj,
    bytes,
    stats: {
      jsonBytes,
      capnpBytes: bytes.length,
      encodeMs:   t1 - t0,
      decodeMs:   t2 - t1,
    },
  };
}

/** Decode raw envelope bytes back into a Reader. */
export async function decodeEnvelope(bytes: Uint8Array): Promise<any> {
  const cpp = await getCpp();
  const rawReader = openDynamic(cpp, ENVELOPE_SCHEMA, bytes);
  return wrapReader(rawReader);
}

function wrapReader(rawReader: any): any {
  // capnwasm's DynamicReader exposes pick/get/toObject — not direct
  // property getters. Proxy so `env.body` translates to reader.get(name)
  // (a real wasm Text-pointer deref) rather than returning undefined.
  return new Proxy(rawReader, {
    get(target: any, prop: string | symbol) {
      if (typeof prop !== "string") return target[prop];
      if (prop in target && typeof target[prop] === "function") {
        return target[prop].bind(target);
      }
      try { return target.get(prop); } catch { return undefined; }
    },
  });
}

/** Pretty-format the stats for the inline wire panel. */
export function formatStats(s: CapnwasmStats): string {
  const ratio = s.jsonBytes > 0 ? (s.capnpBytes / s.jsonBytes) : 1;
  const sign = ratio < 1 ? "saved" : "added";
  const pct = (Math.abs(1 - ratio) * 100).toFixed(0);
  return `capnwasm: ${s.capnpBytes} B  ·  JSON: ${s.jsonBytes} B  ·  ` +
         `${pct}% ${sign}  ·  encode ${s.encodeMs.toFixed(2)} ms  ·  decode ${s.decodeMs.toFixed(2)} ms`;
}
