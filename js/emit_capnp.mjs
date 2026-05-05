// manifest → canonical .capnp emitter.
//
// Translates the manifest IR (preferring its `openapi` sidecar when
// present) into a .capnp schema file ready for `capnp compile`. The
// emitted .capnp is the hand-off point into the upstream capnp generator
// ecosystem (capnp-rust, capnp-python, capnp-go, capnp-cxx, capnp-java).
//
// Type-system mapping (from docs/unified-surfaces-design.md §1):
//
//   OpenAPI                              capnp
//   -----------------------------------  ----------------------------------
//   string                               Text
//   string + format binary/byte          Data
//   integer / number                     Int32 / Float64 (see numericKind)
//   integer + format int64               Int64
//   boolean                              Bool
//   enum (strings)                       enum (capnp)
//   array<T>                             List(T)
//   $ref → ComponentName                 typename ComponentName
//   nullable: true                       union { value :T; null :Void; }
//                                          (per the design doc)
//   allOf [A, B, ...]                    flatten: union all properties
//                                          into a single capnp struct
//   oneOf [A, B, ...] + discriminator    union { a :A; b :B; ... }
//   oneOf [A, B, ...] no discriminator   AnyPointer (with a comment)
//   anyOf                                same as oneOf, no discriminator
//   object + additionalProperties        AnyPointer (with a comment)
//   object + properties                  capnp struct
//   pattern / min / max constraints      dropped, listed in summary
//   readOnly / writeOnly                 dropped, listed in summary
//
// HTTP semantics (path / verb / status / param-in) are emitted as
// $Rest.* annotations on each interface method, per the design doc.
//
// Field-ID assignment is positional within each struct: ordinals follow
// the property ordering in the source schema. The capnwasm/lock entry
// (see docs/unified-surfaces-design.md §3) is the authority for renames
// and pinned ordinals; this emitter consults the lock when one is
// present in the manifest's `lock` block and falls back to positional
// assignment otherwise.

const RESERVED_CAPNP = new Set([
  "struct", "enum", "interface", "union", "group", "import", "using",
  "const", "annotation", "in", "of", "as", "extends", "method", "param",
  "return", "list", "void", "true", "false", "with", "null",
  // Built-in capnp type names. Field/struct names mustn't collide.
  "Text", "Data", "Bool", "Void",
  "Int8", "Int16", "Int32", "Int64",
  "UInt8", "UInt16", "UInt32", "UInt64",
  "Float32", "Float64",
  "List", "AnyPointer",
]);

/**
 * Build the canonical .capnp text from a manifest.
 * @param {object} manifest
 * @returns {{ text: string, summary: object }}
 */
export function buildCapnp(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("emit-capnp: manifest must be an object");
  }

  const ctx = {
    manifest,
    structs: new Map(),       // name → { fields, comments, ... }
    enums: new Map(),         // name → { values, comments, ... }
    interfaces: new Map(),    // name → { methods }
    nameCollisions: new Set(),
    dropped: [],              // notes for the summary
    fileId: makeFileId(manifest),
    inlineCounter: 0,
    refCanonicalNames: new Map(), // sanitized → original (for refs/sanity)
    // Lock file pins capnp `@N` ordinals across schema edits. When
    // absent, ordinals fall back to positional (insertion order).
    lock: manifest.lock ?? null,
  };

  if (manifest.openapi && typeof manifest.openapi === "object") {
    ingestOpenapi(ctx, manifest.openapi);
  } else {
    ingestNativeManifest(ctx, manifest);
  }

  const text = render(ctx);
  return {
    text,
    summary: {
      structs: ctx.structs.size,
      enums: ctx.enums.size,
      interfaces: ctx.interfaces.size,
      methods: [...ctx.interfaces.values()].reduce((n, i) => n + i.methods.length, 0),
      dropped: ctx.dropped,
    },
    // The structural inventory captured during emission. Consumed by
    // `js/lock.mjs` so the lock file is kept in lockstep with what
    // emit-capnp actually produces (including inline structs / enums
    // minted for $ref-less object properties or inline enums on a
    // struct field). Shape: { interfaces, structs, enums } with each
    // value being a list of member names in emission order.
    structures: structuralInventory(ctx),
  };
}

function structuralInventory(ctx) {
  // Members are returned with their type signatures. The lock engine
  // consumes the signatures to perform heuristic rename detection
  // (`{name: oldName, type: T}` removed + `{name: newName, type: T}`
  // added in the same scope → transfer the ordinal instead of
  // tombstone+new). Callers that don't care about renames can use the
  // `name`-only projection.
  const out = { interfaces: {}, structs: {}, enums: {} };
  for (const [name, iface] of ctx.interfaces) {
    out.interfaces[name] = {
      methods: iface.methods.map((m) => ({
        name: m.name,
        signature: methodSignature(m),
      })),
    };
  }
  for (const [name, s] of ctx.structs) {
    out.structs[name] = {
      fields: s.fields.map((f) => ({ name: f.name, type: f.type })),
    };
  }
  for (const [name, e] of ctx.enums) {
    out.enums[name] = { values: e.values.map((v) => ({ name: v })) };
  }
  return out;
}

function methodSignature(m) {
  // A method's signature is its param-types and result-type, concat'd.
  // Used by the lock engine to spot renames.
  const params = (m.params ?? []).map((p) => p.type).join(",");
  return `(${params})->${m.resultType ?? "Void"}`;
}

// --- File-id (capnp requires a fixed, unique 64-bit @0xHEXID;) -----------

function makeFileId(manifest) {
  // Deterministic from manifest.source.name + format. capnpc requires the
  // top bit to be set (`@0x[8-f]...`), so we mask it on. 16 hex chars.
  const seed = `${manifest.source?.name ?? "anon"}:${manifest.source?.format ?? ""}`;
  let h = 0xcbf29ce484222325n; // FNV-1a 64-bit seed
  for (let i = 0; i < seed.length; i++) {
    h ^= BigInt(seed.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  // Force top bit set per capnp file-id convention.
  h |= 0x8000000000000000n;
  return "0x" + h.toString(16).padStart(16, "0");
}

// --- Ingest: OpenAPI sidecar ---------------------------------------------

function ingestOpenapi(ctx, openapi) {
  const schemas = openapi.components?.schemas ?? {};
  // First pass: register every component name so cross-refs resolve.
  for (const name of Object.keys(schemas)) {
    const cap = capnpName(name, "Type");
    ctx.refCanonicalNames.set(name, cap);
  }
  // Second pass: translate each schema to a capnp struct / enum.
  for (const [name, schema] of Object.entries(schemas)) {
    const resolved = resolveSchema(schema, openapi);
    translateNamedSchema(ctx, name, resolved, openapi);
  }
  // Third pass: translate paths to a single Api interface with one
  // method per (path, verb).
  const apiName = capnpName(openapi.info?.title ?? "Api", "Api");
  const iface = { methods: [] };
  ctx.interfaces.set(apiName, iface);
  for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const verb of ["get", "put", "post", "delete", "options", "head", "patch"]) {
      const op = pathItem[verb];
      if (!op) continue;
      iface.methods.push(translateOperation(ctx, path, verb, op, pathItem, openapi));
    }
  }
}

function translateNamedSchema(ctx, name, schema, openapi) {
  const capName = ctx.refCanonicalNames.get(name) ?? capnpName(name, "Type");

  // Enum (string-only enums map cleanly).
  if (Array.isArray(schema.enum) && schema.type !== "object" && schema.enum.every((v) => typeof v === "string")) {
    const values = dedupeEnumValues(schema.enum.map(capnpEnumValue));
    ctx.enums.set(capName, { values, doc: schema.description });
    return;
  }

  // allOf: flatten merged properties into one struct.
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged = mergeAllOf(schema, openapi);
    addStructFromObject(ctx, capName, merged, openapi, schema.description);
    return;
  }

  // oneOf / anyOf: union of typed members.
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    addUnionStruct(ctx, capName, schema.oneOf, schema.discriminator, openapi, schema.description, "oneOf");
    return;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    addUnionStruct(ctx, capName, schema.anyOf, schema.discriminator, openapi, schema.description, "anyOf");
    return;
  }

  if (schema.type === "object" || schema.properties) {
    addStructFromObject(ctx, capName, schema, openapi, schema.description);
    return;
  }

  // Wrap primitives / arrays / scalars / additionalProperties-only objects
  // in a single-field struct so they're nameable from other structs.
  const wrapper = {
    type: "object",
    properties: { value: schema },
    required: schema.nullable ? [] : ["value"],
    description: schema.description,
  };
  addStructFromObject(ctx, capName, wrapper, openapi, schema.description, /*isWrapper*/ true);
}

function addStructFromObject(ctx, capName, schema, openapi, doc, isWrapper = false) {
  const fields = [];
  const required = new Set(schema.required ?? []);
  let ord = 0;
  const props = schema.properties ?? {};
  for (const [propName, propSchema] of Object.entries(props)) {
    const fieldName = capnpFieldName(propName, fields);
    // Pass the schema with $ref intact so openApiTypeToCapnp can resolve
    // it to a named struct rather than inline-duplicating the component.
    const ftype = openApiTypeToCapnp(ctx, propSchema, openapi, capName + "_" + fieldName);
    const isOptional = !required.has(propName);
    fields.push({
      ordinal: ord++,
      name: fieldName,
      origName: propName,
      type: ftype,
      optional: isOptional,
      nullable: !!propSchema.nullable,
      doc: propSchema.description,
    });
  }
  // additionalProperties: pass through as AnyPointer when truthy and no
  // explicit shape (otherwise it's already covered).
  if (schema.additionalProperties && Object.keys(props).length === 0) {
    fields.push({
      ordinal: ord++,
      name: "additional",
      origName: "_additional",
      type: "AnyPointer",
      doc: "additionalProperties",
    });
  }
  ctx.structs.set(capName, { fields, doc, isWrapper });
}

function addUnionStruct(ctx, capName, members, discriminator, openapi, doc, kind) {
  // Translate each member, deduping by emitted type so that
  // `oneOf: [Foo, Foo]` (which OpenAPI sometimes produces from generated
  // specs) collapses to one effective member.
  const fields = [];
  const usedNames = new Set();
  const usedTypes = new Set();
  members.forEach((m, idx) => {
    const refName = (typeof m?.$ref === "string") ? refLast(m.$ref) : null;
    const memberType = openApiTypeToCapnp(ctx, m, openapi, `${capName}_${refName ?? `member${idx}`}`);
    if (usedTypes.has(memberType)) return;
    usedTypes.add(memberType);
    let memberName = unionMemberName(m, idx, members, discriminator, refName);
    let n = memberName;
    let i = 2;
    while (usedNames.has(n)) n = `${memberName}${i++}`;
    usedNames.add(n);
    fields.push({
      ordinal: fields.length,
      name: n,
      origName: n,
      type: memberType,
    });
  });

  // capnp requires a union to have at least two members. With one
  // effective member, emit a plain struct with a single field instead.
  const docText = doc
    ? `${doc}\n(${kind} of ${members.length} variant${members.length === 1 ? "" : "s"})`
    : `(${kind} of ${members.length} variant${members.length === 1 ? "" : "s"})`;
  if (fields.length <= 1) {
    if (fields.length === 0) {
      // Pathological case: zero-member oneOf. Fall back to AnyPointer.
      fields.push({ ordinal: 0, name: "value", origName: "value", type: "AnyPointer" });
    }
    ctx.structs.set(capName, { fields, doc: docText });
    return;
  }
  ctx.structs.set(capName, { fields, doc: docText, union: true });
}

function unionMemberName(schema, idx, members, discriminator, refName = null) {
  const tag = refName ?? schema?._refName;
  if (discriminator?.mapping && tag) {
    for (const [key, ref] of Object.entries(discriminator.mapping)) {
      if (typeof ref === "string" && ref.endsWith("/" + tag)) {
        return lowerFirst(capnpName(key, `member${idx}`));
      }
    }
  }
  if (tag) return lowerFirst(capnpName(tag, `member${idx}`));
  if (schema?.title) return lowerFirst(capnpName(schema.title, `member${idx}`));
  return `member${idx}`;
}

// --- Operations (paths) ---------------------------------------------------

function translateOperation(ctx, path, verb, op, pathItem, openapi) {
  const opName = capnpFieldName(
    op.operationId ?? `${verb}${path.replace(/[^A-Za-z0-9]+/g, "_")}`,
    [],
  );

  const params = [];
  let ord = 0;

  // Path-level + op-level parameters.
  const allParams = [
    ...((pathItem.parameters ?? []).map((p) => resolveSchema(p, openapi))),
    ...((op.parameters ?? []).map((p) => resolveSchema(p, openapi))),
  ];

  for (const p of allParams) {
    if (!p || !p.name) continue;
    const fieldName = capnpFieldName(p.name, params);
    // Pass schema with $ref intact so component refs aren't inlined.
    const ftype = openApiTypeToCapnp(ctx, p.schema ?? { type: "string" }, openapi, opName + "_" + fieldName);
    params.push({ ordinal: ord++, name: fieldName, origName: p.name, type: ftype, in: p.in });
  }
  // requestBody → 'body' param (json content only; multipart/form-data
  // surface via a single AnyPointer).
  if (op.requestBody) {
    const rb = resolveSchema(op.requestBody, openapi);
    const json = rb?.content?.["application/json"]?.schema;
    if (json) {
      const ftype = openApiTypeToCapnp(ctx, json, openapi, opName + "_body");
      params.push({ ordinal: ord++, name: "body", origName: "body", type: ftype, in: "body" });
    } else if (rb?.content) {
      params.push({ ordinal: ord++, name: "body", origName: "body", type: "AnyPointer", in: "body" });
    }
  }

  // Result: success response shape.
  let resultType = "Void";
  const resp = pickSuccessResponse(op, openapi);
  if (resp?.schema) {
    resultType = openApiTypeToCapnp(ctx, resp.schema, openapi, opName + "_result");
  }

  return {
    name: opName,
    httpVerb: verb.toUpperCase(),
    httpPath: path,
    params,
    resultType,
    description: op.summary ?? op.description,
  };
}

function pickSuccessResponse(op, openapi) {
  const responses = op.responses ?? {};
  for (const code of ["200", "201", "202", "204"]) {
    const r = responses[code];
    if (!r) continue;
    const resolved = resolveSchema(r, openapi);
    const json = resolved?.content?.["application/json"]?.schema;
    if (json) return { code, schema: json };
    if (code === "204") return { code, schema: null };
  }
  for (const [code, r] of Object.entries(responses)) {
    if (!/^2/.test(code)) continue;
    const resolved = resolveSchema(r, openapi);
    const json = resolved?.content?.["application/json"]?.schema;
    if (json) return { code, schema: json };
  }
  return null;
}

// --- Type translation ----------------------------------------------------

function openApiTypeToCapnp(ctx, schema, openapi, hintName) {
  if (!schema) return "AnyPointer";
  if (schema.$ref) {
    const refName = refLast(schema.$ref);
    const known = ctx.refCanonicalNames.get(refName);
    if (known) return known;
    ctx.dropped.push({ kind: "unresolved-$ref", ref: schema.$ref });
    return "AnyPointer";
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    // Inline a flattened struct.
    const inlineName = ensureInlineStruct(ctx, hintName, mergeAllOf(schema, openapi), openapi);
    return inlineName;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const inlineName = ensureInlineUnion(ctx, hintName, schema.oneOf, schema.discriminator, openapi, "oneOf");
    return inlineName;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const inlineName = ensureInlineUnion(ctx, hintName, schema.anyOf, schema.discriminator, openapi, "anyOf");
    return inlineName;
  }
  if (Array.isArray(schema.enum) && schema.type !== "object" && schema.enum.every((v) => typeof v === "string")) {
    // Inline enum: register and return the type name.
    const inlineEnum = ensureInlineEnum(ctx, hintName, schema);
    return inlineEnum;
  }

  switch (schema.type) {
    case "string": {
      if (schema.format === "binary" || schema.format === "byte") return "Data";
      return "Text";
    }
    case "integer": {
      if (schema.format === "int64") return "Int64";
      if (schema.format === "int32") return "Int32";
      return "Int32";
    }
    case "number": {
      if (schema.format === "float") return "Float32";
      return "Float64";
    }
    case "boolean": return "Bool";
    case "array": {
      // Preserve $ref on items rather than pre-resolving (otherwise array
      // members of a known component would inline as duplicate structs).
      let inner = openApiTypeToCapnp(ctx, schema.items ?? {}, openapi, hintName + "_item");
      // capnp 1.x rejects `List(AnyPointer)`. Wrap untyped elements in a
      // single-field AnyValue struct so the schema compiles.
      if (inner === "AnyPointer") inner = ensureAnyValueStruct(ctx);
      return `List(${inner})`;
    }
    case "object": {
      // Inline object: mint a struct.
      if (schema.properties || schema.additionalProperties) {
        const inlineName = ensureInlineStruct(ctx, hintName, schema, openapi);
        return inlineName;
      }
      return "AnyPointer";
    }
    default: {
      // OpenAPI 3.1 may use type as an array (`["string", "null"]`).
      if (Array.isArray(schema.type)) {
        const nonNull = schema.type.filter((t) => t !== "null");
        if (nonNull.length === 1) {
          return openApiTypeToCapnp(ctx, { ...schema, type: nonNull[0], nullable: schema.type.includes("null") }, openapi, hintName);
        }
      }
      return "AnyPointer";
    }
  }
}

function ensureInlineStruct(ctx, hint, schema, openapi) {
  const name = uniqueStructName(ctx, capnpName(hint, "Inline"));
  addStructFromObject(ctx, name, schema, openapi, schema.description);
  return name;
}

function ensureInlineUnion(ctx, hint, members, discriminator, openapi, kind) {
  const name = uniqueStructName(ctx, capnpName(hint, "Union"));
  addUnionStruct(ctx, name, members, discriminator, openapi, undefined, kind);
  return name;
}

function ensureAnyValueStruct(ctx) {
  // capnp can't put AnyPointer inside a List, so we synthesize a tiny
  // wrapper struct once and reuse it whenever an array of unknown types
  // appears in the source schema.
  const name = "AnyValue";
  if (!ctx.structs.has(name)) {
    ctx.structs.set(name, {
      fields: [{ ordinal: 0, name: "value", origName: "value", type: "AnyPointer" }],
      doc: "Wrapper for List(AnyPointer) since capnp does not allow that natively.",
    });
  }
  return name;
}

function ensureInlineEnum(ctx, hint, schema) {
  const name = uniqueEnumName(ctx, capnpName(hint, "Enum"));
  const values = dedupeEnumValues(schema.enum.map(capnpEnumValue));
  ctx.enums.set(name, { values, doc: schema.description });
  return name;
}

function uniqueStructName(ctx, base) {
  let n = base;
  let i = 2;
  while (ctx.structs.has(n) || ctx.enums.has(n) || ctx.interfaces.has(n)) {
    n = `${base}${i++}`;
  }
  return n;
}

function uniqueEnumName(ctx, base) {
  let n = base;
  let i = 2;
  while (ctx.structs.has(n) || ctx.enums.has(n) || ctx.interfaces.has(n)) {
    n = `${base}${i++}`;
  }
  return n;
}

// --- Native (non-OpenAPI) ingest -----------------------------------------

function ingestNativeManifest(ctx, manifest) {
  // Re-emit capnp structs / interfaces from the canonical IR. This path
  // is used when the source format was .capnp or @rest TS.
  for (const s of manifest.structs ?? []) {
    const capName = capnpName(s.name, "Type");
    ctx.refCanonicalNames.set(s.name, capName);
    const fields = [];
    let ord = 0;
    for (const f of s.fields ?? []) {
      fields.push({
        ordinal: typeof f.ordinal === "number" ? f.ordinal : ord,
        name: capnpFieldName(f.name, fields),
        origName: f.name,
        type: f.type ?? "AnyPointer",
      });
      ord++;
    }
    ctx.structs.set(capName, { fields });
  }
  for (const iface of manifest.interfaces ?? []) {
    const capName = capnpName(iface.name, "Iface");
    const methods = [];
    for (const m of iface.methods ?? []) {
      methods.push({
        name: capnpFieldName(m.name, methods),
        params: [],
        resultType: m.resultsStruct ?? "Void",
      });
    }
    ctx.interfaces.set(capName, { methods });
  }
  for (const api of manifest.restApis ?? []) {
    const capName = capnpName(api.name, "Api");
    const methods = [];
    for (const m of api.methods ?? []) {
      methods.push({
        name: capnpFieldName(m.name, methods),
        httpVerb: m.httpMethod,
        httpPath: m.path,
        params: (m.params ?? []).map((p, i) => ({
          ordinal: i,
          name: capnpFieldName(p.name, []),
          origName: p.name,
          type: tsTypeToCapnp(p.type),
          in: p.in,
        })),
        resultType: tsTypeToCapnp(m.returnType ?? "void"),
      });
    }
    ctx.interfaces.set(capName, { methods });
  }
}

function tsTypeToCapnp(ts) {
  if (!ts || ts === "void" || ts === "unknown") return "Void";
  if (ts === "string")  return "Text";
  if (ts === "number")  return "Float64";
  if (ts === "boolean") return "Bool";
  if (ts === "Uint8Array") return "Data";
  if (ts.endsWith("[]")) return `List(${tsTypeToCapnp(ts.slice(0, -2))})`;
  if (ts.endsWith(" | null")) return tsTypeToCapnp(ts.slice(0, -" | null".length));
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ts)) return capnpName(ts, "Type");
  return "AnyPointer";
}

// --- $ref resolution ------------------------------------------------------

function resolveSchema(node, root) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref !== "string") return node;
  const m = node.$ref.match(/^#\/(.+)$/);
  if (!m) return node;
  const parts = m[1].split("/");
  let cur = root;
  for (const p of parts) cur = cur?.[decodeURIComponent(p.replace(/~1/g, "/").replace(/~0/g, "~"))];
  if (!cur) return node;
  // Tag with the ref's last segment so unionMemberName can use it.
  if (typeof cur === "object" && !cur._refName) {
    return { ...cur, _refName: refLast(node.$ref) };
  }
  return cur;
}

function refLast(ref) {
  const m = ref.match(/\/([^/]+)$/);
  return m ? m[1] : ref;
}

function mergeAllOf(schema, openapi) {
  const out = { type: "object", properties: {}, required: [] };
  if (schema.description) out.description = schema.description;
  const reqSet = new Set();
  const visit = (s) => {
    const r = resolveSchema(s, openapi);
    if (Array.isArray(r.allOf)) {
      for (const a of r.allOf) visit(a);
    } else {
      Object.assign(out.properties, r.properties ?? {});
      for (const k of r.required ?? []) reqSet.add(k);
    }
  };
  visit(schema);
  out.required = [...reqSet];
  return out;
}

// --- Naming helpers -------------------------------------------------------
//
// capnp's lexer enforces two hard rules: declaration names use camelCase
// (PascalCase for types, lower-camel for fields / methods / enum values)
// and must contain no underscores. Anywhere an arbitrary OpenAPI string
// would produce an empty / digit-leading / reserved / collision result,
// the fallback prepends a letter prefix rather than appending `_`.

function partsOf(s) {
  return String(s).replace(/[^A-Za-z0-9]+/g, "_").split("_").filter(Boolean);
}

function camelify(parts) {
  return parts.map((p, i) => i === 0
    ? p.charAt(0).toLowerCase() + p.slice(1)
    : p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function pascalify(parts) {
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function capnpName(s, fallback) {
  // PascalCase. Reserved or otherwise invalid → "T" prefix.
  const parts = partsOf(s ?? "");
  let n = parts.length ? pascalify(parts) : "";
  if (!n) n = pascalify(partsOf(fallback ?? "T"));
  if (!n) n = "T";
  if (/^[0-9]/.test(n)) n = "T" + n;
  if (RESERVED_CAPNP.has(n)) n = "T" + n;
  return n;
}

function capnpFieldName(s, taken) {
  // camelCase. Reserved or otherwise invalid → "v" prefix.
  const parts = partsOf(s ?? "");
  let n = parts.length ? camelify(parts) : "";
  if (!n) n = "field";
  if (/^[0-9]/.test(n)) n = "v" + n.charAt(0).toUpperCase() + n.slice(1);
  if (RESERVED_CAPNP.has(n)) n = "v" + n.charAt(0).toUpperCase() + n.slice(1);
  // Disambiguate inside the same scope by appending a digit (no
  // underscore allowed). Probe `n2`, `n3`, ... until free.
  const takenSet = new Set((taken ?? []).map((t) => t.name));
  let final = n;
  let i = 2;
  while (takenSet.has(final)) final = `${n}${i++}`;
  return final;
}

function capnpEnumValue(v) {
  // Enum values are camelCase. Empty / digit / reserved → "v" prefix.
  const parts = partsOf(v ?? "");
  let n = parts.length ? camelify(parts) : "";
  if (!n) n = "value";
  if (/^[0-9]/.test(n)) n = "v" + n.charAt(0).toUpperCase() + n.slice(1);
  if (RESERVED_CAPNP.has(n)) n = "v" + n.charAt(0).toUpperCase() + n.slice(1);
  return n;
}

// Dedupe a list of enum-value names within one enum scope. Stable: the
// first occurrence keeps its name; later collisions get a numeric suffix.
function dedupeEnumValues(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    let n = raw;
    let i = 2;
    while (seen.has(n)) n = `${raw}${i++}`;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// Codegen tags interface-typed fields as `Capability(<IfaceName>)` so it
// can emit the right reader/builder shape. Cap'n Proto schema syntax just
// uses the bare interface name, so unwrap the tag when emitting back to
// .capnp text.
function capnpFieldType(t) {
  const m = /^Capability\(([^)]+)\)$/.exec(t ?? "");
  return m ? m[1] : t;
}

// --- Render ---------------------------------------------------------------

function render(ctx) {
  const lines = [];
  lines.push(`# Auto-generated by capnwasm emit-capnp. Do not edit by hand.`);
  lines.push(`# Source: ${ctx.manifest.source?.name ?? "anon"} (${ctx.manifest.source?.format ?? "?"})`);
  lines.push(`# Generated: ${ctx.manifest.source?.generatedAt ?? new Date().toISOString()}`);
  lines.push(``);
  lines.push(`@${ctx.fileId};`);
  lines.push(``);

  // Stable emission order: enums first (no forward refs needed), then
  // structs (alphabetical), then interfaces.
  const enumNames = [...ctx.enums.keys()].sort();
  for (const name of enumNames) {
    const e = ctx.enums.get(name);
    if (e.doc) for (const l of String(e.doc).split("\n")) lines.push(`# ${l}`);
    lines.push(`enum ${name} {`);
    const vList = pinEnumOrdinals(ctx, name, e.values);
    for (const { value, ordinal } of vList) lines.push(`  ${value} @${ordinal};`);
    lines.push(`}`);
    lines.push(``);
  }

  const structNames = [...ctx.structs.keys()].sort();
  for (const name of structNames) {
    const s = ctx.structs.get(name);
    if (s.doc) for (const l of String(s.doc).split("\n")) lines.push(`# ${l}`);
    const fList = pinStructOrdinals(ctx, name, s.fields);
    if (s.union) {
      lines.push(`struct ${name} {`);
      lines.push(`  union {`);
      for (const f of fList) lines.push(`    ${f.name} @${f.ordinal} :${capnpFieldType(f.type)};`);
      lines.push(`  }`);
      lines.push(`}`);
    } else {
      lines.push(`struct ${name} {`);
      for (const f of fList) {
        const note = f.origName && f.origName !== f.name ? ` # original: "${f.origName}"` : "";
        if (f.doc) for (const l of String(f.doc).split("\n")) lines.push(`  # ${l}`);
        lines.push(`  ${f.name} @${f.ordinal} :${capnpFieldType(f.type)};${note}`);
      }
      lines.push(`}`);
    }
    lines.push(``);
  }

  const ifaceNames = [...ctx.interfaces.keys()].sort();
  for (const name of ifaceNames) {
    const iface = ctx.interfaces.get(name);
    lines.push(`interface ${name} {`);
    const mList = pinMethodOrdinals(ctx, name, iface.methods);
    for (const { method: m, ordinal } of mList) {
      if (m.description) for (const l of String(m.description).split("\n")) lines.push(`  # ${l}`);
      const paramList = m.params.map((p) => `${p.name} :${capnpFieldType(p.type)}`).join(", ");
      const result = m.resultType && m.resultType !== "Void" ? ` -> (result :${capnpFieldType(m.resultType)})` : "";
      const httpNote = m.httpVerb && m.httpPath
        ? `  # HTTP ${m.httpVerb} ${m.httpPath}\n`
        : "";
      lines.push(`${httpNote}  ${m.name} @${ordinal} (${paramList})${result};`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  return lines.join("\n");
}

// --- Lock-file ordinal pinning ----------------------------------------
//
// When a `lock` block is present on the manifest, ordinals come from
// the lock. Members not in the lock get the next free ordinal in their
// scope (preserving the lock's `next` invariant). When no lock is
// present, ordinals are positional (insertion order).

function pinEnumOrdinals(ctx, enumName, values) {
  const lockSlot = ctx.lock?.enums?.[enumName];
  if (!lockSlot?.values) {
    return values.map((value, idx) => ({ value, ordinal: idx }));
  }
  let nextOrd = lockSlot.next ?? Object.values(lockSlot.values).reduce((m, n) => Math.max(m, n + 1), 0);
  const used = new Set(Object.values(lockSlot.values));
  const present = new Set(values);
  const out = values.map((value) => {
    if (value in lockSlot.values) {
      return { value, ordinal: lockSlot.values[value] };
    }
    while (used.has(nextOrd)) nextOrd++;
    used.add(nextOrd);
    return { value, ordinal: nextOrd++ };
  });
  // Capnp requires enum ordinals to be sequential. Re-emit any
  // tombstoned values (in the lock but no longer in the schema) under
  // a removed-prefix name so their slots stay occupied.
  for (const [val, ord] of Object.entries(lockSlot.values)) {
    if (!present.has(val)) out.push({ value: tombstoneName(val), ordinal: ord });
  }
  out.sort((a, b) => a.ordinal - b.ordinal);
  return out;
}

function pinStructOrdinals(ctx, structName, fields) {
  const lockSlot = ctx.lock?.structs?.[structName];
  if (!lockSlot?.fields) {
    return fields;
  }
  let nextOrd = lockSlot.next ?? Object.values(lockSlot.fields).reduce((m, n) => Math.max(m, n + 1), 0);
  const used = new Set(Object.values(lockSlot.fields));
  const present = new Set(fields.map((f) => f.name));
  const out = fields.map((f) => {
    if (f.name in lockSlot.fields) {
      return { ...f, ordinal: lockSlot.fields[f.name] };
    }
    while (used.has(nextOrd)) nextOrd++;
    used.add(nextOrd);
    return { ...f, ordinal: nextOrd++ };
  });
  // Tombstoned fields (in the lock but no longer in the schema) get
  // emitted as `removedFoo @N :Void;` so the ordinal slot stays
  // occupied. capnp requires struct field ordinals to be sequential
  // with no holes.
  for (const [name, ord] of Object.entries(lockSlot.fields)) {
    if (!present.has(name)) {
      out.push({
        name: tombstoneName(name),
        origName: name,
        type: "Void",
        ordinal: ord,
        doc: `tombstoned: removed from schema, ordinal preserved for wire compat`,
      });
    }
  }
  out.sort((a, b) => a.ordinal - b.ordinal);
  return out;
}

function pinMethodOrdinals(ctx, ifaceName, methods) {
  const lockSlot = ctx.lock?.interfaces?.[ifaceName];
  if (!lockSlot?.methods) {
    return methods.map((method, idx) => ({ method, ordinal: idx }));
  }
  let nextOrd = lockSlot.next ?? Object.values(lockSlot.methods).reduce((m, n) => Math.max(m, n + 1), 0);
  const used = new Set(Object.values(lockSlot.methods));
  const present = new Set(methods.map((m) => m.name));
  const out = methods.map((method) => {
    if (method.name in lockSlot.methods) {
      return { method, ordinal: lockSlot.methods[method.name] };
    }
    while (used.has(nextOrd)) nextOrd++;
    used.add(nextOrd);
    return { method, ordinal: nextOrd++ };
  });
  // Tombstoned methods get emitted as a no-arg / no-result entry under
  // a removed-prefix name so the method ordinal stays occupied.
  for (const [name, ord] of Object.entries(lockSlot.methods)) {
    if (!present.has(name)) {
      out.push({
        method: {
          name: tombstoneName(name),
          params: [],
          resultType: "Void",
          description: `tombstoned: removed from schema, method ordinal preserved for wire compat`,
        },
        ordinal: ord,
      });
    }
  }
  out.sort((a, b) => a.ordinal - b.ordinal);
  return out;
}

function tombstoneName(name) {
  // camelCase removed-prefix name. Capnp disallows underscores so the
  // form is `removed` + PascalCased original.
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  return `removed${pascal}`;
}
