// Bridge between the live editor and capnwasm itself.
//
// Each endpoint's mocked response (read out of openapi.json) is passed
// through capnwasm before reaching the user's `format(response)`:
//
//   mock JSON  ──encodeViaCapnwasm──▶  Cap'n Proto wire bytes
//                                                 │
//                                                 ▼
//                                openViaCapnwasm: capnwasm Reader
//                                                 │
//                                                 ▼
//                                  user's `format(response)`
//                                  reads response.success,
//                                  response.resultJson, …
//
// The schema is a small generic envelope — Cloudflare's API uniformly
// wraps responses as `{ success, result, errors, messages }`, so we
// encode the whole mock as that envelope. `result`, `errors`, and
// `messages` are stored as Data slots holding their JSON bytes; the
// user reads them via the capnwasm Reader and JSON.parse the inner
// payload when they need its shape. Booleans get the only data word.
//
// Why this matters for the playground: the user's JS code literally
// calls into the capnwasm wasm runtime — `response.success` is a wasm
// boolean read; `response.resultJson` is a wasm Data-pointer deref —
// instead of plain JS object access. The page is therefore an honest
// demo of capnwasm being on the read path, not just a playground
// hosted on the capnwasm site.

// @ts-ignore — capnwasm browser entry; ships with the package.
import { load as loadCapnCpp } from "../../../js/browser.mjs";
// @ts-ignore — runtime dynamic schema/reader.
import { defineSchema, encodeDynamic, openDynamic } from "../../../js/dynamic.mjs";

// ---- Envelope schema ----------------------------------------------------

// One word of data (8 bytes) holds the success flag at bit 0; everything
// else lives in the pointer section as slot-indexed Data fields.
const ENVELOPE_SCHEMA = defineSchema(
  {
    success:      { kind: "bool", bitOffset: 0 },
    resultJson:   { kind: "data", slot: 0 },
    errorsJson:   { kind: "data", slot: 1 },
    messagesJson: { kind: "data", slot: 2 },
    endpointId:   { kind: "text", slot: 3 },
  },
  { dataWords: 1, ptrWords: 4 },
);

// ---- Capnwasm runtime bootstrap ----------------------------------------

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

// ---- Public API --------------------------------------------------------

const ENC = new TextEncoder();

export interface CapnwasmStats {
  jsonBytes:   number;   // size of the mock as JSON
  capnpBytes:  number;   // size encoded via capnwasm
  encodeMs:    number;   // time spent in capnwasm encode
  decodeMs:    number;   // time spent in capnwasm decode (estimated)
}

export interface PreparedResponse {
  /** capnwasm-decoded Reader. The user's JS `format(response)` gets this. */
  reader: any;
  /** Same payload as a plain JS object; non-JS runtimes use this until
   *  a cross-language Reader bridge lands. */
  json: unknown;
  /** Wire bytes produced by capnwasm. Useful for the size-comparison panel. */
  bytes: Uint8Array;
  /** Stats for the page's "capnwasm did this" panel. */
  stats: CapnwasmStats;
}

/**
 * Take a mock response (JSON-shaped JS object) and return its
 * capnwasm-encoded form along with a live Reader the editor can hand
 * to the user's `format(response)`.
 */
export async function prepareResponse(
  endpointId: string,
  mock: unknown,
): Promise<PreparedResponse> {
  const cpp = await getCpp();

  // Standard Cloudflare envelope: split the mock into the four named
  // pieces, keep their JSON form for the user to traverse normally.
  const m = (mock ?? {}) as Record<string, unknown>;
  const result   = m["result"]   ?? null;
  const success  = m["success"];
  const errors   = m["errors"]   ?? [];
  const messages = m["messages"] ?? [];

  const resultJsonStr   = JSON.stringify(result);
  const errorsJsonStr   = JSON.stringify(errors);
  const messagesJsonStr = JSON.stringify(messages);

  const obj = {
    success:      success === true || success === "true",
    resultJson:   ENC.encode(resultJsonStr),
    errorsJson:   ENC.encode(errorsJsonStr),
    messagesJson: ENC.encode(messagesJsonStr),
    endpointId,
  };

  const t0 = performance.now();
  const bytes = encodeDynamic(cpp, ENVELOPE_SCHEMA, obj) as Uint8Array;
  const t1 = performance.now();
  const rawReader = openDynamic(cpp, ENVELOPE_SCHEMA, bytes);
  // capnwasm's DynamicReader exposes pick/get/toObject — not direct
  // property getters. Wrap it in a Proxy so the user's editor can
  // write `response.success` / `response.resultJson` and have each
  // access translate to a real wasm read via reader.get(name). The
  // proxy passes pick/get/toObject/dispose through unchanged so
  // power users can drop down to the underlying API.
  const reader = new Proxy(rawReader, {
    get(target: any, prop: string | symbol) {
      if (typeof prop !== "string") return target[prop];
      if (prop in target && typeof target[prop] === "function") {
        return target[prop].bind(target);
      }
      try { return target.get(prop); } catch { return undefined; }
    },
  });
  // Touch one field so the Reader amortizes its initial wasm crossing
  // and the timing reflects steady-state decode cost.
  void reader.success;
  const t2 = performance.now();

  const jsonBytes = JSON.stringify(mock).length;
  const stats: CapnwasmStats = {
    jsonBytes,
    capnpBytes: bytes.length,
    encodeMs:   t1 - t0,
    decodeMs:   t2 - t1,
  };
  return { reader, json: mock, bytes, stats };
}

/** Pretty-format the stats for the inline "capnwasm wire" panel. */
export function formatStats(s: CapnwasmStats): string {
  const ratio = s.jsonBytes > 0 ? (s.capnpBytes / s.jsonBytes) : 1;
  const sign = ratio < 1 ? "saved" : "added";
  const pct = (Math.abs(1 - ratio) * 100).toFixed(0);
  return `capnwasm: ${s.capnpBytes.toLocaleString()} B  ·  JSON: ${s.jsonBytes.toLocaleString()} B  ·  ` +
         `${pct}% ${sign}  ·  encode ${s.encodeMs.toFixed(2)} ms  ·  decode ${s.decodeMs.toFixed(2)} ms`;
}
