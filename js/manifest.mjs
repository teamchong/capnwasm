// Operation manifest builder.
//
// Takes the parsed schema model that bin/capnwasm.mjs already produces
// during codegen and emits a canonical JSON document that downstream
// tools (drift detectors, mock generators, doc generators, MCP servers,
// contract test harnesses) can consume without re-parsing the source
// schema themselves.
//
// One shape across all three input formats. .capnp interfaces, TS @rest
// interfaces, and OpenAPI specs all emit the same envelope. Consumers
// don't need to know which source produced the manifest.
//
// Designed to grow: per-operation `extensions` and per-manifest `metadata`
// are arbitrary string-keyed objects so future @-directives can plumb
// owner, gitUrl, examples, safeToTest, deprecation/sunset, etc. without
// version-bumping the schema.

const MANIFEST_VERSION = 1;

/**
 * Build a manifest object from the parsed model.
 *
 * @param {object} model - { structs, interfaces?, restApis?, typeInterfaces? }
 *                         as returned by parseSchema / parseOpenApi.
 * @param {object} opts
 * @param {string} opts.source.name - schema filename or display name
 * @param {string} opts.source.format - "capnp" | "typescript-rest" | "openapi"
 * @param {string} [opts.source.path] - absolute path of the source if available
 * @param {object} [opts.metadata] - free-form per-manifest metadata
 *                                   (owner team, repo URL, version, ...)
 * @returns {object} manifest object. JSON-serializable
 */
export function buildManifest(model, opts) {
  if (!opts?.source?.name || !opts?.source?.format) {
    throw new Error("buildManifest: opts.source.name + opts.source.format are required");
  }
  const out = {
    manifestVersion: MANIFEST_VERSION,
    source: {
      name: opts.source.name,
      format: opts.source.format,
      generatedAt: new Date().toISOString(),
    },
    metadata: opts.metadata ?? {},
    structs: [],
    interfaces: [],
    restApis: [],
  };
  if (opts.source.path) out.source.path = opts.source.path;

  for (const s of model.structs ?? []) {
    out.structs.push(structToManifest(s));
  }
  for (const iface of model.interfaces ?? []) {
    out.interfaces.push(interfaceToManifest(iface));
  }
  for (const api of model.restApis ?? []) {
    out.restApis.push(restApiToManifest(api));
  }
  return out;
}

function structToManifest(s) {
  // Strip codegen-internal scratch (ptrIndex / byteOffset / kind) into a
  // stable shape. Consumers care about wire layout (data/ptr words +
  // ordinal + type) and field name, not which path through the codegen
  // produced them.
  const fields = (s.fields ?? []).map(fieldToManifest);
  const out = {
    name: s.name,
    fields,
  };
  // Layout dimensions if computeOffsets() has run. Both codegen + dynamic
  // builder use these; manifest consumers (mock generator, contract
  // harness) need them too.
  if (typeof s.dataWords === "number") out.dataWords = s.dataWords;
  if (typeof s.ptrWords  === "number") out.ptrWords  = s.ptrWords;
  return out;
}

function fieldToManifest(f) {
  const out = {
    name: f.name,
    ordinal: f.ordinal,
    type: f.type,
  };
  if (f.kind) out.kind = f.kind;             // "data" | "pointer" | "void"
  if (typeof f.bitOffset === "number") out.bitOffset = f.bitOffset;
  if (typeof f.ptrIndex  === "number") out.ptrIndex  = f.ptrIndex;
  return out;
}

function interfaceToManifest(iface) {
  return {
    name: iface.name,
    // capnpc IDs are 64-bit unsigned; always serialize as 0x-prefixed
    // string so JSON consumers don't lose precision (Number can't hold
    // the full 64 bits for IDs > 2^53) and the format is uniform whether
    // capnpc gave us a BigInt, a decimal string, or a hex string.
    id: normalizeInterfaceId(iface.id),
    methods: (iface.methods ?? []).map((m) => methodToManifest(iface.name, m)),
  };
}

function normalizeInterfaceId(raw) {
  if (typeof raw === "bigint") return "0x" + raw.toString(16);
  if (typeof raw !== "string") return String(raw);
  if (raw.startsWith("0x") || raw.startsWith("0X")) return "0x" + raw.slice(2).toLowerCase();
  // Decimal string from capnpc. Convert via BigInt (no precision loss).
  try { return "0x" + BigInt(raw).toString(16); }
  catch { return raw; }   // unparseable; pass through unchanged
}

function methodToManifest(ifaceName, m) {
  return {
    operationId: `${ifaceName}.${m.name}`,
    name: m.name,
    ordinal: m.id,
    // capnpc emits param/result struct displayName as
    // "<methodName>$Params" / "<methodName>$Results"; manifest consumers
    // wanting to look up the full struct schema cross-reference these.
    paramsStruct: `${m.name}$Params`,
    resultsStruct: `${m.name}$Results`,
    extensions: {},
  };
}

function restApiToManifest(api) {
  return {
    name: api.name,
    baseUrl: api.baseUrl ?? null,
    defaults: api.defaults ?? {},
    methods: (api.methods ?? []).map((m) => restMethodToManifest(api.name, m)),
  };
}

function restMethodToManifest(apiName, m) {
  const out = {
    operationId: `${apiName}.${m.name}`,
    name: m.name,
    httpMethod: (m.method ?? "GET").toUpperCase(),
    path: m.path,
    params: (m.params ?? []).map(restParamToManifest),
    returnType: m.returnType ?? null,
    extensions: {},
  };
  if (m.isAsyncIterable) out.isAsyncIterable = true;
  if (m.paginated)       out.paginated = m.paginated;
  if (m.bodyEncoding)    out.bodyEncoding = m.bodyEncoding;
  if (m.decode)          out.decode = m.decode;
  return out;
}

function restParamToManifest(p) {
  // Both .ts @rest and OpenAPI param shapes use the same field names
  // (name/type/role|in/optional). Normalize to OpenAPI's `in` since that
  // matches the convention most external tools recognize.
  const out = {
    name: p.name,
    in: p.role ?? p.in ?? "query",
    type: p.type ?? null,
    required: p.required === true || p.optional === false,
  };
  if (p.wireName) out.wireName = p.wireName;
  return out;
}

/**
 * Convenience: build manifest + JSON-serialize in one call. The returned
 * string ends with a trailing newline (CLI / file-write friendly).
 */
export function buildManifestJson(model, opts) {
  return JSON.stringify(buildManifest(model, opts), null, 2) + "\n";
}
