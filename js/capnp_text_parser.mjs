// Browser-safe Cap'n Proto text parser.
//
// Takes raw `.capnp` source text plus a `CapnpCompiler` instance (from
// `dist/codegen.mjs` / `js/capnpc_loader.mjs`) and returns the same
// model shape `bin/capnwasm.mjs::parseSchema` returns:
//
//   { structs, interfaces, restApis, typeInterfaces: [] }
//
// The pipeline mirrors the CLI:
//
//   1. Scan `$Rest.path("/...")` / `$Rest.method("GET")` annotations out
//      of the source. Capnpc doesn't know what those are, but emit-capnp
//      writes them when going OpenAPI → .capnp, so a round-trip needs
//      them lifted back into restApis.
//   2. Strip the annotations so the bare schema parses cleanly.
//   3. Compile via the wasm capnp compiler → structs + interfaces.
//   4. Validate type references (catches typos before they hit emit).
//   5. Reattach the annotations as restApis.

const VALID_CAPNP_PRIMS = new Set([
  "Bool",
  "UInt8", "UInt16", "UInt32", "UInt64",
  "Int8",  "Int16",  "Int32",  "Int64",
  "Float32", "Float64",
  "Text", "Data", "Void",
  "AnyPointer",
]);

function validCapnpType(t, declared) {
  if (typeof t !== "string") return false;
  if (VALID_CAPNP_PRIMS.has(t)) return true;
  if (declared.has(t)) return true;
  if (t.startsWith("List(") && t.endsWith(")")) {
    return validCapnpType(t.slice(5, -1), declared);
  }
  return false;
}

export function validateStructs(structs) {
  const declared = new Set(structs.map((s) => s.name));
  for (const s of structs) {
    for (const f of s.fields ?? []) {
      if (validCapnpType(f.type, declared)) continue;
      throw new Error(
        `capnwasm: ${s.name}.${f.name}: type '${f.type}' is not a known ` +
        `Cap'n Proto primitive nor a struct declared in this file.`,
      );
    }
  }
}

export function scanRestAnnotations(text) {
  // Two annotation forms are recognized:
  //
  //   1. Inline form, what users hand-write:
  //        getBook @0 (...) -> (...)
  //          $Rest.path("/books/{id}"), $Rest.method("GET");
  //
  //   2. Comment form, what emit-capnp currently emits:
  //        # HTTP GET /books/{id}
  //        getBook @0 (...) -> (...);
  //
  // Round-tripping OpenAPI -> .capnp -> OpenAPI requires recognizing the
  // form emit-capnp produces, so both are scanned here.
  const out = new Map();
  // Strip non-HTTP comments so braces and method tokens inside comments
  // don't confuse the body-walker. Keep "# HTTP ..." lines intact so the
  // comment-form scanner below can pick them up.
  const stripped = text.replace(/#(?!\s*HTTP\b)[^\n]*/g, "");
  const ifaceRe = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m;
  while ((m = ifaceRe.exec(stripped))) {
    const ifaceName = m[1];
    let depth = 0;
    let i = m.index + m[0].length - 1;
    let end = -1;
    for (; i < stripped.length; i++) {
      const c = stripped[i];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = stripped.slice(m.index + m[0].length, end);

    // Form 1 — inline `$Rest.*` annotations on the method decl itself.
    const methodRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*@\d+\s*\([^;]*?;/gs;
    let mm;
    while ((mm = methodRe.exec(body))) {
      const decl = mm[0];
      const path = decl.match(/\$Rest\.path\(\s*"([^"]+)"\s*\)/)?.[1];
      const method = decl.match(/\$Rest\.method\(\s*"([^"]+)"\s*\)/)?.[1];
      if (path && method) out.set(`${ifaceName}.${mm[1]}`, { path, method });
    }

    // Form 2 — comment line `# HTTP <verb> <path>` immediately
    // preceding a method declaration. The same regex on the body works
    // because `stripped` keeps the HTTP comments verbatim.
    const commentRe = /#\s*HTTP\s+([A-Z]+)\s+(\S+)\s*\n\s*([A-Za-z_][A-Za-z0-9_]*)\s*@\d+/g;
    while ((mm = commentRe.exec(body))) {
      const [, verb, path, methodName] = mm;
      const key = `${ifaceName}.${methodName}`;
      if (!out.has(key)) out.set(key, { path, method: verb });
    }
  }
  return out;
}

export function stripRestAnnotations(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf("$Rest.", i);
    if (idx < 0) { out.push(text.slice(i)); break; }
    out.push(text.slice(i, idx));
    let j = idx + "$Rest.".length;
    while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== "(") { i = j; continue; }
    let depth = 1;
    j++;
    let inStr = false;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (inStr) {
        if (c === "\\") { j += 2; continue; }
        if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "(") depth++;
        else if (c === ")") depth--;
      }
      j++;
    }
    i = j;
  }
  return out.join("");
}

function sanitizeOpenapiName(name) {
  return String(name)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function deriveRestParams(paramsStruct, pathTemplate, verb) {
  const out = [];
  if (!paramsStruct) return { restParams: out, bodyEncoding: null };
  const pathTokens = new Set([...pathTemplate.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const carriesBody = ["POST", "PUT", "PATCH"].includes(verb);
  let bodyEncoding = null;
  for (const f of paramsStruct.fields ?? []) {
    let inLoc;
    if (pathTokens.has(f.name)) {
      inLoc = "path";
    } else if (carriesBody) {
      inLoc = "body";
      bodyEncoding = "json";
    } else {
      inLoc = "query";
    }
    out.push({
      name: f.name,
      type: f.type ?? "unknown",
      role: inLoc,
      optional: inLoc !== "path",
    });
  }
  return { restParams: out, bodyEncoding };
}

export function buildRestApisFromAnnotations(annotations, interfaces, structs) {
  const out = [];
  for (const iface of interfaces ?? []) {
    const methods = [];
    for (const m of iface.methods ?? []) {
      const ann = annotations.get(`${iface.name}.${m.name}`);
      if (!ann?.path || !ann?.method) continue;
      const paramsStruct  = structs.find((s) => s.name === `${m.name}$Params`);
      const resultsStruct = structs.find((s) => s.name === `${m.name}$Results`);
      const verb = ann.method.toUpperCase();
      const { restParams, bodyEncoding } = deriveRestParams(paramsStruct, ann.path, verb);
      methods.push({
        name: m.name,
        method: verb,
        path: ann.path,
        params: restParams,
        returnType: resultsStruct ? sanitizeOpenapiName(resultsStruct.name) : "unknown",
        isAsyncIterable: false,
        decode: null,
        bodyEncoding,
        paginated: null,
      });
    }
    if (methods.length > 0) {
      out.push({
        name: iface.name,
        baseUrl: "",
        defaults: {},
        methods,
      });
    }
  }
  return out;
}

/**
 * One-call helper that mirrors `parseSchema(path)` in `bin/capnwasm.mjs`
 * but takes the source as a string (so it works in the browser).
 *
 * @param {object} compiler  - CapnpCompiler instance (already loaded)
 * @param {string} name      - logical filename (used in error messages)
 * @param {string} text      - .capnp source text
 * @returns {Promise<{ structs, interfaces, restApis, typeInterfaces }>}
 */
export async function parseCapnpText(compiler, name, text) {
  const annotations = scanRestAnnotations(text);
  const sanitized = stripRestAnnotations(text);
  const structs = await compiler.compileToModel(name, sanitized);
  const interfaces = compiler.extractInterfaces?.() ?? [];
  validateStructs(structs);
  const restApis = buildRestApisFromAnnotations(annotations, interfaces, structs);
  return { structs, interfaces, restApis, typeInterfaces: [] };
}
