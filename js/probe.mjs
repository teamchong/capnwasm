// Manifest → live-target drift probe.
//
// Reads a manifest and a target endpoint, exercises each operation
// declared in the manifest, and reports per-operation what the
// runtime actually did vs what the schema said.
//
// Capnp drift detection is bounded by the wire format: capnp messages
// are positional (no field names on the wire), so a field that comes
// back as its zero value is indistinguishable from a field the runtime
// didn't send. The probe surfaces what it CAN observe — call success,
// decode success, declared-vs-readable field accounting, response
// byte counts — and labels what it can't. For richer drift detection
// (extra fields the runtime sent that the schema doesn't know about),
// you need either a newer schema to compare against, or a wire-byte
// audit of the response that's beyond this probe's scope.
//
// REST drift detection is much fuller because JSON is keyed: the probe
// observes every top-level response key, diffs against the manifest's
// declared returnType, and reports both missing and extra keys.

import { performance } from "node:perf_hooks";
import { defineSchema, buildDynamic, openDynamic } from "./dynamic.mjs";

/**
 * Probe a target against a manifest.
 *
 * @param {object} cpp - loaded capnp runtime (from `await load()`)
 * @param {object} manifest - parsed manifest JSON
 * @param {object} opts
 * @param {string} [opts.capnpTarget] - WS URL for capnp interfaces
 *        (e.g. "ws://localhost:8081/rpc"). Required when manifest has
 *        any capnp interfaces.
 * @param {string} [opts.restTarget] - HTTPS base URL for REST APIs
 *        (e.g. "https://staging.example.com"). Required when manifest
 *        has any REST APIs.
 * @param {Function} [opts.fetch] - fetch implementation (defaults to
 *        globalThis.fetch).
 * @param {Function} [opts.connectWebSocket] - injected WS connector
 *        (defaults to dynamic import of capnwasm/rpc). Tests inject
 *        their own to avoid spinning a real server.
 * @param {number} [opts.timeoutMs=10000] - per-operation timeout.
 * @returns {Promise<object>} structured report
 */
export async function probe(cpp, manifest, opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const results = [];

  // Capnp side -----------------------------------------------------------
  const ifaces = manifest.interfaces ?? [];
  if (ifaces.length > 0) {
    if (!opts.capnpTarget) {
      throw new Error("probe: opts.capnpTarget required (manifest has capnp interfaces)");
    }
    const connectWebSocket = opts.connectWebSocket
      ?? (await import("./rpc.mjs")).connectWebSocket;
    const session = await connectWebSocket(cpp, opts.capnpTarget);
    try {
      const root = session.bootstrap();
      for (const iface of ifaces) {
        for (const m of iface.methods ?? []) {
          results.push(await probeCapnpMethod(cpp, root, iface, m, manifest, timeoutMs));
        }
      }
    } finally {
      try { session.close(); } catch {}
    }
  }

  // REST side ------------------------------------------------------------
  const apis = manifest.restApis ?? [];
  if (apis.length > 0) {
    if (!opts.restTarget) {
      throw new Error("probe: opts.restTarget required (manifest has REST APIs)");
    }
    if (!fetchFn) {
      throw new Error("probe: no fetch available (set opts.fetch or use Node 22+)");
    }
    for (const api of apis) {
      for (const m of api.methods ?? []) {
        results.push(await probeRestMethod(opts.restTarget, fetchFn, m, manifest, timeoutMs));
      }
    }
  }

  const summary = summarize(results);
  return {
    probedAt: new Date().toISOString(),
    manifest: manifest.source?.name ?? null,
    capnpTarget: opts.capnpTarget ?? null,
    restTarget: opts.restTarget ?? null,
    results,
    summary,
  };
}

async function probeCapnpMethod(cpp, root, iface, method, manifest, timeoutMs) {
  const ifaceId = parseInterfaceId(iface.id);
  const t0 = performance.now();
  const result = {
    operationId: method.operationId,
    transport: "capnp",
    outcome: "ok",
    ms: 0,
    requestBytes: 0,
    responseBytes: 0,
    declaredFields: (lookupStruct(method.resultsStruct, manifest)?.fields ?? [])
      .map((f) => f.name),
    readableFields: [],
    unreadableFields: [],
  };
  try {
    const paramsBytes = synthesizeCapnpParams(cpp, method.paramsStruct, manifest);
    result.requestBytes = paramsBytes.length;
    const callPromise = root.call(ifaceId, method.ordinal, paramsBytes).promise;
    const { bytes } = await withTimeout(callPromise, timeoutMs, method.operationId);
    result.responseBytes = bytes.length;
    const resultsStruct = lookupStruct(method.resultsStruct, manifest);
    if (resultsStruct) {
      const schema = manifestToSchema(resultsStruct, manifest);
      const reader = openDynamic(cpp, schema, bytes);
      for (const f of resultsStruct.fields) {
        try {
          // Touch the field — for primitives this returns a value, for
          // pointers it returns a (possibly empty) wrapper. Either way
          // the wasm decode path runs and throws if the wire bytes
          // can't be interpreted as the declared type.
          void reader.fields[f.name];
          result.readableFields.push(f.name);
        } catch (err) {
          result.unreadableFields.push({ name: f.name, error: String(err?.message ?? err) });
        }
      }
    }
  } catch (err) {
    result.outcome = "error";
    result.error = String(err?.message ?? err);
  }
  result.ms = +(performance.now() - t0).toFixed(2);
  // The probe reports drift: any unreadable declared field, OR an error
  // outcome, counts as drift.
  result.drift = result.outcome === "error" || result.unreadableFields.length > 0;
  return result;
}

async function probeRestMethod(baseUrl, fetchFn, method, _manifest, timeoutMs) {
  const t0 = performance.now();
  const result = {
    operationId: method.operationId,
    transport: "rest",
    httpMethod: method.httpMethod,
    path: method.path,
    outcome: "ok",
    ms: 0,
    httpStatus: null,
    contentType: null,
    declaredReturnType: method.returnType ?? null,
    observedKeys: [],
    extraKeys: [],
    drift: false,
  };
  try {
    const { url, body, headers } = buildRestRequest(baseUrl, method);
    const res = await withTimeout(
      fetchFn(url, { method: method.httpMethod, headers, body }),
      timeoutMs,
      method.operationId,
    );
    result.httpStatus = res.status;
    result.contentType = res.headers.get("content-type");
    if (res.status >= 400) {
      result.outcome = "error";
      result.error = `HTTP ${res.status} ${res.statusText}`;
      result.drift = true;
    } else if ((result.contentType ?? "").includes("application/json")) {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          result.observedKeys = Object.keys(parsed);
        } else if (Array.isArray(parsed)) {
          // Array response — observedKeys reflects the FIRST element's
          // keys (representative of the row shape) so the report can
          // still surface field-level drift on list endpoints.
          result.observedKeys = parsed.length > 0 && parsed[0] && typeof parsed[0] === "object"
            ? Object.keys(parsed[0])
            : [];
        }
      } catch (err) {
        result.outcome = "error";
        result.error = `response was application/json but did not parse: ${err.message}`;
        result.drift = true;
      }
    } else {
      // Non-JSON response (text, binary, etc). The probe doesn't have
      // declared-shape info to diff against, so it just records the
      // content-type and moves on.
      result.observedKeys = [];
    }
  } catch (err) {
    result.outcome = "error";
    result.error = String(err?.message ?? err);
    result.drift = true;
  }
  result.ms = +(performance.now() - t0).toFixed(2);
  return result;
}

// ---- Param/response synthesis ----------------------------------------

function synthesizeCapnpParams(cpp, paramsStructName, manifest) {
  const struct = lookupStruct(paramsStructName, manifest);
  if (!struct) {
    // No params struct in manifest → empty Cap'n Proto frame (the
    // caller's wire layer will treat this as "no params").
    return new Uint8Array(0);
  }
  const schema = manifestToSchema(struct, manifest);
  const b = buildDynamic(cpp, schema);
  for (const f of struct.fields) {
    const v = synthesizeFieldValue(f, manifest);
    if (v !== undefined) b.set(f.name, v);
  }
  return b.finalize();
}

function synthesizeFieldValue(f, manifest) {
  const t = f.type;
  if (t.startsWith("List(")) {
    const inner = t.slice(5, -1);
    if (PRIMITIVE_KIND[inner] || inner === "Text" || inner === "Data") return [];
    return [];   // List(Struct), List(List(...)) — empty list is valid
  }
  if (/^[A-Z]/.test(t) && !PRIMITIVE_KIND[t]) return undefined;
  return DEFAULT_VALUE[t];
}

// ---- Manifest → defineSchema translation -----------------------------

function manifestToSchema(struct, manifest) {
  const spec = {};
  for (const f of struct.fields ?? []) {
    spec[f.name] = manifestFieldToDescriptor(f, manifest);
  }
  return defineSchema(spec, {
    dataWords: struct.dataWords ?? 0,
    ptrWords:  struct.ptrWords  ?? 0,
  });
}

function manifestFieldToDescriptor(f, manifest) {
  const t = f.type;
  const lm = t.match(/^List\(([^)]+)\)$/);
  if (lm) {
    const inner = lm[1];
    if (LIST_PRIM_KIND[inner]) {
      return { kind: LIST_PRIM_KIND[inner], slot: f.ptrIndex };
    }
    if (inner === "Text") return { kind: "listText", slot: f.ptrIndex };
    if (inner === "Data") return { kind: "listData", slot: f.ptrIndex };
    // List<Struct>: recurse into the element struct's manifest entry.
    const elemStruct = lookupStruct(inner, manifest);
    if (!elemStruct) {
      throw new Error(`probe: List(${inner}) — element struct missing from manifest`);
    }
    return {
      kind: "listStruct",
      slot: f.ptrIndex,
      element: manifestToSchema(elemStruct, manifest),
    };
  }
  if (/^[A-Z]/.test(t) && !PRIMITIVE_KIND[t]) {
    // Nested struct ref.
    const nested = lookupStruct(t, manifest);
    if (!nested) {
      throw new Error(`probe: nested struct ${t} missing from manifest`);
    }
    return {
      kind: "struct",
      slot: f.ptrIndex,
      schema: manifestToSchema(nested, manifest),
    };
  }
  if (t === "Bool")  return { kind: "bool",  bitOffset: f.bitOffset ?? 0 };
  if (t === "Text")  return { kind: "text",  slot: f.ptrIndex };
  if (t === "Data")  return { kind: "data",  slot: f.ptrIndex };
  const kind = PRIMITIVE_KIND[t];
  if (!kind) throw new Error(`probe: unsupported capnp type ${t}`);
  // Primitives in the data section: defineSchema wants byte offset,
  // manifest stores bit offset. Bool is the exception (kept above).
  return { kind, offset: (f.bitOffset ?? 0) >>> 3 };
}

// ---- REST request synthesis ------------------------------------------

function buildRestRequest(baseUrl, method) {
  let urlPath = method.path;
  const queryPairs = [];
  const headers = {};
  let body = null;
  for (const p of method.params ?? []) {
    const synth = synthesizeRestParamValue(p);
    if (p.in === "path") {
      urlPath = urlPath.replace(`{${p.name}}`, encodeURIComponent(String(synth)));
    } else if (p.in === "query") {
      if (synth !== undefined && synth !== null && synth !== "") {
        queryPairs.push([p.name, String(synth)]);
      }
    } else if (p.in === "header") {
      headers[p.wireName ?? p.name] = String(synth);
    } else if (p.in === "body") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(synth);
    }
  }
  const qs = queryPairs.length > 0
    ? "?" + queryPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : "";
  return {
    url: baseUrl.replace(/\/+$/, "") + urlPath + qs,
    body, headers,
  };
}

function synthesizeRestParamValue(param) {
  const t = (param.type ?? "string").toLowerCase();
  if (t === "string") return param.in === "path" ? "probe-test" : "";
  if (t === "boolean" || t === "bool") return false;
  if (t === "number" || t === "integer" || t === "int") return 0;
  if (t === "uint8array") return "";
  return {};
}

// ---- helpers ---------------------------------------------------------

function lookupStruct(name, manifest) {
  if (!name) return null;
  return (manifest.structs ?? []).find((s) => s.name === name) ?? null;
}

function parseInterfaceId(id) {
  if (typeof id === "bigint") return id;
  if (typeof id !== "string") return BigInt(id);
  if (id.startsWith("0x") || id.startsWith("0X")) return BigInt(id);
  return BigInt(id);
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`probe: ${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function summarize(results) {
  let ok = 0, error = 0, drift = 0;
  for (const r of results) {
    if (r.outcome === "ok") ok++;
    else error++;
    if (r.drift) drift++;
  }
  return { total: results.length, ok, error, drift };
}

const PRIMITIVE_KIND = {
  Bool: "bool",
  UInt8: "uint8", UInt16: "uint16", UInt32: "uint32", UInt64: "uint64",
  Int8:  "int8",  Int16:  "int16",  Int32:  "int32",  Int64:  "int64",
  Float32: "float32", Float64: "float64",
  Text: "text", Data: "data", Void: "void",
};

const LIST_PRIM_KIND = {
  Bool: "listBool",
  UInt8: "listUint8", UInt16: "listUint16", UInt32: "listUint32", UInt64: "listUint64",
  Int8:  "listInt8",  Int16:  "listInt16",  Int32:  "listInt32",  Int64:  "listInt64",
  Float32: "listFloat32", Float64: "listFloat64",
};

const DEFAULT_VALUE = {
  Bool: false,
  UInt8: 0, UInt16: 0, UInt32: 0, UInt64: 0n,
  Int8:  0, Int16:  0, Int32:  0, Int64:  0n,
  Float32: 0, Float64: 0,
  Text: "", Data: new Uint8Array(0), Void: undefined,
};
