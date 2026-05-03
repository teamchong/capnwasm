// Pagination / error-envelope adapter layer.
//
// The consume-as-is constraint (docs/unified-surfaces-design.md §
// "Constraint: consume existing OpenAPI as-is") forbids capnwasm from
// asking upstream teams to align on a pagination convention or an error
// envelope. This module detects which of the well-known patterns each
// operation uses and enriches the manifest IR with a canonical
// descriptor that downstream emitters (SDK, mock, docs) can rely on
// uniformly.
//
// Pagination patterns (canonical kinds returned in `pagination.kind`):
//
//   "cursor"       ?cursor= (or ?after= / ?before=) + a `next_cursor` /
//                  `next` field on the response.
//   "offset"       ?offset= paired with ?limit= (or ?per_page= /
//                  ?page_size=).
//   "page"         ?page= paired with ?per_page= / ?page_size= /
//                  ?limit=.
//   "page-token"   ?page_token= + a `next_page_token` field on the
//                  response.
//   "unknown"      none of the above; emitters fall back to the raw
//                  response shape.
//
// Error envelope shapes (canonical kinds in `errorShape`):
//
//   "rfc7807"      Body matches { type, title, detail, ... }.
//   "single"       Body matches { error: { code, message, ... } }.
//   "list"         Body matches { errors: [{ code, message, ... }, ...] }.
//   "passthrough"  None of the above; SDK fall back to the raw response.
//
// The detector NEVER mutates the source spec or the manifest's openapi
// sidecar. It returns a NEW manifest with one extra block per REST
// method (`pagination`) and one extra response-level field
// (`errorShape`) attached to each non-2xx response.

const PAGE_PARAMS = {
  cursor:     ["cursor", "after", "before"],
  offset:     ["offset"],
  page:       ["page"],
  pageToken:  ["page_token", "pageToken"],
};
const SIZE_PARAMS = ["limit", "per_page", "perPage", "page_size", "pageSize"];

const NEXT_RESPONSE_FIELDS = {
  cursor:    ["next_cursor", "nextCursor", "next"],
  pageToken: ["next_page_token", "nextPageToken"],
};

/**
 * Produce a NEW manifest whose REST methods are enriched with
 * `pagination` + `errorShapes` descriptors. Input manifest is not
 * mutated.
 *
 * @param {object} manifest
 * @returns {object} enriched manifest
 */
export function adapt(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("adapter: manifest must be an object");
  }
  const out = clone(manifest);
  const openapi = out.openapi;
  for (const api of out.restApis ?? []) {
    for (const m of api.methods ?? []) {
      const op = openapi ? findOpenapiOperation(openapi, m.path, m.httpMethod) : null;
      m.pagination = detectPagination(m, op, openapi);
      m.errorShapes = detectErrorShapes(op, openapi);
    }
  }
  return out;
}

/**
 * Aggregate a one-line summary across the manifest. Useful as a CLI
 * report.
 */
export function summarize(manifest) {
  const counts = {
    total: 0,
    pagination: { cursor: 0, offset: 0, page: 0, "page-token": 0, unknown: 0 },
    errors: { rfc7807: 0, single: 0, list: 0, passthrough: 0 },
  };
  for (const api of manifest.restApis ?? []) {
    for (const m of api.methods ?? []) {
      counts.total++;
      counts.pagination[m.pagination?.kind ?? "unknown"]++;
      // For error-shape, count whichever shape is most common across
      // declared responses. Operations often declare multiple non-2xx
      // codes with the same envelope.
      const shape = pickDominantErrorShape(m.errorShapes);
      counts.errors[shape ?? "passthrough"]++;
    }
  }
  return counts;
}

// --- Pagination ---------------------------------------------------------

function detectPagination(method, op, openapi) {
  // Look at the parameter set: which of the well-known param names are
  // present?
  const paramNames = new Set(
    (method.params ?? [])
      .filter((p) => p.in === "query")
      .map((p) => (p.wireName ?? p.name)),
  );
  const has = (name) => paramNames.has(name);

  const sizeParam = SIZE_PARAMS.find((n) => has(n)) ?? null;

  // Pattern: page-token (highest specificity, no overlap with the
  // others).
  if (PAGE_PARAMS.pageToken.some(has)) {
    const cursorField = op ? findResponseField(op, openapi, NEXT_RESPONSE_FIELDS.pageToken) : null;
    return {
      kind: "page-token",
      params: {
        token: PAGE_PARAMS.pageToken.find(has),
        size: sizeParam,
      },
      response: { nextField: cursorField },
    };
  }

  // Pattern: page (numeric page number).
  if (has("page")) {
    return {
      kind: "page",
      params: { page: "page", size: sizeParam },
      response: {},
    };
  }

  // Pattern: cursor.
  if (PAGE_PARAMS.cursor.some(has)) {
    const cursorField = op ? findResponseField(op, openapi, NEXT_RESPONSE_FIELDS.cursor) : null;
    return {
      kind: "cursor",
      params: {
        cursor: PAGE_PARAMS.cursor.find(has),
        size: sizeParam,
      },
      response: { nextField: cursorField },
    };
  }

  // Pattern: offset (paired with a size param).
  if (has("offset")) {
    return {
      kind: "offset",
      params: { offset: "offset", size: sizeParam },
      response: {},
    };
  }

  return { kind: "unknown" };
}

function findResponseField(op, openapi, candidates) {
  // Look at the 200/201/2xx JSON schema for any of the candidate field
  // names. Returns the first hit or null.
  if (!op?.responses) return null;
  for (const code of ["200", "201", "202"]) {
    const r = op.responses[code];
    if (!r) continue;
    const resolved = resolveRef(r, openapi);
    const schema = resolved?.content?.["application/json"]?.schema;
    if (!schema) continue;
    const props = collectProperties(schema, openapi, /*depth*/ 2);
    for (const c of candidates) if (c in props) return c;
  }
  return null;
}

// --- Error envelopes ---------------------------------------------------

function detectErrorShapes(op, openapi) {
  if (!op?.responses) return [];
  const shapes = [];
  for (const [code, resp] of Object.entries(op.responses)) {
    if (/^2\d\d$/.test(code) || code === "default") {
      // 2xx aren't errors. `default` is special: handled separately if
      // present, but recorded as a passthrough fallback.
      if (code === "default") {
        const resolved = resolveRef(resp, openapi);
        const shape = classifyErrorBody(resolved, openapi);
        if (shape) shapes.push({ code, shape });
      }
      continue;
    }
    const resolved = resolveRef(resp, openapi);
    const shape = classifyErrorBody(resolved, openapi);
    shapes.push({ code, shape: shape ?? "passthrough" });
  }
  return shapes;
}

function classifyErrorBody(response, openapi) {
  const schema = response?.content?.["application/json"]?.schema;
  if (!schema) return null;
  const resolved = resolveRef(schema, openapi);
  const props = collectProperties(resolved, openapi, /*depth*/ 3);

  // RFC 7807 fingerprint: { type, title, detail } where at least 2 of
  // those keys are present.
  const rfcKeys = ["type", "title", "detail", "status", "instance"];
  const rfcHits = rfcKeys.filter((k) => k in props).length;
  if (rfcHits >= 2) return "rfc7807";

  // List envelope: { errors: [...] } where errors items have code/message.
  if ("errors" in props) {
    const errorsSchema = resolveRef(props.errors, openapi);
    if (errorsSchema?.type === "array") return "list";
  }

  // Single envelope: { error: { ... } }.
  if ("error" in props) {
    const errSchema = resolveRef(props.error, openapi);
    if (errSchema?.type === "object" || errSchema?.properties) return "single";
    if (typeof errSchema?.type === "string") return "single";
  }

  return null;
}

function pickDominantErrorShape(shapes) {
  if (!shapes || shapes.length === 0) return null;
  const counts = new Map();
  for (const { shape } of shapes) {
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

// --- Helpers ------------------------------------------------------------

function findOpenapiOperation(openapi, path, method) {
  const item = openapi.paths?.[path];
  if (!item) return null;
  return item[String(method ?? "get").toLowerCase()] ?? null;
}

function collectProperties(schema, openapi, depth) {
  // Walk allOf transparently (the merged property set is what we want).
  // For oneOf/anyOf, take the union of all members' properties so we
  // don't miss a discriminated envelope shape.
  if (!schema || depth <= 0) return {};
  const resolved = resolveRef(schema, openapi);
  const out = {};
  if (resolved.properties) Object.assign(out, resolved.properties);
  if (Array.isArray(resolved.allOf)) {
    for (const s of resolved.allOf) Object.assign(out, collectProperties(s, openapi, depth - 1));
  }
  if (Array.isArray(resolved.oneOf)) {
    for (const s of resolved.oneOf) Object.assign(out, collectProperties(s, openapi, depth - 1));
  }
  if (Array.isArray(resolved.anyOf)) {
    for (const s of resolved.anyOf) Object.assign(out, collectProperties(s, openapi, depth - 1));
  }
  return out;
}

function resolveRef(node, root) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref !== "string") return node;
  const m = node.$ref.match(/^#\/(.+)$/);
  if (!m) return node;
  const parts = m[1].split("/");
  let cur = root;
  for (const p of parts) {
    cur = cur?.[decodeURIComponent(p.replace(/~1/g, "/").replace(/~0/g, "~"))];
  }
  return cur ?? node;
}

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const k of Object.keys(value)) out[k] = clone(value[k]);
  return out;
}
