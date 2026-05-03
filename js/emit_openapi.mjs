// manifest → canonical OpenAPI 3.x emitter.
//
// Input: a manifest produced by buildManifest(). When the manifest carries
// the `openapi` sidecar (present whenever the source format was
// "openapi"), this emitter reproduces a canonicalized OpenAPI doc from
// it. When the sidecar is absent (source was .capnp or @rest TS), the
// emitter reconstructs an OpenAPI doc from the canonical restApis block.
//
// Canonicalization makes the round-trip diffable:
//   • object keys sorted (with a known top-level ordering for OpenAPI)
//   • undefined / null leaves stripped
//   • whitespace normalized via JSON.stringify(_, _, 2)
//
// What this emitter promises:
//   • OpenAPI source → manifest → emit-openapi diffs to zero on the
//     structural keys (paths, components, info, servers, security, tags).
//   • capnp / @rest TS source → emit-openapi produces a valid OpenAPI 3.0
//     doc covering operations + reachable types.

const TOP_KEY_ORDER = [
  "openapi",
  "info",
  "servers",
  "security",
  "tags",
  "paths",
  "components",
  "externalDocs",
];

const PATH_VERB_ORDER = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/**
 * Build the canonical OpenAPI document object from a manifest.
 * @param {object} manifest
 * @returns {object} OpenAPI 3.x JSON-serializable object
 */
export function buildOpenApi(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("emit-openapi: manifest must be an object");
  }

  let doc;
  if (manifest.openapi && typeof manifest.openapi === "object") {
    doc = canonicalize(manifest.openapi);
  } else {
    doc = reconstructFromManifest(manifest);
  }
  return reorderTopLevel(doc);
}

/** Convenience: build + JSON-serialize. */
export function buildOpenApiJson(manifest) {
  return JSON.stringify(buildOpenApi(manifest), null, 2) + "\n";
}

// --- Canonicalization ----------------------------------------------------

function canonicalize(node) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map(canonicalize);
  if (typeof node !== "object") return node;
  const out = {};
  // Stable key order: alphabetical except for a few well-known fields
  // that OpenAPI tools expect first (openapi, info, etc., handled at top
  // level by reorderTopLevel; here we sort everything else).
  const keys = Object.keys(node).sort();
  for (const k of keys) {
    const v = canonicalize(node[k]);
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function reorderTopLevel(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const out = {};
  for (const k of TOP_KEY_ORDER) {
    if (k in doc) out[k] = doc[k];
  }
  // Preserve any extra top-level keys (custom extensions like x-*).
  for (const k of Object.keys(doc)) {
    if (!(k in out)) out[k] = doc[k];
  }
  // Inside paths, reorder verbs in conventional sequence so diffs are stable.
  if (out.paths && typeof out.paths === "object") {
    out.paths = reorderPathsVerbs(out.paths);
  }
  return out;
}

function reorderPathsVerbs(paths) {
  const out = {};
  for (const p of Object.keys(paths).sort()) {
    const item = paths[p];
    if (!item || typeof item !== "object") {
      out[p] = item;
      continue;
    }
    const next = {};
    // Path-level keys first (parameters, summary, description, $ref, servers)
    // in alphabetical order, then verbs in conventional order.
    const verbs = new Set(PATH_VERB_ORDER);
    const nonVerbs = Object.keys(item).filter((k) => !verbs.has(k)).sort();
    for (const k of nonVerbs) next[k] = item[k];
    for (const v of PATH_VERB_ORDER) if (v in item) next[v] = item[v];
    out[p] = next;
  }
  return out;
}

// --- Reconstruction (capnp / @rest TS source) ----------------------------
//
// Used when the manifest came from a non-OpenAPI source. Produces a best-
// effort OpenAPI 3.0 doc from the canonical restApis array.

function reconstructFromManifest(manifest) {
  const api = (manifest.restApis ?? [])[0];
  const apiName = api?.name ?? manifest?.metadata?.title ?? "API";
  const baseUrl = api?.baseUrl ?? "";
  const version = manifest?.metadata?.version ?? "0.0.0";

  const doc = {
    openapi: "3.0.3",
    info: { title: apiName, version },
    paths: {},
  };
  if (baseUrl) doc.servers = [{ url: baseUrl }];

  // Index every named struct in the manifest so per-operation $refs
  // resolve and the components.schemas block can be assembled.
  // Capnp's auto-generated `<method>$Params` / `<method>$Results` names
  // contain `$`, which OpenAPI tools can choke on. Index by both the
  // capnp name and a sanitized PascalCase form so refs against either
  // shape resolve, and emit components under the sanitized name.
  const structIndex = new Map();
  for (const s of manifest.structs ?? []) {
    structIndex.set(s.name, s);
    const sanitized = sanitizeOpenapiName(s.name);
    if (sanitized !== s.name) structIndex.set(sanitized, s);
  }

  // Track which structs got referenced; only emit those (plus their
  // transitive deps) under components.schemas. Avoids dumping every
  // capnp $Params / $Results auto-generated struct unless an operation
  // actually points at it.
  const referenced = new Set();
  for (const m of api?.methods ?? []) {
    const path = m.path ?? "/";
    if (!doc.paths[path]) doc.paths[path] = {};
    const verb = (m.httpMethod ?? "GET").toLowerCase();
    doc.paths[path][verb] = reconstructOperation(m, structIndex, referenced);
  }

  if (referenced.size > 0) {
    const schemas = {};
    // Walk transitively: a referenced struct may itself reference
    // others. Add until the closure is complete.
    const queue = [...referenced];
    const closure = new Set(referenced);
    while (queue.length > 0) {
      const name = queue.shift();
      const s = structIndex.get(name);
      if (!s) continue;
      // Always emit components.schemas keys in sanitized form so the
      // OpenAPI doc reads naturally even when the source had `$` in
      // its capnp struct names.
      const key = sanitizeOpenapiName(s.name);
      schemas[key] = structToOpenApiSchema(s, structIndex);
      for (const dep of structDependencies(s)) {
        if (!closure.has(dep) && structIndex.has(dep)) {
          closure.add(dep);
          queue.push(dep);
        }
      }
    }
    doc.components = { schemas };
  }

  return canonicalize(doc);
}

function reconstructOperation(m, structIndex, referenced) {
  const op = {
    operationId: m.operationId ?? m.name,
    parameters: [],
    responses: {
      "200": { description: "OK" },
    },
  };

  // Group body fields together so we can emit one combined requestBody
  // schema. Multiple non-path params on POST/PUT/PATCH all describe a
  // single JSON body whose properties are the param names.
  const bodyFields = [];
  for (const p of m.params ?? []) {
    if (p.in === "body") {
      bodyFields.push(p);
      continue;
    }
    op.parameters.push({
      name: p.wireName ?? p.name,
      in: p.in,
      required: !!p.required,
      schema: typeToOpenApi(p.type, structIndex, referenced),
    });
  }
  if (op.parameters.length === 0) delete op.parameters;

  if (bodyFields.length === 1 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(bodyFields[0].type)) && structIndex?.has(bodyFields[0].type)) {
    // Single body param whose type is a known struct: $ref it directly.
    op.requestBody = {
      required: !!bodyFields[0].required,
      content: { "application/json": { schema: typeToOpenApi(bodyFields[0].type, structIndex, referenced) } },
    };
  } else if (bodyFields.length > 0) {
    // Multiple body fields (or a single primitive body): synthesize an
    // inline object schema so the request body is well-typed.
    const properties = {};
    const required = [];
    for (const p of bodyFields) {
      properties[p.name] = typeToOpenApi(p.type, structIndex, referenced);
      if (p.required) required.push(p.name);
    }
    const schema = { type: "object", properties };
    if (required.length > 0) schema.required = required;
    op.requestBody = {
      required: true,
      content: { "application/json": { schema } },
    };
  }

  if (m.returnType && m.returnType !== "void" && m.returnType !== "unknown") {
    op.responses["200"] = {
      description: "OK",
      content: { "application/json": { schema: typeToOpenApi(m.returnType, structIndex, referenced) } },
    };
  } else if (m.returnType === "void") {
    op.responses = { "204": { description: "No Content" } };
  }
  return op;
}

function typeToOpenApi(t, structIndex, referenced) {
  // Translate a manifest field/return type into an OpenAPI schema
  // fragment. Recognized inputs:
  //   • capnp primitives (Text, Bool, Int32, Float64, Data, etc.)
  //   • TS-string types from the @rest TS parser (string, number, ...)
  //   • List(X) / X[] containers
  //   • named struct refs (becomes a $ref into components.schemas)
  if (!t || t === "unknown") return {};

  // capnp primitives.
  const cp = CAPNP_PRIMITIVE_OPENAPI[t];
  if (cp) return { ...cp };

  // List(X) capnp form.
  const lm = String(t).match(/^List\(([^)]+)\)$/);
  if (lm) return { type: "array", items: typeToOpenApi(lm[1], structIndex, referenced) };

  // TS-array form.
  if (typeof t === "string" && t.endsWith("[]")) {
    return { type: "array", items: typeToOpenApi(t.slice(0, -2), structIndex, referenced) };
  }

  // Nullable suffix from TS-string types.
  if (typeof t === "string" && t.endsWith(" | null")) {
    const inner = typeToOpenApi(t.slice(0, -" | null".length), structIndex, referenced);
    return { ...inner, nullable: true };
  }

  // TS primitive type-string aliases.
  if (t === "string")  return { type: "string" };
  if (t === "number")  return { type: "number" };
  if (t === "boolean") return { type: "boolean" };
  if (t === "void")    return {};
  if (t === "Uint8Array") return { type: "string", format: "binary" };
  if (t === "bigint")  return { type: "string", format: "int64" };

  // Struct ref. Record it for components.schemas emission and emit a
  // $ref pointing at the sanitized key the components block will use.
  if (typeof t === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) {
    const sanitized = sanitizeOpenapiName(t);
    if (structIndex?.has(t) || structIndex?.has(sanitized)) referenced?.add(t);
    return { $ref: `#/components/schemas/${sanitized}` };
  }
  return {};
}

function sanitizeOpenapiName(name) {
  return String(name)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const CAPNP_PRIMITIVE_OPENAPI = {
  Bool:    { type: "boolean" },
  Text:    { type: "string" },
  Data:    { type: "string", format: "byte" },
  Void:    {},
  Int8:    { type: "integer", minimum: -128, maximum: 127 },
  Int16:   { type: "integer", minimum: -32768, maximum: 32767 },
  Int32:   { type: "integer", format: "int32" },
  Int64:   { type: "string", format: "int64" },
  UInt8:   { type: "integer", minimum: 0, maximum: 255 },
  UInt16:  { type: "integer", minimum: 0, maximum: 65535 },
  UInt32:  { type: "integer", minimum: 0, maximum: 4294967295 },
  UInt64:  { type: "string", format: "int64", minimum: 0 },
  Float32: { type: "number", format: "float" },
  Float64: { type: "number", format: "double" },
};

function structToOpenApiSchema(s, structIndex) {
  // Convert one manifest struct to a JSON-Schema-shaped object suitable
  // for components.schemas. Fields → properties; everything required by
  // default (capnp has no nullable concept; consumers can post-process).
  const properties = {};
  for (const f of s.fields ?? []) {
    properties[f.name] = typeToOpenApi(f.type, structIndex, /*track*/ null);
  }
  return {
    type: "object",
    properties,
    ...(s.fields?.length > 0 ? { required: (s.fields ?? []).map((f) => f.name) } : {}),
  };
}

function structDependencies(s) {
  // Collect every named struct ref appearing in the struct's fields,
  // including those inside List(X) wrappers. Used to walk the
  // transitive closure when emitting components.schemas.
  const out = [];
  for (const f of s.fields ?? []) {
    const t = f.type;
    if (!t) continue;
    if (CAPNP_PRIMITIVE_OPENAPI[t]) continue;
    const lm = String(t).match(/^List\(([^)]+)\)$/);
    if (lm) {
      if (!CAPNP_PRIMITIVE_OPENAPI[lm[1]]) out.push(lm[1]);
      continue;
    }
    if (typeof t === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) out.push(t);
  }
  return out;
}
