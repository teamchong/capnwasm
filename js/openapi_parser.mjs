// Parse an OpenAPI 3.x spec into our internal { restApis, typeInterfaces }
// model. The model is identical to what parseTsInterfaces produces for
// REST interfaces, so the existing generateRestClient + generateRestDts
// can emit clients with no further changes.
//
// What we cover:
//   • All HTTP methods (get/post/put/patch/delete/head/options)
//   • Path / query / header parameters
//   • requestBody (application/json, multipart/form-data, x-www-form-urlencoded)
//   • Responses (200/201/204 → success type; non-2xx → RestError)
//   • $ref resolution within the same document (#/components/schemas/Foo)
//   • Type translation: object → TS interface, array → T[], enum → union,
//     allOf → intersection, oneOf → union, nullable → | null
//   • securitySchemes: bearer (HTTP), apiKey (header/query/cookie), basic
//   • Tag-based grouping: methods are nested under client.tagName.methodName()
//     when an operation has a tag (matches Stripe / GitHub conventions).
//
// What we don't cover (yet):
//   • External $refs (across files)
//   • Discriminated oneOf with full type narrowing
//   • Server variables (we take the first server's url verbatim)

/**
 * Parse a JS object representing an OpenAPI spec.
 * @param {object} spec - parsed JSON/YAML
 * @returns {{ restApis: Array, typeInterfaces: Array }}
 */
export function parseOpenApi(spec) {
  if (!spec || typeof spec !== "object") throw new Error("OpenAPI: spec must be an object");
  if (!spec.openapi && !spec.swagger) throw new Error("OpenAPI: missing 'openapi' or 'swagger' version field");

  const ctx = {
    spec,
    schemasComp: spec.components?.schemas ?? {},
    securityComp: spec.components?.securitySchemes ?? {},
  };

  // API name from the spec title. The codegen appends "Client" when emitting
  // the factory (`createPetstoreClient`), so we don't add it here.
  const apiName = sanitizeIdent(spec.info?.title ?? "API");
  const baseUrl = spec.servers?.[0]?.url ?? "";

  // Default auth: take the first global security requirement, look up the
  // corresponding scheme, and translate to our auth shape.
  const defaultAuth = inferDefaultAuth(spec, ctx);

  const methods = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    // Path-level parameters apply to all operations under this path.
    const pathLevelParams = (pathItem.parameters ?? []).map(p => resolveRef(p, ctx));
    for (const verb of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = pathItem[verb];
      if (!op) continue;
      methods.push(translateOperation(verb, path, op, pathLevelParams, ctx));
    }
  }

  const api = {
    name: apiName,
    baseUrl,
    defaults: defaultAuth ? { auth: defaultAuth } : {},
    methods,
  };

  // Type interfaces for each schema in components.schemas.
  const typeInterfaces = [];
  for (const [name, schema] of Object.entries(ctx.schemasComp)) {
    typeInterfaces.push(translateSchemaToInterface(name, resolveRef(schema, ctx), ctx));
  }

  // Sidecar: the canonical OpenAPI shape, kept verbatim for round-trip
  // emit. Downstream tools that only need the SDK-shaped model can ignore
  // it; the emit-openapi / emit-capnp converters consume it.
  const openapi = {
    openapi: spec.openapi ?? "3.0.0",
    info: spec.info ?? { title: apiName, version: "0.0.0" },
    servers: spec.servers ?? undefined,
    security: spec.security ?? undefined,
    tags: spec.tags ?? undefined,
    externalDocs: spec.externalDocs ?? undefined,
    paths: spec.paths ?? {},
    components: spec.components ?? undefined,
  };
  // Pass through any unknown top-level keys (custom x-* extensions, etc.)
  // so the round-trip is lossless on the structural surface.
  for (const k of Object.keys(spec)) {
    if (k === "swagger") continue;
    if (!(k in openapi)) openapi[k] = spec[k];
  }
  // Strip undefined keys so the round-trip diff is clean.
  for (const k of Object.keys(openapi)) if (openapi[k] === undefined) delete openapi[k];

  return { restApis: [api], typeInterfaces, structs: [], openapi };
}

// ---- Helpers -----------------------------------------------------------

function sanitizeIdent(s) {
  return String(s).replace(/[^A-Za-z0-9_]/g, "").replace(/^(\d)/, "_$1") || "API";
}

function resolveRef(node, ctx) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const m = node.$ref.match(/^#\/(.+)$/);
    if (!m) throw new Error(`OpenAPI: external $ref not supported: ${node.$ref}`);
    const parts = m[1].split("/");
    let cur = ctx.spec;
    for (const p of parts) {
      cur = cur?.[decodeURIComponent(p.replace(/~1/g, "/").replace(/~0/g, "~"))];
    }
    if (!cur) throw new Error(`OpenAPI: $ref ${node.$ref} did not resolve`);
    return resolveRef(cur, ctx);  // chain through nested $ref
  }
  return node;
}

function refName(refStr) {
  // "#/components/schemas/Foo" → "Foo"
  const m = refStr.match(/\/([^/]+)$/);
  return m ? m[1] : refStr;
}

function inferDefaultAuth(spec, ctx) {
  const security = spec.security?.[0];
  if (!security) return null;
  const schemeName = Object.keys(security)[0];
  const scheme = ctx.securityComp[schemeName];
  if (!scheme) return null;
  if (scheme.type === "http" && scheme.scheme === "bearer") return { type: "bearer" };
  if (scheme.type === "http" && scheme.scheme === "basic")  return { type: "basic" };
  if (scheme.type === "apiKey") {
    return { type: "apiKey", in: scheme.in ?? "header", name: scheme.name ?? "x-api-key" };
  }
  return null;
}

function translateOperation(verb, path, op, pathLevelParams, ctx) {
  const opName = sanitizeIdent(op.operationId ?? `${verb}_${path}`);
  const allParams = [...pathLevelParams, ...(op.parameters ?? []).map(p => resolveRef(p, ctx))];

  // Build our method-level param array. Each param keeps its OpenAPI `in`
  // role so the codegen emits the right plumbing.
  const params = [];
  for (const p of allParams) {
    if (!p?.name || !p?.in) continue;
    const tsType = openApiSchemaToTs(p.schema ?? { type: "string" }, ctx);
    const role = p.in === "path"   ? "path"
              : p.in === "query"  ? "query"
              : p.in === "header" ? "header"
              : null;
    if (!role) continue;
    const param = {
      name: jsIdent(p.name),
      type: tsType,
      optional: p.required !== true,
      role,
    };
    // Preserve the original wire-name for any param whose JS identifier
    // got camelCased (foo_bar → fooBar). The wire name is what the
    // server sees on the URL / header / cookie; downstream tools (the
    // adapter, the SDK emit, the docs) need the wire form.
    if (p.name !== param.name) param.wireName = p.name;
    params.push(param);
  }

  // requestBody → body param (if present)
  let bodyEncoding = null;
  if (op.requestBody) {
    const body = resolveRef(op.requestBody, ctx);
    const { contentType, schema } = pickRequestContent(body);
    if (schema) {
      bodyEncoding = contentType === "multipart/form-data" ? "multipart"
                  : contentType === "application/x-www-form-urlencoded" ? "form"
                  : "json";
      params.push({
        name: "body",
        type: openApiSchemaToTs(schema, ctx),
        optional: body.required !== true,
        role: "body",
      });
    }
  }

  // Pick success response: prefer 2xx with content, fall back to first 2xx.
  const successType = pickSuccessType(op, ctx);

  const out = {
    name: opName,
    method: verb.toUpperCase(),
    path,
    params,
    returnType: successType,
    isAsyncIterable: false,
    decode: null,
    bodyEncoding,
    paginated: null,
    tag: op.tags?.[0] ?? null,
  };
  if (op.summary) out.summary = op.summary;
  if (op.description) out.description = op.description;
  // Pass through any vendor extensions on the operation. The MCP /
  // AGENTS.md emitters look at extensions.agentDescription for an
  // agent-specific override.
  const extensions = {};
  for (const [k, v] of Object.entries(op)) {
    if (k.startsWith("x-")) extensions[k.slice(2)] = v;
  }
  if (Object.keys(extensions).length > 0) out.extensions = extensions;
  return out;
}

function jsIdent(name) {
  // Convert kebab-case / snake_case / dotted to camelCase JS identifier.
  return name
    .replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "")
    .replace(/^(\d)/, "_$1");
}

function pickRequestContent(body) {
  const content = body.content ?? {};
  for (const ct of ["application/json", "multipart/form-data", "application/x-www-form-urlencoded", "*/*"]) {
    if (content[ct]?.schema) return { contentType: ct, schema: content[ct].schema };
  }
  // Fall through: first available content type.
  const first = Object.entries(content)[0];
  return first ? { contentType: first[0], schema: first[1].schema } : { contentType: null, schema: null };
}

function pickSuccessType(op, ctx) {
  const responses = op.responses ?? {};
  for (const code of ["200", "201", "202", "204"]) {
    const r = responses[code];
    if (!r) continue;
    const resolved = resolveRef(r, ctx);
    const json = resolved.content?.["application/json"]?.schema;
    if (json) return openApiSchemaToTs(json, ctx);
    if (code === "204") return "void";
  }
  // Default: any 2xx with json
  for (const [code, r] of Object.entries(responses)) {
    if (!/^2/.test(code)) continue;
    const resolved = resolveRef(r, ctx);
    const json = resolved.content?.["application/json"]?.schema;
    if (json) return openApiSchemaToTs(json, ctx);
  }
  return "unknown";
}

function openApiSchemaToTs(schema, ctx) {
  if (!schema) return "unknown";
  if (schema.$ref) return refName(schema.$ref);

  // Handle compositions
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map(s => openApiSchemaToTs(s, ctx)).join(" & ");
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map(s => openApiSchemaToTs(s, ctx)).join(" | ");
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map(s => openApiSchemaToTs(s, ctx)).join(" | ");
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(v => typeof v === "string" ? `"${v.replace(/"/g, '\\"')}"` : String(v)).join(" | ");
  }

  let base;
  switch (schema.type) {
    case "string":  base = "string"; break;
    case "integer": base = "number"; break;
    case "number":  base = "number"; break;
    case "boolean": base = "boolean"; break;
    case "array":   base = `${openApiSchemaToTs(schema.items ?? {}, ctx)}[]`; break;
    case "object": {
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        base = `Record<string, ${openApiSchemaToTs(schema.additionalProperties, ctx)}>`;
      } else if (schema.properties) {
        const required = new Set(schema.required ?? []);
        const fields = Object.entries(schema.properties).map(([k, v]) =>
          `${jsObjKey(k)}${required.has(k) ? "" : "?"}: ${openApiSchemaToTs(v, ctx)};`);
        base = `{ ${fields.join(" ")} }`;
      } else {
        base = "Record<string, unknown>";
      }
      break;
    }
    default: base = "unknown";
  }
  if (schema.nullable) base = `${base} | null`;
  return base;
}

function jsObjKey(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
}

function translateSchemaToInterface(name, schema, ctx) {
  // For top-level component schemas that are objects, capture as a TS
  // interface body (re-emitted verbatim by generateRestDts).
  const lines = [];
  if (schema?.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    for (const [k, v] of Object.entries(schema.properties)) {
      const ts = openApiSchemaToTs(v, ctx);
      lines.push(`${jsObjKey(k)}${required.has(k) ? "" : "?"}: ${ts};`);
    }
  } else {
    // Non-object root: emit as a single field for visibility, and the type
    // alias in TS via a comment marker.
    lines.push(`/* root type: ${openApiSchemaToTs(schema, ctx)} */`);
  }
  return { name: sanitizeIdent(name), body: lines };
}
