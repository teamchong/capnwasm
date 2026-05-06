#!/usr/bin/env node
// capnwasm. Single CLI for codegen, build, and bench. Same package also
// exposes the runtime as a browser/node import via `import { CapnCpp } from
// "capnwasm"`.
//
// Usage:
//   npx capnwasm gen <schema.capnp> [-o output.gen.mjs]
//   npx capnwasm build                # rebuild zig-out/capnp_cpp.opt.wasm
//   npx capnwasm bench                # run the Playwright bench
//   npx capnwasm <schema.capnp>       # shorthand for gen

import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, basename, resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

function topUsage() {
  console.error(`capnwasm. Typed clients from one schema, two wire formats

Usage:
  npx capnwasm gen <schema.capnp|schema.ts> [-o output.gen.mjs]
      Generate a Cap'n Proto reader/builder, or (when the .ts file declares
      an @rest interface) a typed REST client.

  npx capnwasm openapi <spec.yaml|spec.json> [-o output.gen.mjs]
      Generate a typed REST client from an OpenAPI 3.x spec. Works against
      any service that publishes one (Stripe, GitHub, Twilio, etc.).

  npx capnwasm manifest <schema.capnp|schema.ts|spec.yaml|spec.json> [-o out.json|-]
      Emit canonical operation manifest as JSON. One stable shape across
      all input formats; for downstream tools (drift detectors, mock
      generators, doc generators, contract test harnesses).

  npx capnwasm harness <manifest.json> --gen <gen-import> [-o out.test.mjs|-]
      Emit a Node --test contract harness that exercises every operation
      from the manifest. capnp methods run against an in-process mock by
      default (override with CAPNWASM_HARNESS_TARGET=ws://...); REST
      methods need CAPNWASM_HARNESS_REST_TARGET=https://... to run.

  npx capnwasm probe <manifest.json> [--target <ws://...>] [--rest-target <https://...>] [-o report.json|-]
      Smoke/conformance probe. Exercises every operation against a live
      target and reports observable schema/runtime drift. capnp surfaces
      call/decode success and readable-vs-unreadable declared fields;
      REST surfaces HTTP status, observed response keys, and missing /
      extra top-level keys when the manifest has a known object shape.

  npx capnwasm compat <old.manifest.json> <new.manifest.json> [-o report.json|-]
      Conservative manifest compatibility check. Computes stable contract
      fingerprints and reports a breaking/non-breaking changeset between
      two schema versions. Exit code 2 when breaking changes are found.

  npx capnwasm build                Rebuild zig-out/capnp_cpp.opt.wasm
  npx capnwasm bench                Run the Playwright bench
  npx capnwasm <file>               Shorthand: dispatches by extension.

Library: import { CapnCpp } from "capnwasm";          (capnp runtime)
         import { auth } from "capnwasm/rest";        (REST runtime)
`);
  process.exit(1);
}

function parseGenArgs(argv) {
  const args = { schema: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o" || argv[i] === "--output") {
      args.output = argv[++i];
    } else if (!args.schema) {
      args.schema = argv[i];
    }
  }
  if (!args.schema) topUsage();
  if (!existsSync(args.schema)) {
    console.error(`schema file not found: ${args.schema}`);
    process.exit(1);
  }
  if (!args.output) {
    const stem = basename(args.schema, extname(args.schema));
    args.output = resolve(dirname(args.schema), `${stem}.gen.mjs`);
  }
  return args;
}

/**
 * Parse a TypeScript file's interface declarations into our struct model.
 *
 * Strategy: line-based. We walk the file one line at a time, track which
 * interface body we're inside (via brace depth), and read directive
 * comments as they precede field declarations. Easy to reason about, hard
 * to break.
 *
 * Supported subset:
 *   export? interface Name {
 *     // @capnp Int64        -- optional type override directive
 *     // @ordinal N           -- optional explicit @-ordinal
 *     fieldName: tsType;
 *     // ...
 *   }
 *
 * Default TS -> Cap'n Proto type mapping:
 *   string     -> Text
 *   boolean    -> Bool
 *   bigint     -> Int64
 *   Uint8Array -> Data
 *   number     -> Float64    (JS number is double; override with @capnp)
 *   OtherName  -> struct reference (must also be in this file)
 *
 * Anything else inside an interface body (methods, unions, generics,
 * mapped types, computed properties) raises an explicit error so users
 * are never silently shipped a half-broken reader.
 */
const TS_TO_CAPNP = {
  "string":     "Text",
  "boolean":    "Bool",
  "bigint":     "Int64",
  "Uint8Array": "Data",
  "number":     "Float64",
};

const VALID_CAPNP_PRIMS = new Set([
  "Bool",
  "UInt8", "UInt16", "UInt32", "UInt64",
  "Int8",  "Int16",  "Int32",  "Int64",
  "Float32", "Float64",
  "Text", "Data", "Void",
  // AnyPointer is a real capnp type; emit-capnp uses it for unresolved
  // refs, additionalProperties-only objects, and anything without a
  // structural translation. Capnpc accepts it natively.
  "AnyPointer",
]);

// HTTP method directives recognised on REST interface methods. Each maps to
// the wire HTTP verb. The path follows after one space.
const REST_METHOD_DIRECTIVES = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

async function parseTsInterfaces(text) {
  const lines = text.split(/\r?\n/);
  const structs = [];
  const restApis = [];
  const typeInterfaces = [];
  // Pre-scan: if the file declares any @rest interface, non-REST interfaces
  // become pure TypeScript type definitions (we capture their bodies
  // verbatim and re-emit in the .d.ts; we don't parse their fields as
  // capnp wire types). This lets REST schemas use full TS syntax (arrays,
  // nullable, unions) without bumping into capnp's stricter type model.
  const hasRest = /^\s*\/\/\s*@rest\b/m.test(text);

  let current = null;        // capnp-struct accumulator
  let currentRest = null;    // rest-api accumulator
  let currentType = null;    // pure TS type accumulator (only when hasRest)
  let braceDepth = 0;
  let pendingDirectives = {};
  let pendingMethodDirectives = {};
  let pendingInterfaceDirectives = {};

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    const stripped = raw.replace(/\/\*.*?\*\//g, "").trimEnd();

    // ---- TOP LEVEL: looking for an interface header ----
    if (current === null && currentRest === null && currentType === null) {
      // Top-level directives (apply to next interface): @rest, @auth, @retries, @timeout
      const idm = stripped.match(/^\s*\/\/\s*@(rest|auth|retries|timeout|baseUrl)\s*(.*)$/);
      if (idm) {
        pendingInterfaceDirectives[idm[1]] = idm[2].trim();
        continue;
      }

      const m = stripped.match(/^\s*(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]*)\s*{?\s*$/);
      if (m) {
        const name = m[1];
        const isRest = "rest" in pendingInterfaceDirectives;
        if (isRest) {
          currentRest = {
            name,
            methods: [],
            baseUrl: parseRestBaseUrl(pendingInterfaceDirectives.rest, pendingInterfaceDirectives.baseUrl),
            defaults: parseRestDefaults(pendingInterfaceDirectives),
          };
        } else if (hasRest) {
          // Pure TS type interface alongside a REST API. Capture the
          // body verbatim so we can re-emit it in the .d.ts.
          currentType = { name, body: [] };
        } else {
          current = { name, fields: [], nextOrdinal: 0 };
        }
        braceDepth = stripped.endsWith("{") ? 1 : 0;
        pendingDirectives = {};
        pendingMethodDirectives = {};
        pendingInterfaceDirectives = {};
      }
      continue;
    }

    // ---- INSIDE A BODY: track braces ----
    for (const ch of stripped) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }
    if (!stripped.trim()) continue;

    if (braceDepth === 0) {
      if (current) { structs.push({ name: current.name, fields: current.fields }); current = null; }
      else if (currentRest) { restApis.push(currentRest); currentRest = null; }
      else if (currentType) { typeInterfaces.push(currentType); currentType = null; }
      pendingDirectives = {};
      pendingMethodDirectives = {};
      continue;
    }

    // ---- TYPE-ONLY TS INTERFACE BODY (verbatim capture) ----
    if (currentType) {
      // Just collect the line so we can re-emit it. Skip whitespace-only
      // lines from being collapsed; preserve original formatting.
      currentType.body.push(stripped);
      continue;
    }

    // ---- REST INTERFACE BODY ----
    if (currentRest) {
      // Directive comments for the next method: @get/@post/etc, @query, @body, @header, @paginated.
      const md = stripped.match(/^\s*\/\/\s*@([a-zA-Z]+)\s*(.*)$/);
      if (md) {
        const dir = md[1].toLowerCase();
        const arg = md[2].trim();
        if (REST_METHOD_DIRECTIVES.has(dir)) {
          pendingMethodDirectives.method = dir.toUpperCase();
          pendingMethodDirectives.path = arg;
        } else if (dir === "query" || dir === "header" || dir === "body" || dir === "paginated"
                || dir === "decode" || dir === "bodyencoding") {
          // These can repeat (multiple @query lines). Accumulate as arrays/maps.
          if (dir === "query" || dir === "header") {
            (pendingMethodDirectives[dir + "s"] ||= []).push(arg);
          } else {
            pendingMethodDirectives[dir] = arg;
          }
        } else {
          throw new Error(`capnwasm: line ${lineNo + 1}: unknown REST directive '@${dir}'`);
        }
        continue;
      }
      if (/^\s*\/\//.test(stripped)) continue;  // plain comment

      // Method declaration. Forms supported:
      //   methodName(arg1: T1, arg2?: T2): Promise<R>;
      //   methodName(arg1: T1): AsyncIterable<R>;
      const sig = parseMethodSignature(stripped);
      if (sig) {
        if (!pendingMethodDirectives.method) {
          throw new Error(`capnwasm: line ${lineNo + 1}: REST method '${sig.name}' has no @get/@post/etc. directive`);
        }
        currentRest.methods.push(buildRestMethod(sig, pendingMethodDirectives, lineNo + 1));
        pendingMethodDirectives = {};
        continue;
      }
      throw new Error(`capnwasm: line ${lineNo + 1}: cannot parse REST method '${raw.trim()}'`);
    }

    // ---- CAPNP STRUCT BODY (existing code) ----
    const dm = stripped.match(/^\s*\/\/\s*@(capnp|ordinal)\s+(\S+)\s*$/);
    if (dm) { pendingDirectives[dm[1]] = dm[2]; continue; }
    if (/^\s*\/\//.test(stripped)) continue;

    const fm = stripped.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[;,]?\s*$/);
    if (fm) {
      const tsName = fm[1];
      const tsType = fm[2];
      let capnpType = pendingDirectives.capnp ?? TS_TO_CAPNP[tsType];
      if (!capnpType && /^[A-Z]/.test(tsType)) capnpType = tsType;
      if (!capnpType) {
        throw new Error(`capnwasm: line ${lineNo + 1}: unsupported TS type '${tsType}'. Add '// @capnp <Type>' directive.`);
      }
      if (pendingDirectives.capnp && !VALID_CAPNP_PRIMS.has(pendingDirectives.capnp)
          && !/^[A-Z][A-Za-z0-9_]*$/.test(pendingDirectives.capnp)) {
        throw new Error(`capnwasm: line ${lineNo + 1}: '@capnp ${pendingDirectives.capnp}' is not a recognized Cap'n Proto type.`);
      }
      const ordinal = pendingDirectives.ordinal !== undefined
        ? +pendingDirectives.ordinal
        : current.nextOrdinal++;
      if (pendingDirectives.ordinal !== undefined) current.nextOrdinal = ordinal + 1;
      current.fields.push({ name: tsName, ordinal, type: capnpType });
      pendingDirectives = {};
      continue;
    }

    throw new Error(`capnwasm: line ${lineNo + 1}: cannot parse '${raw.trim()}'. Supported: simple field declarations 'name: Type;'`);
  }

  if (current !== null || currentRest !== null || currentType !== null) {
    throw new Error("capnwasm: TS source ended inside an interface body (unbalanced braces).");
  }
  validateStructs(structs);
  computeOffsets(structs);
  return { structs, restApis, typeInterfaces };
}

/** Parse `@rest baseUrl=https://...` or just `@rest`, plus a separate `@baseUrl` line. */
function parseRestBaseUrl(restArg, baseUrlArg) {
  if (baseUrlArg) return baseUrlArg;
  if (!restArg) return "";
  const m = restArg.match(/baseUrl=(\S+)/);
  if (m) return m[1];
  // Allow positional form: `@rest https://...`
  const tok = restArg.trim();
  if (/^https?:\/\//.test(tok)) return tok;
  return "";
}

/** Parse top-level @auth, @retries, @timeout into a defaults object. */
function parseRestDefaults(dirs) {
  const out = {};
  if (dirs.auth) {
    // Accept `@auth bearer`, `@auth apiKey header=X-API-Key`, `@auth basic`
    const parts = dirs.auth.trim().split(/\s+/);
    out.auth = { type: parts[0] };
    for (let i = 1; i < parts.length; i++) {
      const [k, v] = parts[i].split("=");
      out.auth[k] = v;
    }
  }
  if (dirs.retries) {
    // `@retries count=3 backoff=exponential`
    const obj = {};
    for (const tok of dirs.retries.split(/\s+/)) {
      const [k, v] = tok.split("=");
      obj[k] = isNaN(+v) ? v : +v;
    }
    out.retries = obj;
  }
  if (dirs.timeout) out.timeout = +dirs.timeout;
  return out;
}

/** Parse `methodName(a: T, b?: T2): Promise<R>;` into a structured signature. */
function parseMethodSignature(line) {
  const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*)\s*\)\s*:\s*(Promise|AsyncIterable)\s*<\s*(.+?)\s*>\s*[;,]?\s*$/);
  if (!m) return null;
  const [, name, paramsStr, returnContainer, returnType] = m;
  const params = [];
  if (paramsStr.trim()) {
    for (const p of splitParams(paramsStr)) {
      const pm = p.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\?)?\s*:\s*(.+?)\s*$/);
      if (!pm) throw new Error(`cannot parse parameter '${p}'`);
      params.push({ name: pm[1], optional: !!pm[2], type: pm[3].trim() });
    }
  }
  return { name, params, returnContainer, returnType: returnType.trim() };
}

/** Split a parameter list on commas not inside angle brackets. */
function splitParams(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Combine a parsed signature with the surrounding directives into a full method model. */
function buildRestMethod(sig, dirs, lineNo) {
  const { method, path } = dirs;
  // Determine which params are path params (referenced in the template),
  // which are query params (declared via @query), header params (@header),
  // and which is the body param (@body or sole non-path POST/PUT/PATCH arg).
  const pathParamNames = new Set([...(path.matchAll(/{([^}]+)}/g))].map(m => m[1]));

  // @query directives: each line is `@query paramName` (paramName matches a
  // method parameter; query key is the same as paramName by convention).
  const queryParamNames = new Set();
  for (const q of dirs.querys ?? []) queryParamNames.add(q.split(/\s+/)[0]);

  // @header directives: support `@header paramName` (header name = paramName)
  // OR `@header WireName paramName` (explicit mapping). Useful when the wire
  // header has chars that aren't valid TS identifiers (e.g. X-Trace-Id).
  const headerMap = new Map();   // paramName -> wireHeaderName
  for (const h of dirs.headers ?? []) {
    const tokens = h.split(/\s+/);
    if (tokens.length === 1) headerMap.set(tokens[0], tokens[0]);
    else if (tokens.length >= 2) headerMap.set(tokens[1], tokens[0]);
  }

  // @body paramName. Explicit body param. If just `@body` (no name), the
  // body is auto-assigned (see below).
  let explicitBody = null;
  if (dirs.body) {
    const tok = dirs.body.split(/\s+/)[0];
    if (tok) explicitBody = tok;
  }

  const paramRoles = sig.params.map(p => {
    if (pathParamNames.has(p.name)) return { ...p, role: "path" };
    if (queryParamNames.has(p.name)) return { ...p, role: "query" };
    if (headerMap.has(p.name)) return { ...p, role: "header", wireName: headerMap.get(p.name) };
    if (explicitBody === p.name) return { ...p, role: "body" };
    return { ...p, role: null };
  });

  // Auto-assign body for POST/PUT/PATCH if none specified and exactly one
  // unassigned non-scalar-looking param remains.
  if (!explicitBody && (method === "POST" || method === "PUT" || method === "PATCH")) {
    const unassigned = paramRoles.filter(p => p.role === null);
    if (unassigned.length === 1) unassigned[0].role = "body";
  }

  // Anything still unassigned: treat as query parameter (the most permissive
  // default. It shows up as a ?key=value pair on the URL).
  for (const p of paramRoles) if (p.role === null) p.role = "query";

  // Validate all path-template names are bound.
  for (const required of pathParamNames) {
    if (!paramRoles.find(p => p.role === "path" && p.name === required)) {
      throw new Error(`capnwasm: line ${lineNo}: path template '${path}' references {${required}} but no parameter with that name`);
    }
  }

  return {
    name: sig.name,
    method, path,
    params: paramRoles,
    returnType: sig.returnType,
    isAsyncIterable: sig.returnContainer === "AsyncIterable",
    decode: dirs.decode || null,
    bodyEncoding: dirs.bodyencoding || null,
    paginated: dirs.paginated ? parsePaginated(dirs.paginated) : null,
  };
}

/** Parse `@paginated cursor=starting_after items=data next=next_cursor`. */
function parsePaginated(arg) {
  const out = { style: "cursor" };
  const tokens = arg.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok === "cursor" || tok === "page") { out.style = tok; continue; }
    const [k, v] = tok.split("=");
    if (!v) continue;
    if (k === "cursor")          out.cursorRequestParam = v;
    else if (k === "next")       out.cursorResponseField = v;
    else if (k === "items")      out.itemsField = v;
    else if (k === "page")       out.pageRequestParam = v;
    else if (k === "total")      out.totalField = v;
    else if (k === "startPage")  out.startPage = +v;
  }
  return out;
}

/**
 * Cross-check that every field's type is either a known Cap'n Proto
 * primitive or a struct declared in the same file. Catches typos in
 * `// @capnp Foo` directives and forward references to non-existent types.
 */
function validateStructs(structs) {
  const declared = new Set(structs.map((s) => s.name));
  for (const s of structs) {
    for (const f of s.fields) {
      if (validCapnpType(f.type, declared)) continue;
      throw new Error(
        `capnwasm: ${s.name}.${f.name}: type '${f.type}' is not a known ` +
        `Cap'n Proto primitive nor a struct declared in this file.`
      );
    }
  }
}

function validCapnpType(t, declared) {
  if (typeof t !== "string") return false;
  if (VALID_CAPNP_PRIMS.has(t)) return true;
  if (declared.has(t)) return true;
  // Capability(<Iface>) is the codegen tag for interface-typed fields.
  // The inner name may be an unresolved interface (when only the struct
  // shapes are declared in this file's struct table) or "AnyPointer".
  // Either way the codegen knows what to do, so accept the wrapper.
  if (t.startsWith("Capability(") && t.endsWith(")")) return true;
  // List(X) is valid when X is; recurse so List(List(...)) chains work.
  // Use balanced-paren matching since X may itself contain parens.
  if (t.startsWith("List(") && t.endsWith(")")) {
    return validCapnpType(t.slice(5, -1), declared);
  }
  return false;
}

// .capnp files are compiled via our wasm-built capnp schema compiler
// (zig-out/capnpc.opt.wasm), so the same vendored sources produce both
// runtime and compiler. No version skew, no external binary required.
//
// Cached compiler instance. Wasm load is one-time and the compiler is
// heavyweight. Reused across all .capnp parses in a single CLI invocation.
let _capnpCompiler = null;
async function getCapnpCompiler() {
  if (_capnpCompiler) return _capnpCompiler;
  const { CapnpCompiler } = await import("../js/capnpc_loader.mjs");
  _capnpCompiler = await CapnpCompiler.load();
  return _capnpCompiler;
}

/**
 * Compile a .capnp text through the bundled wasm capnp compiler and
 * return the structs with wire layouts. Used by the pipeline runner
 * when emit-codec is requested on an OpenAPI-source manifest.
 */
export async function compileCapnpForCodec(capnpText) {
  const compiler = await getCapnpCompiler();
  const structs = await compiler.compileToModel("emit-codec.capnp", capnpText);
  validateStructs(structs);
  return structs;
}

/**
 * Parse a .capnp / .ts source into the canonical model shape consumed
 * by buildManifest. Exported so the unified pipeline runner (which
 * lives in js/run_pipeline.mjs) doesn't have to duplicate this logic.
 */
export async function parseSchema(schemaPath) {
  const abs = resolve(schemaPath);
  const text = await import("node:fs/promises").then((m) => m.readFile(abs, "utf8"));
  if (abs.endsWith(".ts") || abs.endsWith(".tsx")) {
    return parseTsInterfaces(text);
  }
  // .capnp paths. Compile via our bundled wasm-built capnp compiler. No
  // external binary, no version skew with the runtime. The same vendor/
  // sources produce both compiler and runtime, guaranteed compatible.
  //
  // The compiler doesn't recognize the `$Rest.*` annotations capnwasm
  // uses for HTTP semantics (path, method, status). Scan them out of
  // the source text first, then strip them before handing the source
  // to the compiler so it can compile the bare interface.
  const restAnnotations = scanRestAnnotations(text);
  const sanitized = stripRestAnnotations(text);
  const compiler = await getCapnpCompiler();
  const structs = await compiler.compileToModel(basename(abs), sanitized);
  const interfaces = compiler.extractInterfaces();
  validateStructs(structs);
  const restApis = buildRestApisFromAnnotations(restAnnotations, interfaces, structs);
  return { structs, interfaces, restApis, typeInterfaces: [] };
}

// --- $Rest annotation scanner ----------------------------------------

function scanRestAnnotations(text) {
  // Map: `${ifaceName}.${methodName}` → { path, method }.
  const out = new Map();
  const stripped = text.replace(/#[^\n]*/g, "");
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
    const methodRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*@\d+\s*\([^;]*?;/gs;
    let mm;
    while ((mm = methodRe.exec(body))) {
      const decl = mm[0];
      const path = decl.match(/\$Rest\.path\(\s*"([^"]+)"\s*\)/)?.[1];
      const method = decl.match(/\$Rest\.method\(\s*"([^"]+)"\s*\)/)?.[1];
      if (path && method) out.set(`${ifaceName}.${mm[1]}`, { path, method });
    }
  }
  return out;
}

function stripRestAnnotations(text) {
  // Remove every `$Rest.<name>(...)` annotation. The arg list can
  // contain commas and quoted strings; this scanner walks parens to
  // find the matching close.
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

function buildRestApisFromAnnotations(annotations, interfaces, structs) {
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
        // Carry the result struct's name so emit-openapi can reference
        // it via $ref in the success response. capnp methods always
        // produce a struct-typed result; AnyPointer would be a fallback.
        // The struct name is sanitized (drops capnp's `$` separator)
        // so the OpenAPI components.schemas key works in every
        // downstream tool.
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

function deriveRestParams(paramsStruct, pathTemplate, verb) {
  // Map the params struct's fields onto REST param locations:
  //   • any field whose name appears as `{name}` in the path → "path"
  //   • for verbs that carry a body (POST/PUT/PATCH), every non-path
  //     field goes into the request body. Per-field metadata records
  //     `bodyProp: true` so emit-openapi knows to bundle them as
  //     properties of an object schema.
  //   • everything else (GET/HEAD/OPTIONS/DELETE) → "query"
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
      // Capnp types pass through verbatim. emit-openapi knows how to
      // render Float32 → {type:number, format:float}, Int32 →
      // {type:integer, format:int32}, etc. Translating to TS-string
      // primitives here would lose that precision.
      name: f.name,
      type: f.type ?? "unknown",
      role: inLoc,
      optional: inLoc !== "path",
    });
  }
  return { restParams: out, bodyEncoding };
}

/**
 * Sanitize a capnp struct name for use as an OpenAPI components.schemas
 * key. Drops the `$` capnp uses between method-name and Params/Results
 * (e.g. `getPet$Results` → `GetPetResults`) and PascalCases the result
 * so the OpenAPI key reads naturally.
 */
function sanitizeOpenapiName(name) {
  return String(name)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}


/**
 * Assign each field its wire-format offset following Cap'n Proto's actual
 * data-section layout algorithm:
 *
 *   1. Pointer-typed fields go in the pointer section, sequential index.
 *   2. For data fields, walk @-ordinal order. Try to place in the first
 *      existing "hole" (padding gap from a previous larger field) that
 *      both fits the size and has correct alignment.
 *   3. If no hole works, extend the data section. Aligning may create a
 *      new hole between the previous high-water mark and the new field.
 *
 * Without hole-filling, layouts diverge from upstream `capnp compile`
 * whenever fields are not in size-decreasing order. Readers get garbage
 * because the offset they compute doesn't match where the writer put the
 * value.
 */
function computeOffsets(structs) {
  for (const s of structs) {
    let nextPtr = 0;
    let dataBits = 0;
    const holes = [];  // each: {start, size}

    for (const f of s.fields) {
      if (isPointerType(f.type)) {
        f.kind = "pointer";
        f.ptrIndex = nextPtr++;
        continue;
      }
      const size = primitiveBitSize(f.type);
      f.kind = "data";
      f.bitSize = size;
      if (size === 0) { f.bitOffset = 0; continue; }

      // Try existing holes (smallest-first, then by position).
      holes.sort((a, b) => a.size - b.size || a.start - b.start);
      let placed = false;
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (h.size < size) continue;
        if (h.start % size !== 0) continue;
        f.bitOffset = h.start;
        if (h.size === size) {
          holes.splice(i, 1);
        } else {
          h.start += size;
          h.size -= size;
        }
        placed = true;
        break;
      }
      if (placed) continue;

      // No hole worked. Extend the data section. Alignment padding becomes
      // a new hole that later fields can fill.
      const aligned = Math.ceil(dataBits / size) * size;
      if (aligned > dataBits) {
        holes.push({ start: dataBits, size: aligned - dataBits });
      }
      f.bitOffset = aligned;
      dataBits = aligned + size;
    }
    // Round up to whole-word data section + persist sizes on the struct
    // so the Builder codegen can call cpp_any_builder_init with correct sizes.
    s.dataWords = Math.ceil(dataBits / 64);
    s.ptrWords  = nextPtr;
  }
}

function isPointerType(t) {
  if (t === "Text" || t === "Data" || t === "AnyPointer") return true;
  if (t.startsWith("List(")) return true;
  // Treat capitalized identifiers (other than primitives) as struct refs.
  if (/^[A-Z]/.test(t)) {
    return !/^(Bool|UInt8|UInt16|UInt32|UInt64|Int8|Int16|Int32|Int64|Float32|Float64|Void)$/.test(t);
  }
  return false;
}

function primitiveBitSize(t) {
  switch (t) {
    case "Bool":   return 1;
    case "UInt8":  case "Int8":  return 8;
    case "UInt16": case "Int16": return 16;
    case "UInt32": case "Int32": case "Float32": return 32;
    case "UInt64": case "Int64": case "Float64": return 64;
    case "Void":   return 0;
    default:       return 64;  // fallback
  }
}

/**
 * Emit a typed reader class per struct.
 *
 * Each field becomes a getter on the prototype that calls the appropriate
 * `cpp_any_*` primitive with its precomputed offset. Property access is a
 * normal V8 inlinable call. No string lookup, no Proxy.
 */
function generateJs(structs, schemaName) {
  const lines = [];
  lines.push(`// Generated from ${schemaName} by capnwasm-gen. Do not edit by hand.`);
  lines.push("");
  lines.push(`const SHARED_TEXT_DECODER = new TextDecoder();`);
  lines.push(`const SHARED_ENCODER = new TextEncoder();`);
  // Decode UTF-8 bytes to a string. The shared TextDecoder is the
  // fastest path across the size range that matters (~12 B and up):
  //   4 KB:  TextDecoder 0.4 µs vs hand-rolled loop 13 µs   (30x slower)
  //   64 KB: TextDecoder 4.1 µs vs hand-rolled loop 305 µs  (75x slower)
  // The earlier "ASCII fast-path" loop was a premature pessimization -
  // V8's TextDecoder.decode is V8-internal C++ and dwarfs any JS loop
  // once strings get above a handful of bytes.
  lines.push(`function decodeAscii(bytes) {`);
  lines.push(`  return SHARED_TEXT_DECODER.decode(bytes);`);
  lines.push(`}`);
  lines.push("");
  // M5: Pure-JS Cap'n Proto pointer decoder (Text + Data path).
  //
  // Returns string for Text on success, null for null pointer, undefined
  // when the wire shape requires the C++ fallback (FAR pointer, multi-
  // segment, OTHER kind, out-of-bounds offset, or anything we don't yet
  // implement). Pointer encoding reference: cpp/vendor/capnp/layout.c++
  // (the upstream FlatArrayMessageReader we stay byte-for-byte
  // compatible with) and js/pointer_decoder.mjs (the standalone
  // implementation with full comments). Inlined here so the generated
  // module has zero relative imports.
  //
  // Args:
  //   u8        Uint8Array view of WebAssembly.Memory.
  //   dv        DataView over the same buffer.
  //   dataPtr   Byte address of the struct's data section.
  //   dataWords Number of 8-byte words in the struct's data section
  //             (struct's static _DATA_WORDS). Pointer section starts
  //             at dataPtr + dataWords*8.
  //   ptrIndex  Pointer slot index (0-based).
  //   msgStart  First byte address of the message payload (after the
  //             8-byte framed header). msgEnd is one past the last byte.
  lines.push(`function _jsReadTextPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {`);
  lines.push(`  if (!msgEnd) return undefined;`);
  lines.push(`  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;`);
  lines.push(`  return _jsReadTextPtrAt(u8, dv, ptrAddr, msgStart, msgEnd);`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function _jsReadDataPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {`);
  lines.push(`  if (!msgEnd) return undefined;`);
  lines.push(`  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;`);
  lines.push(`  return _jsReadDataPtrAt(u8, dv, ptrAddr, msgStart, msgEnd);`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function _jsReadListPointerPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {`);
  lines.push(`  if (!msgEnd) return undefined;`);
  lines.push(`  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;`);
  lines.push(`  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;`);
  lines.push(`  const word0 = dv.getUint32(ptrAddr, true);`);
  lines.push(`  const word1 = dv.getUint32(ptrAddr + 4, true);`);
  lines.push(`  if (word0 === 0 && word1 === 0) return { elementsBase: 0, count: 0 };`);
  lines.push(`  if ((word0 & 3) !== 1) return undefined;`);
  lines.push(`  if ((word1 & 7) !== 6) return undefined;`);
  lines.push(`  const offset = dv.getInt32(ptrAddr, true) >> 2;`);
  lines.push(`  const count = word1 >>> 3;`);
  lines.push(`  const elementsBase = ptrAddr + 8 + offset * 8;`);
  lines.push(`  if (elementsBase < msgStart || elementsBase + count * 8 > msgEnd) return undefined;`);
  lines.push(`  return { elementsBase, count };`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function _jsReadTextPtrAt(u8, dv, ptrAddr, msgStart, msgEnd) {`);
  lines.push(`  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;`);
  lines.push(`  const word0 = dv.getUint32(ptrAddr, true);`);
  lines.push(`  const word1 = dv.getUint32(ptrAddr + 4, true);`);
  lines.push(`  if (word0 === 0 && word1 === 0) return null;`);
  lines.push(`  if ((word0 & 3) !== 1) return undefined;`);
  lines.push(`  const offset = dv.getInt32(ptrAddr, true) >> 2;`);
  lines.push(`  if ((word1 & 7) !== 2) return undefined;`);
  lines.push(`  const count = word1 >>> 3;`);
  lines.push(`  if (count === 0) return undefined;`);
  lines.push(`  const target = ptrAddr + 8 + offset * 8;`);
  lines.push(`  if (target < msgStart || target + count > msgEnd) return undefined;`);
  lines.push(`  const len = count - 1;`);
  lines.push(`  if (len === 0) return "";`);
  lines.push(`  return SHARED_TEXT_DECODER.decode(u8.subarray(target, target + len));`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function _jsReadDataPtrAt(u8, dv, ptrAddr, msgStart, msgEnd) {`);
  lines.push(`  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;`);
  lines.push(`  const word0 = dv.getUint32(ptrAddr, true);`);
  lines.push(`  const word1 = dv.getUint32(ptrAddr + 4, true);`);
  lines.push(`  if (word0 === 0 && word1 === 0) return null;`);
  lines.push(`  if ((word0 & 3) !== 1) return undefined;`);
  lines.push(`  const offset = dv.getInt32(ptrAddr, true) >> 2;`);
  lines.push(`  if ((word1 & 7) !== 2) return undefined;`);
  lines.push(`  const count = word1 >>> 3;`);
  lines.push(`  const target = ptrAddr + 8 + offset * 8;`);
  lines.push(`  if (target < msgStart || target + count > msgEnd) return undefined;`);
  lines.push(`  return u8.slice(target, target + count);`);
  lines.push(`}`);
  lines.push("");
  // M5.5: List<Struct> pointer decoder. Returns a descriptor with
  // elementsBase, count, dataWords, ptrWords. Element i's data
  // section sits at elementsBase + i*(dataWords+ptrWords)*8.
  // INLINE_COMPOSITE wire format: pointer's count field holds total
  // element-data word count (not element count). The next word is a
  // STRUCT-shaped tag word whose offset field is the element count.
  // Returns undefined for FAR / OTHER / wrong elemSize / corrupt
  // tag (caller falls back to C++).
  // Decode a List(Primitive) pointer. Returns { elementsBase, count } on
  // success or undefined on any malformed/uncovered case (caller falls back
  // to the cursor path). `elemBytes` is the JS typed-array element size
  // (1, 2, 4, or 8); the capnp wire tag uses size codes 2..5 mapping to
  // 1, 2, 4, 8 bytes respectively. We accept the wire's size code as long
  // as it converts to the requested elemBytes; this catches misuse of
  // view() against a list of mismatched element width without falsely
  // returning bytes.
  lines.push(`const _ELEM_BYTES_TO_SIZE_CODE = { 1: 2, 2: 3, 4: 4, 8: 5 };`);
  lines.push(`function _jsReadListPrimPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd, elemBytes) {`);
  lines.push(`  if (!msgEnd) return undefined;`);
  lines.push(`  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;`);
  lines.push(`  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;`);
  lines.push(`  const word0 = dv.getUint32(ptrAddr, true);`);
  lines.push(`  const word1 = dv.getUint32(ptrAddr + 4, true);`);
  lines.push(`  if (word0 === 0 && word1 === 0) return { elementsBase: 0, count: 0 };`);
  lines.push(`  if ((word0 & 3) !== 1) return undefined;`);
  lines.push(`  const elemSizeCode = word1 & 7;`);
  lines.push(`  const expectedCode = _ELEM_BYTES_TO_SIZE_CODE[elemBytes];`);
  lines.push(`  if (elemSizeCode !== expectedCode) return undefined;`);
  lines.push(`  const offset = dv.getInt32(ptrAddr, true) >> 2;`);
  lines.push(`  const elementCount = word1 >>> 3;`);
  lines.push(`  const elementsBase = ptrAddr + 8 + offset * 8;`);
  lines.push(`  if (elementsBase + elementCount * elemBytes > msgEnd) return undefined;`);
  lines.push(`  if (elementsBase < msgStart) return undefined;`);
  lines.push(`  return { elementsBase, count: elementCount };`);
  lines.push(`}`);
  lines.push("");
  // Single struct pointer (kind=0). Returns
  //   { dataPtr, dataWords, ptrWords } on success
  //   null when the pointer slot is null (callers return a default Reader
  //                                       on the pointer's declared type)
  //   undefined when something the JS decoder cannot handle (FAR pointer,
  //             wrong kind, out-of-bounds). Caller falls back to C++.
  lines.push(`function _jsReadStructPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {`);
  lines.push(`  if (!msgEnd) return undefined;`);
  lines.push(`  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;`);
  lines.push(`  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;`);
  lines.push(`  const word0 = dv.getUint32(ptrAddr, true);`);
  lines.push(`  const word1 = dv.getUint32(ptrAddr + 4, true);`);
  lines.push(`  if (word0 === 0 && word1 === 0) return null;`);
  lines.push(`  if ((word0 & 3) !== 0) return undefined;`);
  lines.push(`  const offset = dv.getInt32(ptrAddr, true) >> 2;`);
  lines.push(`  const dWords = word1 & 0xffff;`);
  lines.push(`  const pWords = (word1 >>> 16) & 0xffff;`);
  lines.push(`  const target = ptrAddr + 8 + offset * 8;`);
  lines.push(`  const totalBytes = (dWords + pWords) * 8;`);
  lines.push(`  if (target < msgStart || target + totalBytes > msgEnd) return undefined;`);
  lines.push(`  return { dataPtr: target, dataWords: dWords, ptrWords: pWords };`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function _jsReadListStructPtr(u8, dv, dataPtr, dataWords, ptrIndex, msgStart, msgEnd) {`);
  lines.push(`  if (!msgEnd) return undefined;`);
  lines.push(`  const ptrAddr = dataPtr + (dataWords + ptrIndex) * 8;`);
  lines.push(`  if (ptrAddr < msgStart || ptrAddr + 8 > msgEnd) return undefined;`);
  lines.push(`  const word0 = dv.getUint32(ptrAddr, true);`);
  lines.push(`  const word1 = dv.getUint32(ptrAddr + 4, true);`);
  lines.push(`  if (word0 === 0 && word1 === 0) return null;`);
  lines.push(`  if ((word0 & 3) !== 1) return undefined;`);
  lines.push(`  if ((word1 & 7) !== 7) return undefined;`);
  lines.push(`  const offset = dv.getInt32(ptrAddr, true) >> 2;`);
  lines.push(`  const wordCount = word1 >>> 3;`);
  lines.push(`  const target = ptrAddr + 8 + offset * 8;`);
  lines.push(`  if (target < msgStart || target + 8 > msgEnd) return undefined;`);
  lines.push(`  const tag0 = dv.getUint32(target, true);`);
  lines.push(`  if ((tag0 & 3) !== 0) return undefined;`);
  lines.push(`  const elementCount = tag0 >>> 2;`);
  lines.push(`  const tagDataWords = dv.getUint16(target + 4, true);`);
  lines.push(`  const tagPtrWords = dv.getUint16(target + 6, true);`);
  lines.push(`  const wordsPerElement = tagDataWords + tagPtrWords;`);
  lines.push(`  if (wordsPerElement * elementCount !== wordCount) return undefined;`);
  lines.push(`  const elementsBase = target + 8;`);
  lines.push(`  if (elementsBase + elementCount * wordsPerElement * 8 > msgEnd) return undefined;`);
  lines.push(`  return { elementsBase, count: elementCount, dataWords: tagDataWords, ptrWords: tagPtrWords };`);
  lines.push(`}`);
  lines.push("");
  // AnyPointer reader handle: stored on AnyPointer-typed reader fields and
  // generic-parameter slots (T inside `Box(T)`). Caller decodes the slot
  // by calling .asText() / .asData() / .asStruct(SomeReader). The handle
  // captures the parent reader plus the pointer-slot byte address so the
  // decode functions can hit the segment-0 fast path or fall back to the
  // C++ cursor.
  lines.push(`class _AnyPointerReadHandle {`);
  lines.push(`  constructor(parent, parentDataWords, ptrIndex) {`);
  lines.push(`    this._parent = parent;`);
  lines.push(`    this._parentDataWords = parentDataWords;`);
  lines.push(`    this._ptrIndex = ptrIndex;`);
  lines.push(`  }`);
  lines.push(`  /** Returns the AnyPointer slot interpreted as Text, or null when the slot is null. */`);
  lines.push(`  asText() {`);
  lines.push(`    _ensureCapnwasmReader(this._parent);`);
  lines.push(`    const p = this._parent;`);
  lines.push(`    const v = _jsReadTextPtr(p._u8, p._dv, p._dataPtr, this._parentDataWords, this._ptrIndex, p._msgStart, p._msgEnd);`);
  lines.push(`    if (v !== undefined) return v ?? "";`);
  lines.push(`    const len = p._cpp._exports.cpp_any_text_at(this._ptrIndex);`);
  lines.push(`    if (len === 0) return "";`);
  lines.push(`    const out = p._cpp._outPtr;`);
  lines.push(`    return decodeAscii(p._cpp._u8.subarray(out, out + len));`);
  lines.push(`  }`);
  lines.push(`  /** Returns the AnyPointer slot as a Uint8Array (Data), or an empty array. */`);
  lines.push(`  asData() {`);
  lines.push(`    _ensureCapnwasmReader(this._parent);`);
  lines.push(`    const p = this._parent;`);
  lines.push(`    const v = _jsReadDataPtr(p._u8, p._dv, p._dataPtr, this._parentDataWords, this._ptrIndex, p._msgStart, p._msgEnd);`);
  lines.push(`    if (v !== undefined) return v ?? new Uint8Array(0);`);
  lines.push(`    const len = p._cpp._exports.cpp_any_data_at(this._ptrIndex);`);
  lines.push(`    const out = p._cpp._outPtr;`);
  lines.push(`    return p._cpp._u8.slice(out, out + len);`);
  lines.push(`  }`);
  lines.push(`  /** Decode the slot as a struct of the given Reader class. Pass the codegen reader class. */`);
  lines.push(`  asStruct(ReaderClass) {`);
  lines.push(`    _ensureCapnwasmReader(this._parent);`);
  lines.push(`    const p = this._parent;`);
  lines.push(`    const cpp = p._cpp;`);
  lines.push(`    const _msgStart = p._msgStart, _msgEnd = p._msgEnd;`);
  lines.push(`    const rebind = () => {`);
  lines.push(`      _ensureCapnwasmReader(p);`);
  lines.push(`      cpp._exports.cpp_any_slot_reset_root?.();`);
  lines.push(`      cpp._exports.cpp_any_enter_struct(this._ptrIndex);`);
  lines.push(`      cpp._bumpGeneration();`);
  lines.push(`    };`);
  lines.push(`    if (_msgEnd) {`);
  lines.push(`      const desc = _jsReadStructPtr(p._u8, p._dv, p._dataPtr, this._parentDataWords, this._ptrIndex, _msgStart, _msgEnd);`);
  lines.push(`      if (desc !== undefined) {`);
  lines.push(`        const dp = desc === null ? 0 : desc.dataPtr;`);
  lines.push(`        return new ReaderClass(cpp, dp, {`);
  lines.push(`          slotIdx: p._slotIdx,`);
  lines.push(`          msgStart: _msgStart,`);
  lines.push(`          msgEnd: _msgEnd,`);
  lines.push(`          gen: -1,`);
  lines.push(`          parent: p,`);
  lines.push(`          rebind,`);
  lines.push(`        });`);
  lines.push(`      }`);
  lines.push(`    }`);
  lines.push(`    rebind();`);
  lines.push(`    return new ReaderClass(cpp, 0, {`);
  lines.push(`      msg: p._msg,`);
  lines.push(`      slotIdx: p._slotIdx,`);
  lines.push(`      gen: cpp._generation ?? 0,`);
  lines.push(`      rebind,`);
  lines.push(`    });`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");
  // Pick helper: takes the FIELDS table + caller-requested names, packs a
  // batch request into cpp_lazy_aux, makes ONE wasm call, materializes the
  // result. Cost: 1 boundary crossing + 1 packed memcpy regardless of N.
  lines.push(`const _F32_VIEW_BUF = new ArrayBuffer(4);`);
  lines.push(`const _F32_VIEW_U32 = new Uint32Array(_F32_VIEW_BUF);`);
  lines.push(`const _F32_VIEW_F32 = new Float32Array(_F32_VIEW_BUF);`);
  lines.push(`const _F64_VIEW_BUF = new ArrayBuffer(8);`);
  lines.push(`const _F64_VIEW_U32 = new Uint32Array(_F64_VIEW_BUF);`);
  lines.push(`const _F64_VIEW_F64 = new Float64Array(_F64_VIEW_BUF);`);
  lines.push(``);
  // Helper bag passed to runtime-compiled list decoders. \`new Function\` builds
  // a closure-less function (compiled in global scope), so we can't reach the
  // module-level constants directly — we hand them in as one object.
  lines.push(`const _LIST_HELPERS = {`);
  lines.push(`  TD: SHARED_TEXT_DECODER,`);
  lines.push(`  F32U: _F32_VIEW_U32, F32F: _F32_VIEW_F32,`);
  lines.push(`  F64U: _F64_VIEW_U32, F64F: _F64_VIEW_F64,`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`// Per-(class, field-list) cache of pre-encoded request bytes. Compiling the
// request is a tight loop but it's still wasted work in a hot pick loop.
// We key on a frozen Uint8Array of the descriptor bytes so identical field
// sets (the common case in batch processing) hit the cache.
const _PICK_REQ_CACHE = new WeakMap();  // fields -> Map<namesKey, Uint8Array>
const _DRAFT_PLAN_CACHE = new WeakMap(); // fields -> WeakMap<fn, plan>

function _getPickRequest(fields, names) {
  let perFields = _PICK_REQ_CACHE.get(fields);
  if (!perFields) { perFields = new Map(); _PICK_REQ_CACHE.set(fields, perFields); }
  const key = names.join("\\0");
  let entry = perFields.get(key);
  if (entry) return entry;
  const buf = new Uint8Array(4 + names.length * 5);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, names.length, true);
  // Precompute the field-descriptor array alongside the request bytes. Both
  // are pure functions of (fields, names); caching them together means the
  // hot pick path skips a names.length-iteration property-lookup loop on
  // every call. The cached entry shape is { req, descs, listDecoder } where
  // listDecoder is lazily compiled the first time a List(Struct) projection
  // hits this field-set (most Pick callers never trigger it).
  const descs = new Array(names.length);
  let pos = 4;
  for (let i = 0; i < names.length; i++) {
    const d = fields[names[i]];
    if (!d) throw new Error("unknown field: " + names[i]);
    descs[i] = d;
    buf[pos] = d.kind; pos += 1;
    dv.setUint32(pos, d.off, true); pos += 4;
  }
  entry = { req: buf, descs, listDecoder: null };
  perFields.set(key, entry);
  return entry;
}

// Build a specialized JS function that decodes a row-tape produced by
// cpp_any_list_project into an Array of plain row objects, with the
// per-cell switch dispatch fully unrolled.
//
// The unrolled body lets V8 emit a single inline-cache chain per row, gives
// the row a stable hidden class via an object literal with all fields named
// in declaration order, and removes the per-cell descs[]/names[] indexing.
//
// Compiled once per (fields, names) pair, then cached on the same entry
// the request bytes live on. Roughly halves JS materialization cost vs the
// generic switch loop on the list-1000 user-row workload.
function _compileListDecoder(descs, names, applyMapFn, filter) {
  const cols = descs.length;
  const rowStride = cols * 4;
  // Validate filter: predicate field must be in projected names AND of a type
  // we know how to fast-check from a single header. For now we only support
  // boolean fields (cell is 0 or 1). If unsupported, drop filter — decoder
  // becomes the no-filter variant and the caller's outer fn re-runs filter
  // in JS. Correctness preserved.
  let filterColIdx = -1;
  if (filter) {
    filterColIdx = names.indexOf(filter.field);
    if (filterColIdx < 0 || (descs[filterColIdx] && descs[filterColIdx].type !== "bool")) {
      filter = null;
      filterColIdx = -1;
    }
  }
  // Identify runs of consecutive text fields (>=2) that share a contiguous
  // payload region — i.e. no payload-emitting field appears between them.
  // For such runs we emit ONE TextDecoder.decode call per row covering the
  // entire payload, then substring() per field. V8's substring on a freshly
  // decoded string is cheap, while each TextDecoder.decode has setup cost.
  // Measured on the 4-field user-row workload: this halves text-decode time
  // and shaves ~30% off list-1000 materialization.
  const PAYLOAD_BREAK = new Set(["uint64", "int64", "float64", "data"]);
  const isTextRunMember = (i) => descs[i] && descs[i].type === "text";
  const sharedTextEligible = descs.some((d) => d && d.type === "text") &&
    descs.every((d) => d && !PAYLOAD_BREAK.has(d.type));
  const textBatch = new Array(cols).fill(null);
  for (let i = 0; i < cols; i++) {
    if (!isTextRunMember(i) || textBatch[i] !== null) continue;
    let j = i + 1;
    while (j < cols) {
      if (isTextRunMember(j)) { j++; continue; }
      if (PAYLOAD_BREAK.has(descs[j] && descs[j].type)) break;
      j++;
    }
    // j is one past the last index that belongs to this run, considering
    // non-payload-emitting fields between text fields (small scalars / bool).
    // Filter run members back to actual text indices for emission.
    const members = [];
    for (let k = i; k < j; k++) if (isTextRunMember(k)) members.push(k);
    if (members.length >= 2) {
      // Tag each member with a shared run id and its position in the run.
      const runId = i;
      for (let p = 0; p < members.length; p++) {
        textBatch[members[p]] = { runId, pos: p, total: members.length, members };
      }
    }
  }
  const out = [];
  out.push(\`const TD = H.TD;\`);
  out.push(\`const F32U = H.F32U, F32F = H.F32F, F64U = H.F64U, F64F = H.F64F;\`);
  out.push(\`if (start === undefined) start = 0;\`);
  out.push(\`if (limit === undefined) limit = rows;\`);
  out.push(\`if (limit > rows) limit = rows;\`);
  out.push(\`if (start > limit) start = limit;\`);
  out.push(\`const arr = new Array(limit - start);\`);
  if (filter) out.push(\`let arrIdx = 0;\`);
  out.push(\`let readPos = 8 + rows * \${rowStride};\`);
  if (sharedTextEligible) {
    // If this projection's payload section contains only text bytes (no data
    // blobs or 64-bit scalar payloads) and those bytes are ASCII, decode the
    // whole payload once and slice substrings by byte offset. For non-ASCII,
    // fall back to the existing per-field decode so UTF-8 byte offsets never
    // get mistaken for JS string indices.
    out.push(\`const _payloadStart = readPos;\`);
    out.push(\`let _sharedText = null;\`);
    out.push(\`{\`);
    out.push(\`  const _payloadEnd = dv.byteLength;\`);
    out.push(\`  let _ascii = true;\`);
    out.push(\`  for (let _p = _payloadStart; _p < _payloadEnd; _p++) {\`);
    out.push(\`    if (u8[out + _p] & 0x80) { _ascii = false; break; }\`);
    out.push(\`  }\`);
    out.push(\`  if (_ascii) _sharedText = TD.decode(u8.subarray(out + _payloadStart, out + _payloadEnd));\`);
    out.push(\`}\`);
  }
  // Skip phase: when start > 0 we walk rows [0, start) advancing readPos by
  // the payload size of each row but never materializing. Each text/data
  // field contributes its header value (or 0 for missing); each
  // u64/i64/f64 contributes 8; smaller scalars and booleans contribute 0.
  // Specialized at codegen time so V8 sees a straight-line skip body.
  out.push(\`for (let row = 0; row < start; row++) {\`);
  out.push(\`  const cellBase = 8 + row * \${rowStride};\`);
  for (let col = 0; col < cols; col++) {
    const d = descs[col];
    const headerOff = \`cellBase + \${col * 4}\`;
    if (d.type === "text" || d.type === "data") {
      out.push(\`  { const _h = dv.getUint32(\${headerOff}, true); if (_h !== 0xFFFFFFFF) readPos += _h; }\`);
    } else if (d.type === "uint64" || d.type === "int64" || d.type === "float64") {
      out.push(\`  readPos += 8;\`);
    }
  }
  out.push(\`}\`);
  out.push(\`for (let row = start; row < limit; row++) {\`);
  out.push(\`  const cellBase = 8 + row * \${rowStride};\`);
  if (filter) {
    // Predicate check: a single u32 read at the predicate field's cell
    // header. For boolean fields the C++ projector writes 0 or 1.
    const predRead = \`dv.getUint32(cellBase + \${filterColIdx * 4}, true)\`;
    const predCmp = filter.kind === "truthy" ? "=== 0" : "!== 0";
    out.push(\`  if (\${predRead} \${predCmp}) {\`);
    // Same skip body as the slice-skip phase: walk every payload-emitting
    // field and advance readPos by its byte size.
    for (let col = 0; col < cols; col++) {
      const d = descs[col];
      if (d.type === "text" || d.type === "data") {
        out.push(\`    { const _h = dv.getUint32(cellBase + \${col * 4}, true); if (_h !== 0xFFFFFFFF) readPos += _h; }\`);
      } else if (d.type === "uint64" || d.type === "int64" || d.type === "float64") {
        out.push(\`    readPos += 8;\`);
      }
    }
    out.push(\`    continue;\`);
    out.push(\`  }\`);
  }
  for (let col = 0; col < cols; col++) {
    const d = descs[col];
    const headerOff = \`cellBase + \${col * 4}\`;
    const batch = textBatch[col];
    if (batch && batch.pos === 0) {
      // Emit the batched decode at the first member of the run. All
      // member _v* locals are produced here, so subsequent text members
      // skip individual emission below.
      out.push(\`  let \${batch.members.map((m) => \`_v\${m}\`).join(", ")};\`);
      out.push(\`  {\`);
      for (let p = 0; p < batch.total; p++) {
        const m = batch.members[p];
        out.push(\`    const _h\${m} = dv.getUint32(cellBase + \${m * 4}, true);\`);
        out.push(\`    const _b\${m} = _h\${m} === 0xFFFFFFFF ? 0 : _h\${m};\`);
      }
      const totalExpr = batch.members.map((m) => \`_b\${m}\`).join(" + ");
      out.push(\`    const _total = \${totalExpr};\`);
      if (sharedTextEligible) {
        out.push(\`    let _canSlice = _sharedText !== null;\`);
        out.push(\`    if (!_canSlice) { _canSlice = true; for (let _p = readPos; _p < readPos + _total; _p++) { if (u8[out + _p] & 0x80) { _canSlice = false; break; } } }\`);
        out.push(\`    const _blob = _total === 0 ? "" : (_sharedText !== null ? _sharedText.substring(readPos - _payloadStart, readPos - _payloadStart + _total) : (_canSlice ? TD.decode(u8.subarray(out + readPos, out + readPos + _total)) : ""));\`);
      } else {
        out.push(\`    let _canSlice = true;\`);
        out.push(\`    for (let _p = readPos; _p < readPos + _total; _p++) { if (u8[out + _p] & 0x80) { _canSlice = false; break; } }\`);
        out.push(\`    const _blob = _total === 0 ? "" : (_canSlice ? TD.decode(u8.subarray(out + readPos, out + readPos + _total)) : "");\`);
      }
      // Walk substrings.
      let cumExpr = "0";
      for (let p = 0; p < batch.total; p++) {
        const m = batch.members[p];
        const startExpr = cumExpr;
        const endExpr = \`\${cumExpr} + _b\${m}\`;
        out.push(
          \`    _v\${m} = _h\${m} === 0xFFFFFFFF ? undefined : _h\${m} === 0 ? "" : (_canSlice ? _blob.substring(\${startExpr}, \${endExpr}) : TD.decode(u8.subarray(out + readPos + \${startExpr}, out + readPos + \${endExpr})));\`,
        );
        cumExpr = endExpr;
      }
      out.push(\`    readPos += _total;\`);
      out.push(\`  }\`);
      continue;
    }
    if (batch) {
      // Subsequent member of an already-emitted run; nothing to do here
      // because the batch block produced its _v* local.
      continue;
    }
    switch (d.type) {
      case "text":
        out.push(\`  let _v\${col};\`);
        out.push(\`  { const _h = dv.getUint32(\${headerOff}, true);\`);
        out.push(\`    if (_h === 0xFFFFFFFF) _v\${col} = undefined;\`);
        out.push(\`    else if (_h === 0) _v\${col} = "";\`);
        if (sharedTextEligible) {
          out.push(\`    else { _v\${col} = _sharedText !== null ? _sharedText.substring(readPos - _payloadStart, readPos - _payloadStart + _h) : TD.decode(u8.subarray(out + readPos, out + readPos + _h)); readPos += _h; } }\`);
        } else {
          out.push(\`    else { _v\${col} = TD.decode(u8.subarray(out + readPos, out + readPos + _h)); readPos += _h; } }\`);
        }
        break;
      case "data":
        out.push(\`  let _v\${col};\`);
        out.push(\`  { const _h = dv.getUint32(\${headerOff}, true);\`);
        out.push(\`    if (_h === 0xFFFFFFFF) _v\${col} = undefined;\`);
        out.push(\`    else { _v\${col} = u8.slice(out + readPos, out + readPos + _h); readPos += _h; } }\`);
        break;
      case "bool":
        out.push(\`  const _v\${col} = dv.getUint32(\${headerOff}, true) === 1;\`);
        break;
      case "uint8":
      case "uint16":
        out.push(\`  const _v\${col} = dv.getUint32(\${headerOff}, true);\`);
        break;
      case "int8":
        out.push(\`  const _v\${col} = (dv.getUint32(\${headerOff}, true) << 24) >> 24;\`);
        break;
      case "int16":
        out.push(\`  const _v\${col} = (dv.getUint32(\${headerOff}, true) << 16) >> 16;\`);
        break;
      case "uint32":
        out.push(\`  const _v\${col} = dv.getUint32(\${headerOff}, true) >>> 0;\`);
        break;
      case "int32":
        out.push(\`  const _v\${col} = dv.getUint32(\${headerOff}, true) | 0;\`);
        break;
      case "float32":
        out.push(\`  F32U[0] = dv.getUint32(\${headerOff}, true) >>> 0;\`);
        out.push(\`  const _v\${col} = F32F[0];\`);
        break;
      case "int64":
        out.push(\`  let _v\${col};\`);
        out.push(\`  { const _lo = dv.getUint32(readPos, true);\`);
        out.push(\`    const _hi = dv.getInt32(readPos + 4, true);\`);
        out.push(\`    _v\${col} = (_hi >= -0x200000 && _hi <= 0x1FFFFF) ? _hi * 4294967296 + _lo : dv.getBigInt64(readPos, true);\`);
        out.push(\`    readPos += 8; }\`);
        break;
      case "uint64":
        // Unsigned: combine two u32 reads. Past 2^53 use BigInt so
        // high-bit values like UINT64_MAX do not collapse to -1.
        out.push(\`  let _v\${col};\`);
        out.push(\`  { const _lo = dv.getUint32(readPos, true) >>> 0;\`);
        out.push(\`    const _hi = dv.getUint32(readPos + 4, true) >>> 0;\`);
        out.push(\`    _v\${col} = (_hi <= 0x001FFFFF) ? _hi * 4294967296 + _lo : ((BigInt(_hi) << 32n) | BigInt(_lo));\`);
        out.push(\`    readPos += 8; }\`);
        break;
      case "float64":
        out.push(\`  F64U[0] = dv.getUint32(readPos, true);\`);
        out.push(\`  F64U[1] = dv.getUint32(readPos + 4, true);\`);
        out.push(\`  const _v\${col} = F64F[0];\`);
        out.push(\`  readPos += 8;\`);
        break;
      default:
        out.push(\`  const _v\${col} = undefined;\`);
    }
  }
  // Object literal with the projected names — V8 freezes one hidden class
  // for the row shape. Stringified names are valid in literal-key form.
  // When applyMapFn is set, the user's per-row callback consumes the
  // literal in place; we never store the raw row object in arr.
  const litParts = names.map((n, i) => \`\${JSON.stringify(n)}: _v\${i}\`);
  const targetExpr = filter ? "arr[arrIdx++]" : "arr[row - start]";
  if (applyMapFn) {
    out.push(\`  \${targetExpr} = mapFn({ \${litParts.join(", ")} });\`);
  } else {
    out.push(\`  \${targetExpr} = { \${litParts.join(", ")} };\`);
  }
  out.push(\`}\`);
  if (filter) out.push(\`arr.length = arrIdx;\`);
  out.push(\`return arr;\`);
  return new Function("u8", "dv", "out", "rows", "H", "mapFn", "start", "limit", out.join("\\n"));
}

function _capnwasmPick(cpp, fields, names) {`);
  lines.push(`  // Cached request prep + descriptor array. Same names hit the WeakMap and`);
  lines.push(`  // skip both the encode loop and the per-call descs-rebuild.`);
  lines.push(`  const entry = _getPickRequest(fields, names);`);
  lines.push(`  const req = entry.req;`);
  lines.push(`  const descs = entry.descs;`);
  lines.push(`  const u8 = cpp._u8;`);
  // _auxPtr is cached at CapnCpp load time (constant after wasm init). No
  // per-call boundary crossing to fetch it. Saves ~50-100ns per pick.
  lines.push(`  const aux = cpp._auxPtr;`);
  lines.push(`  u8.set(req, aux);`);
  lines.push(`  const written = cpp._exports.cpp_any_batch_read(req.length);`);
  lines.push(`  if (!written) return Object.fromEntries(names.map((n) => [n, undefined]));`);
  lines.push(`  const out = cpp._outPtr;`);
  lines.push(`  const u8After = cpp._u8;`);
  lines.push(`  const dv2 = new DataView(u8After.buffer, out);`);
  lines.push(`  let readPos = names.length * 4;`);
  lines.push(`  const result = {};`);
  lines.push(`  for (let i = 0; i < names.length; i++) {`);
  lines.push(`    const lenOrVal = dv2.getUint32(i * 4, true);`);
  lines.push(`    const d = descs[i];`);
  lines.push(`    switch (d.type) {`);
  lines.push(`      case "text": {`);
  lines.push(`        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }`);
  lines.push(`        if (lenOrVal === 0) { result[names[i]] = ""; break; }`);
  lines.push(`        result[names[i]] = decodeAscii(u8After.subarray(out + readPos, out + readPos + lenOrVal));`);
  lines.push(`        readPos += lenOrVal;`);
  lines.push(`        break;`);
  lines.push(`      }`);
  lines.push(`      case "data": {`);
  lines.push(`        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }`);
  lines.push(`        result[names[i]] = u8After.slice(out + readPos, out + readPos + lenOrVal);`);
  lines.push(`        readPos += lenOrVal;`);
  lines.push(`        break;`);
  lines.push(`      }`);
  lines.push(`      case "bool":   result[names[i]] = lenOrVal === 1; break;`);
  lines.push(`      case "uint8":  result[names[i]] = lenOrVal; break;`);
  lines.push(`      case "int8":   result[names[i]] = (lenOrVal << 24) >> 24; break;`);
  lines.push(`      case "uint16": result[names[i]] = lenOrVal; break;`);
  lines.push(`      case "int16":  result[names[i]] = (lenOrVal << 16) >> 16; break;`);
  lines.push(`      case "uint32": result[names[i]] = lenOrVal >>> 0; break;`);
  lines.push(`      case "int32":  result[names[i]] = lenOrVal | 0; break;`);
  lines.push(`      case "float32": _F32_VIEW_U32[0] = lenOrVal >>> 0; result[names[i]] = _F32_VIEW_F32[0]; break;`);
  lines.push(`      case "int64": {`);
  lines.push(`        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true);`);
  lines.push(`        const hi = dv2.getInt32 (out - dv2.byteOffset + readPos + 4, true);`);
  lines.push(`        result[names[i]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv2.getBigInt64(out - dv2.byteOffset + readPos, true);`);
  lines.push(`        readPos += 8;`);
  lines.push(`        break;`);
  lines.push(`      }`);
  lines.push(`      case "uint64": {`);
  // Unsigned: read both halves as u32 so high-bit values keep their
  // unsigned magnitude. Past 2^53 we shift to BigInt; below stays
  // as a Number for ergonomics.
  lines.push(`        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true) >>> 0;`);
  lines.push(`        const hi = dv2.getUint32(out - dv2.byteOffset + readPos + 4, true) >>> 0;`);
  lines.push(`        result[names[i]] = (hi <= 0x001FFFFF) ? hi * 4294967296 + lo : ((BigInt(hi) << 32n) | BigInt(lo));`);
  lines.push(`        readPos += 8;`);
  lines.push(`        break;`);
  lines.push(`      }`);
  lines.push(`      case "float64": {`);
  lines.push(`        _F64_VIEW_U32[0] = dv2.getUint32(out - dv2.byteOffset + readPos, true);`);
  lines.push(`        _F64_VIEW_U32[1] = dv2.getUint32(out - dv2.byteOffset + readPos + 4, true);`);
  lines.push(`        result[names[i]] = _F64_VIEW_F64[0];`);
  lines.push(`        readPos += 8;`);
  lines.push(`        break;`);
  lines.push(`      }`);
  lines.push(`      default: result[names[i]] = undefined;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  return result;`);
  lines.push(`}`);
  lines.push("");
  // Project a List(Struct) into an array of plain row objects. When mapFn
  // is supplied (the outer-callback short-circuit path, see _runDraft), the
  // specialized decoder applies it per row inside the unrolled loop — no
  // intermediate row-object survives the loop body, no second .map pass.
  // bounds = optional [start, limit] from a slice-fused outer callback. When
  // present, the decoder skips the first `start` rows (walking their headers
  // to advance readPos but not materializing) and stops after `limit` rows.
  lines.push(`function _capnwasmListProject(cpp, ptrIndex, fields, names, mapFn, bounds, filter) {`);
  lines.push(`  const exp = cpp._exports;`);
  lines.push(`  if (typeof exp.cpp_any_list_project !== "function") return null;`);
  // Filter pushdown can only fuse if the predicate's field is already in the
  // projected names. Otherwise C++ wouldn't have read it. Bail to the safe
  // path so the materialize fallback still runs the user's filter.
  lines.push(`  if (filter && names.indexOf(filter.field) < 0) return null;`);
  lines.push(`  const entry = _getPickRequest(fields, names);`);
  lines.push(`  cpp._u8.set(entry.req, cpp._auxPtr);`);
  lines.push(`  const written = exp.cpp_any_list_project(ptrIndex, entry.req.length);`);
  lines.push(`  if (!written) return null;`);
  lines.push(`  const out = cpp._outPtr;`);
  lines.push(`  const u8 = cpp._u8;`);
  lines.push(`  const dv = new DataView(u8.buffer, out, written);`);
  lines.push(`  const rows = dv.getUint32(0, true);`);
  lines.push(`  const cols = dv.getUint32(4, true);`);
  lines.push(`  if (cols !== names.length) return null;`);
  lines.push(`  let start = 0, limit = rows;`);
  lines.push(`  if (bounds) {`);
  lines.push(`    start = bounds[0] | 0;`);
  lines.push(`    if (start > rows) start = rows;`);
  lines.push(`    const requested = bounds[1];`);
  lines.push(`    if (requested !== Infinity) {`);
  lines.push(`      const max = (requested | 0);`);
  lines.push(`      if (max < limit - start) limit = start + max;`);
  lines.push(`    }`);
  lines.push(`  }`);
  // Decoder cache is now keyed by (applyMapFn, filterKind, filterField). All
  // four combinations share the same _PICK_REQ_CACHE entry; compiling each
  // is lazy so most callers pay for only one variant.
  lines.push(`  if (!entry.listDecoders) entry.listDecoders = new Map();`);
  lines.push(`  const filterKey = filter ? filter.kind + ":" + filter.field : "";`);
  lines.push(`  const decKey = (mapFn ? "m" : "p") + "|" + filterKey;`);
  lines.push(`  let dec = entry.listDecoders.get(decKey);`);
  lines.push(`  if (!dec) { dec = _compileListDecoder(entry.descs, names, !!mapFn, filter); entry.listDecoders.set(decKey, dec); }`);
  lines.push(`  return dec(u8, dv, out, rows, _LIST_HELPERS, mapFn, start, limit);`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function _capnwasmListReduce(cpp, ptrIndex, fields, names, reducerFn, initial, bounds, filter) {`);
  lines.push(`  const projected = _capnwasmListProject(cpp, ptrIndex, fields, names, null, bounds, filter);`);
  lines.push(`  if (projected === null) return null;`);
  lines.push(`  return projected.reduce(reducerFn, initial);`);
  lines.push(`  const exp = cpp._exports;`);
  lines.push(`  if (typeof exp.cpp_any_list_project !== "function") return null;`);
  lines.push(`  if (filter && names.indexOf(filter.field) < 0) return null;`);
  lines.push(`  const entry = _getPickRequest(fields, names);`);
  lines.push(`  cpp._u8.set(entry.req, cpp._auxPtr);`);
  lines.push(`  const written = exp.cpp_any_list_project(ptrIndex, entry.req.length);`);
  lines.push(`  if (!written) return null;`);
  lines.push(`  const out = cpp._outPtr;`);
  lines.push(`  const u8 = cpp._u8;`);
  lines.push(`  const dv = new DataView(u8.buffer, out, written);`);
  lines.push(`  const rows = dv.getUint32(0, true);`);
  lines.push(`  const cols = dv.getUint32(4, true);`);
  lines.push(`  if (cols !== names.length) return null;`);
  lines.push(`  const descs = entry.descs;`);
  lines.push(`  let start = 0, limit = rows;`);
  lines.push(`  if (bounds) {`);
  lines.push(`    start = bounds[0] | 0;`);
  lines.push(`    if (start > rows) start = rows;`);
  lines.push(`    const requested = bounds[1];`);
  lines.push(`    if (requested !== Infinity) {`);
  lines.push(`      const max = requested | 0;`);
  lines.push(`      if (max < limit - start) limit = start + max;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  let filterColIdx = -1;`);
  lines.push(`  if (filter) {`);
  lines.push(`    filterColIdx = names.indexOf(filter.field);`);
  lines.push(`    if (filterColIdx < 0 || (descs[filterColIdx] && descs[filterColIdx].type !== "bool")) filter = null;`);
  lines.push(`  }`);
  lines.push(`  const rowStride = names.length * 4;`);
  lines.push(`  let readPos = 8 + rows * rowStride;`);
  lines.push(`  const skipPayload = (cellBase) => {`);
  lines.push(`    for (let col = 0; col < cols; col++) {`);
  lines.push(`      const d = descs[col];`);
  lines.push(`      if (d.type === "text" || d.type === "data") { const h = dv.getUint32(cellBase + col * 4, true); if (h !== 0xFFFFFFFF) readPos += h; }`);
  lines.push(`      else if (d.type === "uint64" || d.type === "int64" || d.type === "float64") readPos += 8;`);
  lines.push(`    }`);
  lines.push(`  };`);
  lines.push(`  for (let row = 0; row < start; row++) skipPayload(8 + row * rowStride);`);
  lines.push(`  let acc = initial;`);
  lines.push(`  for (let row = start; row < limit; row++) {`);
  lines.push(`    const cellBase = 8 + row * rowStride;`);
  lines.push(`    if (filter) {`);
  lines.push(`      const pred = dv.getUint32(cellBase + filterColIdx * 4, true);`);
  lines.push(`      const reject = filter.kind === "truthy" ? pred === 0 : pred !== 0;`);
  lines.push(`      if (reject) { skipPayload(cellBase); continue; }`);
  lines.push(`    }`);
  lines.push(`    const item = {};`);
  lines.push(`    for (let col = 0; col < cols; col++) {`);
  lines.push(`      const h = dv.getUint32(cellBase + col * 4, true);`);
  lines.push(`      const d = descs[col];`);
  lines.push(`      switch (d.type) {`);
  lines.push(`        case "text": if (h === 0xFFFFFFFF) item[names[col]] = undefined; else if (h === 0) item[names[col]] = ""; else { item[names[col]] = decodeAscii(u8.subarray(out + readPos, out + readPos + h)); readPos += h; } break;`);
  lines.push(`        case "data": if (h === 0xFFFFFFFF) item[names[col]] = undefined; else { item[names[col]] = u8.slice(out + readPos, out + readPos + h); readPos += h; } break;`);
  lines.push(`        case "bool": item[names[col]] = h === 1; break;`);
  lines.push(`        case "uint8": case "uint16": item[names[col]] = h; break;`);
  lines.push(`        case "int8": item[names[col]] = (h << 24) >> 24; break;`);
  lines.push(`        case "int16": item[names[col]] = (h << 16) >> 16; break;`);
  lines.push(`        case "uint32": item[names[col]] = h >>> 0; break;`);
  lines.push(`        case "int32": item[names[col]] = h | 0; break;`);
  lines.push(`        case "float32": _F32_VIEW_U32[0] = h >>> 0; item[names[col]] = _F32_VIEW_F32[0]; break;`);
  lines.push(`        case "int64": { const lo = dv.getUint32(readPos, true); const hi = dv.getInt32(readPos + 4, true); item[names[col]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv.getBigInt64(readPos, true); readPos += 8; break; }`);
  lines.push(`        case "uint64": { const lo = dv.getUint32(readPos, true) >>> 0; const hi = dv.getUint32(readPos + 4, true) >>> 0; item[names[col]] = (hi <= 0x001FFFFF) ? hi * 4294967296 + lo : ((BigInt(hi) << 32n) | BigInt(lo)); readPos += 8; break; }`);
  lines.push(`        case "float64": _F64_VIEW_U32[0] = dv.getUint32(readPos, true); _F64_VIEW_U32[1] = dv.getUint32(readPos + 4, true); item[names[col]] = _F64_VIEW_F64[0]; readPos += 8; break;`);
  lines.push(`        default: item[names[col]] = undefined;`);
  lines.push(`      }`);
  lines.push(`    }`);
  lines.push(`    acc = reducerFn(acc, item, row);`);
  lines.push(`  }`);
  lines.push(`  return acc;`);
  lines.push(`}`);
  lines.push("");
  lines.push(`const _STRUCT_FIELDS = Object.create(null);`);
  lines.push(`export class StaleReaderError extends Error {`);
  lines.push(`  constructor(message = "Cap'n Proto reader is stale because the CapnCpp runtime opened another message") {`);
  lines.push(`    super(message);`);
  lines.push(`    this.name = "StaleReaderError";`);
  lines.push(`  }`);
  lines.push(`}`);
  // M4: Explicit lifetime. dispose() releases the slot eagerly instead
  // of waiting for FinalizationRegistry. Subsequent field access throws
  // this error so use-after-dispose bugs surface immediately.
  lines.push(`export class DisposedReaderError extends Error {`);
  lines.push(`  constructor(message = "Cap'n Proto reader has been disposed; field access is no longer valid") {`);
  lines.push(`    super(message);`);
  lines.push(`    this.name = "DisposedReaderError";`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(`function _openCapnwasmMessage(cpp, bytes, unsafe = false) {`);
  // Keep framing validation at the actual open boundary: _acquireSlot and
  // _allocMessage validate before copying into wasm-owned memory, while the
  // unsafe scratch path relies on C++ FlatArrayMessageReader. Doing it here
  // duplicates the hot safe path.
  // M3: Native multi-reader slot pool. Each safe reader acquires its
  // own wasm cursor slot and carries the slot index. Subsequent reads
  // call cpp_any_use_slot(slotIdx) instead of re-binding a shared
  // cursor. Returns { dataPtr, slotIdx, slotHandle, msg, gen } so older
  // call sites that only used { dataPtr, msg, gen } keep working; new
  // readers prefer slotIdx > 0 when set.
  // _acquireSlot returns null on pool exhaustion; fall through to the
  // managed-message path which still works (just rebinds on stale).
  // M5: forward segment-0 msgStart/msgEnd so the pure-JS pointer decoder can
  // bounds-check same-segment pointer targets without crossing into wasm.
  lines.push(`  if (!unsafe && typeof cpp._acquireSlot === "function" && cpp._supportsReaderSlotPool && cpp._supportsReaderSlotPool()) {`);
  lines.push(`    const acquired = cpp._acquireSlot(bytes);`);
  lines.push(`    if (acquired) {`);
  lines.push(`      return { dataPtr: acquired.dataPtr, slotIdx: acquired.slotIdx, slotHandle: acquired.handle, msgStart: acquired.msgStart, msgEnd: acquired.msgEnd, msg: null, gen: cpp._generation };`);
  lines.push(`    }`);
  lines.push(`  }`);
  // Managed-message fallback via _allocMessage. Used when the
  // wasm runtime predates the slot pool exports. Keeps legacy semantics
  // (rebind on stale-gen) so 0.0.5 -> 0.0.6 upgrades stay seamless.
  lines.push(`  if (!unsafe && typeof cpp._allocMessage === "function") {`);
  lines.push(`    const msg = cpp._allocMessage(bytes);`);
  lines.push(`    const dataPtr = cpp._openAnyMessage(msg);`);
  lines.push(`    return { dataPtr, slotIdx: 0, slotHandle: null, msg, msgStart: msg.ptr + (msg.segment0Start ?? 8), msgEnd: msg.ptr + (msg.segment0End ?? msg.len), gen: cpp._generation };`);
  lines.push(`  }`);
  lines.push(`  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");`);
  lines.push(`  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());`);
  lines.push(`  const dataPtr = cpp._exports.cpp_any_open(bytes.length);`);
  lines.push(`  if (typeof cpp._bumpGeneration === "function") cpp._bumpGeneration();`);
  lines.push(`  const msgStart = cpp._exports.cpp_any_msg_start?.() >>> 0;`);
  lines.push(`  const msgEnd = cpp._exports.cpp_any_msg_end?.() >>> 0;`);
  lines.push(`  return { dataPtr, slotIdx: 0, slotHandle: null, msg: null, msgStart, msgEnd, gen: cpp._generation ?? 0 };`);
  lines.push(`}`);
  // Re-position the C++ cursor onto this reader's struct before any
  // boundary-call read.
  //
  // M3: For slot-pool readers (reader._slotIdx > 0), repositioning is
  // a single cpp_any_use_slot(slotIdx) call. The slot retains the
  // reader's own cursor across other readers' activity. We still
  // gate on a generation token so the use_slot call is skipped when
  // the slot is already active (the common case in tight loops on a
  // single reader).
  //
  // Pre-M3 fallback: managed-message readers re-bind via _openAnyMessage.
  // Rebinding bumps generation as a side effect so peer readers know to
  // re-bind too.
  lines.push(`function _ensureCapnwasmReader(reader) {`);
  // M4: Disposed-reader guard. Runs before any work so a use-after-
  // dispose() bug surfaces immediately rather than reading garbage
  // from a slot that has been released or reassigned.
  lines.push(`  if (reader._disposed) throw new DisposedReaderError();`);
  // M3 fast path: slot pool. Three things to keep coherent:
  //   1) Active slot. JS tracks cpp._activeSlot in lockstep with
  //      cpp_any_use_slot, so the single-reader hot loop short-circuits
  //      with one property compare and one wasm call.
  //   2) Generation token. Bumped on any cursor-moving operation
  //      (acquire, list enter, struct enter). When _gen != generation,
  //      the cursor may have moved away from this reader's struct.
  //   3) Element readers (with _rebind) re-run their rebind closure to
  //      reposition. Root readers (no _rebind) reset the slot's stack
  //      back to depth 0 so pointer-section getters (cpp_any_text_at)
  //      read from the root struct again.
  lines.push(`  if (reader._slotIdx) {`);
  lines.push(`    const cpp = reader._cpp;`);
  lines.push(`    if (cpp._activeSlot !== reader._slotIdx) {`);
  lines.push(`      cpp._useSlot(reader._slotIdx);`);
  lines.push(`    }`);
  lines.push(`    const gen = cpp._generation ?? 0;`);
  lines.push(`    if (reader._gen !== gen) {`);
  // Both branches move the C++ cursor, which invalidates peer readers
  // on the same slot (any element reader of the same parent). Bump
  // generation so the next peer access re-runs its own rebind /
  // reset_root before reading.
  lines.push(`      if (reader._rebind) {`);
  lines.push(`        reader._rebind();`);
  lines.push(`      } else {`);
  lines.push(`        cpp._exports.cpp_any_slot_reset_root?.();`);
  lines.push(`        cpp._bumpGeneration();`);
  lines.push(`      }`);
  lines.push(`      reader._gen = cpp._generation ?? 0;`);
  lines.push(`      reader._u8 = cpp._u8;`);
  lines.push(`      reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
  lines.push(`      reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
  lines.push(`    } else if (reader._dv && reader._dv.buffer !== cpp.memory.buffer) {`);
  lines.push(`      reader._u8 = cpp._u8;`);
  lines.push(`      reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
  lines.push(`      reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
  lines.push(`    }`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  const gen = reader._cpp._generation ?? 0;`);
  lines.push(`  if (reader._gen === gen) return;`);
  lines.push(`  if (reader._rebind) {`);
  lines.push(`    reader._rebind();`);
  lines.push(`    reader._gen = reader._cpp._generation ?? 0;`);
  lines.push(`    reader._u8 = reader._cpp._u8;`);
  lines.push(`    reader._dv = (reader._cpp._dv && reader._cpp._dv()) || new DataView(reader._cpp._u8.buffer);`);
  lines.push(`    reader._u16 = reader._cpp._u16; reader._i16 = reader._cpp._i16; reader._u32 = reader._cpp._u32; reader._i32 = reader._cpp._i32; reader._f32 = reader._cpp._f32; reader._f64 = reader._cpp._f64;`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  if (reader._msg) {`);
  lines.push(`    reader._dataPtr = reader._cpp._openAnyMessage(reader._msg);`);
  lines.push(`    reader._gen = reader._cpp._generation ?? 0;`);
  lines.push(`    reader._u8 = reader._cpp._u8;`);
  lines.push(`    reader._dv = (reader._cpp._dv && reader._cpp._dv()) || new DataView(reader._cpp._u8.buffer);`);
  lines.push(`    reader._u16 = reader._cpp._u16; reader._i16 = reader._cpp._i16; reader._u32 = reader._cpp._u32; reader._i32 = reader._cpp._i32; reader._f32 = reader._cpp._f32; reader._f64 = reader._cpp._f64;`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  throw new StaleReaderError();`);
  lines.push(`}`);
  // Recording planner. Runs the user's callback against a Proxy that
  // notes every field path the callback reads. Lists with struct elements
  // expose a .map(childFn) that defers childFn — the planner records
  // childFn alongside the path; the compile step turns that into a fully
  // resolved sub-plan.
  // Markers for outer-callback shape detection. The planner's listMap.map()
  // returns an array tagged with _LIST_MAP_TAG; chained .slice(0, K) returns
  // a fresh array carrying the same _LIST_MAP_TAG plus a _LIST_MAP_SLICE_TAG
  // recording the bounds. _runDraft uses these to decide whether to skip the
  // outer-callback re-run AND optionally pass a row limit to the C++ tape
  // decoder. Anything else (.filter/.reduce/.map again) drops both tags
  // because the chained operation produces a fresh untagged array.
  lines.push(`const _LIST_MAP_TAG = Symbol("_capnwasm_listMap");`);
  lines.push(`const _LIST_MAP_SLICE_TAG = Symbol("_capnwasm_listMapSlice");`);
  lines.push(`const _LIST_REDUCE_TAG = Symbol("_capnwasm_listReduce");`);
  // Build a tagged sentinel array carrying the listMap idx and an optional
  // [start, limit] pair. We override .slice on the array so a chain of the
  // form `users.map(fn).slice(0, 50)` recursively yields a fresh tagged
  // sentinel that records the bound. Bounds are normalized: negative or
  // non-integer args bail by returning a plain Array.prototype.slice result
  // (no tag) so the caller's outer callback no longer matches the
  // short-circuit and falls through to the safe path.
  lines.push(`function _makeListMapTag(idx, slice) {`);
  lines.push(`  const tag = [];`);
  lines.push(`  tag[_LIST_MAP_TAG] = idx;`);
  lines.push(`  if (slice) tag[_LIST_MAP_SLICE_TAG] = slice;`);
  lines.push(`  Object.defineProperty(tag, "slice", { value: function(start, end) {`);
  lines.push(`    const s = (start === undefined) ? 0 : start;`);
  lines.push(`    if (!Number.isInteger(s) || s < 0) return Array.prototype.slice.call(this, start, end);`);
  lines.push(`    let limit = Infinity;`);
  lines.push(`    if (end !== undefined) {`);
  lines.push(`      if (!Number.isInteger(end) || end < s) return Array.prototype.slice.call(this, start, end);`);
  lines.push(`      limit = end - s;`);
  lines.push(`    }`);
  lines.push(`    const prevSlice = this[_LIST_MAP_SLICE_TAG];`);
  lines.push(`    const prevStart = prevSlice ? prevSlice[0] : 0;`);
  lines.push(`    const prevLimit = prevSlice ? prevSlice[1] : Infinity;`);
  lines.push(`    const newStart = prevStart + s;`);
  lines.push(`    const newLimit = Math.min(prevLimit - s, limit);`);
  lines.push(`    if (newLimit < 0) return [];`);
  lines.push(`    return _makeListMapTag(idx, [newStart, newLimit]);`);
  lines.push(`  }});`);
  lines.push(`  return tag;`);
  lines.push(`}`);
  lines.push(`function _makeListReduceTag(idx) {`);
  lines.push(`  const tag = {};`);
  lines.push(`  tag[_LIST_REDUCE_TAG] = idx;`);
  lines.push(`  return tag;`);
  lines.push(`}`);
  lines.push(`function _dummyForDesc(desc) {`);
  lines.push(`  if (!desc) return undefined;`);
  lines.push(`  switch (desc.type) {`);
  lines.push(`    case "text": return "";`);
  lines.push(`    case "data": return new Uint8Array(0);`);
  lines.push(`    case "bool": return false;`);
  lines.push(`    default: return 0;`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(`function _dummyAccumulator(initial) {`);
  lines.push(`  if (Array.isArray(initial)) return [];`);
  lines.push(`  if (initial && typeof initial === "object") {`);
  lines.push(`    const out = {};`);
  lines.push(`    for (const [k, v] of Object.entries(initial)) out[k] = Array.isArray(v) ? [] : (v && typeof v === "object" ? {} : v);`);
  lines.push(`    return out;`);
  lines.push(`  }`);
  lines.push(`  return initial;`);
  lines.push(`}`);
  // Strict-whitelist predicate parser. Only recognizes the safest pattern:
  //   (u) => u.field        / u => u.field        (truthy on one field)
  //   (u) => !u.field                              (falsy)
  // Anything else (template strings, ternaries, nested expressions,
  // multi-statement bodies) returns null so the planner falls back to the
  // safe materialize-then-callback path. Source-text matching is fragile
  // by nature; the safety net is the bailout, not the regex.
  lines.push(`function _parseSimplePredicate(fn) {`);
  lines.push(`  let src;`);
  lines.push(`  try { src = Function.prototype.toString.call(fn); } catch (_) { return null; }`);
  lines.push(`  const truthyRe = /^\\s*(?:\\(\\s*([a-zA-Z_$][\\w$]*)\\s*\\)|([a-zA-Z_$][\\w$]*))\\s*=>\\s*(\\1|\\2)\\.([a-zA-Z_$][\\w$]*)\\s*;?\\s*$/;`);
  lines.push(`  const falsyRe = /^\\s*(?:\\(\\s*([a-zA-Z_$][\\w$]*)\\s*\\)|([a-zA-Z_$][\\w$]*))\\s*=>\\s*!\\s*(\\1|\\2)\\.([a-zA-Z_$][\\w$]*)\\s*;?\\s*$/;`);
  lines.push(`  let m = truthyRe.exec(src); if (m) return { kind: "truthy", field: m[4] };`);
  lines.push(`  m = falsyRe.exec(src); if (m) return { kind: "falsy", field: m[4] };`);
  lines.push(`  return null;`);
  lines.push(`}`);
  // Shape-preserving identity detector. Matches exactly:
  //   (u) => ({ a: u.a, b: u.b, ... })   /   u => ({ a: u.a, b: u.b, ... })
  // where every output key equals the input parameter's same-named property
  // and the set of keys equals the projected leaf fields. When matched, the
  // decoder can emit the row literal directly and skip calling the user's
  // mapFn — same JS object value, one fewer function call and allocation
  // per row. Any deviation (spread, computed values, ternaries, comments,
  // strings, nested objects, function expression form) returns false and
  // the slow path runs the user's callback as-is.
  lines.push(`function _isShapePreservingMap(fn, leafFields) {`);
  lines.push(`  let src;`);
  lines.push(`  try { src = Function.prototype.toString.call(fn); } catch (_) { return false; }`);
  lines.push(`  const m = /^\\s*(?:\\(\\s*([a-zA-Z_$][\\w$]*)\\s*\\)|([a-zA-Z_$][\\w$]*))\\s*=>\\s*\\(\\s*\\{([\\s\\S]*)\\}\\s*\\)\\s*;?\\s*$/.exec(src);`);
  lines.push(`  if (!m) return false;`);
  lines.push(`  const param = m[1] || m[2];`);
  lines.push(`  const body = m[3];`);
  // Conservative content gate: any of these characters means the body is
  // non-trivial (string, comment, nested object, regex, computed key,
  // template literal, etc.). Bail rather than try to parse precisely.
  lines.push(`  if (/[\\/{\\[\\\`'"]/.test(body)) return false;`);
  lines.push(`  const entries = body.split(",").map((s) => s.trim()).filter(Boolean);`);
  lines.push(`  if (entries.length !== leafFields.length) return false;`);
  // RegExp.escape isn't ubiquitous yet; param comes from a captured \\w+
  // group so it's already safe to splice. Guard with a runtime check.
  lines.push(`  if (!/^[a-zA-Z_$][\\w$]*$/.test(param)) return false;`);
  lines.push(`  const entryRe = new RegExp("^([a-zA-Z_$][\\\\w$]*)\\\\s*:\\\\s*" + param + "\\\\.([a-zA-Z_$][\\\\w$]*)$");`);
  lines.push(`  const set = new Set(leafFields);`);
  lines.push(`  const seen = new Set();`);
  lines.push(`  for (let i = 0; i < entries.length; i++) {`);
  lines.push(`    const em = entryRe.exec(entries[i]);`);
  lines.push(`    if (!em || em[1] !== em[2]) return false;`);
  lines.push(`    if (!set.has(em[1]) || seen.has(em[1])) return false;`);
  lines.push(`    seen.add(em[1]);`);
  lines.push(`  }`);
  lines.push(`  return true;`);
  lines.push(`}`);
  lines.push(`function _planRaw(fields, fn) {`);
  lines.push(`  const selected = [];`);
  lines.push(`  const seen = new Set();`);
  lines.push(`  const recordField = (schema, path) => {`);
  lines.push(`    const key = path.join(".");`);
  lines.push(`    if (!seen.has(key)) { seen.add(key); selected.push({ kind: "field", path }); }`);
  lines.push(`    return _dummyForDesc(schema[path[path.length - 1]]);`);
  lines.push(`  };`);
  lines.push(`  const make = (schema, path) => new Proxy(Object.create(null), {`);
  lines.push(`    get(_, name) {`);
  lines.push(`      if (typeof name !== "string") return undefined;`);
  lines.push(`      const desc = schema[name];`);
  lines.push(`      if (!desc) return undefined;`);
  lines.push(`      const nextPath = path.concat(name);`);
  lines.push(`      const list = /^List\\(([^)]+)\\)$/.exec(desc.type);`);
  lines.push(`      if (list && _STRUCT_FIELDS[list[1]]) {`);
  // The list proxy supports .map (always), and .filter (whitelisted preds
  // only). When .filter receives an unrecognized predicate we still RECORD
  // the listMap from the chained .map but return an UNTAGGED array, so the
  // outer-callback short-circuit fails and _materializeDraft runs the user
  // callback against a fully-populated POJO. This keeps semantic correctness
  // for arbitrary filter predicates while only fusing the safe ones.
  lines.push(`        const recordMap = (childFn, filter) => {`);
  lines.push(`          const idx = selected.length;`);
  lines.push(`          const entry = { kind: "listMap", path: nextPath, inner: list[1], fn: childFn };`);
  lines.push(`          if (filter) entry.filter = filter;`);
  lines.push(`          selected.push(entry);`);
  lines.push(`          return idx;`);
  lines.push(`        };`);
  lines.push(`        const recordReduce = (reducerFn, initial, filter) => {`);
  lines.push(`          const idx = selected.length;`);
  lines.push(`          const entry = { kind: "listReduce", path: nextPath, inner: list[1], fn: reducerFn, initial };`);
  lines.push(`          if (filter) entry.filter = filter;`);
  lines.push(`          selected.push(entry);`);
  lines.push(`          return idx;`);
  lines.push(`        };`);
  lines.push(`        const buildFusedProxy = (filter) => ({`);
  lines.push(`          map(childFn) {`);
  lines.push(`            const idx = recordMap(childFn, filter);`);
  lines.push(`            return _makeListMapTag(idx, null);`);
  lines.push(`          },`);
  lines.push(`          filter(predicateFn) {`);
  lines.push(`            const parsed = _parseSimplePredicate(predicateFn);`);
  lines.push(`            if (parsed) return buildFusedProxy(parsed);`);
  lines.push(`            return buildSafeProxy();`);
  lines.push(`          },`);
  lines.push(`          reduce(reducerFn, initial) {`);
  lines.push(`            const idx = recordReduce(reducerFn, initial, filter);`);
  lines.push(`            return _makeListReduceTag(idx);`);
  lines.push(`          }`);
  lines.push(`        });`);
  lines.push(`        const buildSafeProxy = () => ({`);
  lines.push(`          map(childFn) { recordMap(childFn, null); return []; },`);
  lines.push(`          filter() { return buildSafeProxy(); },`);
  lines.push(`          reduce(reducerFn, initial) { const idx = recordReduce(reducerFn, initial, null); return _makeListReduceTag(idx); }`);
  lines.push(`        });`);
  lines.push(`        return buildFusedProxy(null);`);
  lines.push(`      }`);
  lines.push(`      if (_STRUCT_FIELDS[desc.type]) return make(_STRUCT_FIELDS[desc.type], nextPath);`);
  lines.push(`      return recordField(schema, nextPath);`);
  lines.push(`    }`);
  lines.push(`  });`);
  lines.push(`  const result = fn(make(fields, []));`);
  // Detect outer-callback short-circuit pattern. If the outer callback
  // returns the planner's tagged array (or a slice tag derived from it),
  // we can apply childFn during the C++ row-tape decode and optionally
  // bound the rows. Anything else falls through to the safe materialize
  // path.
  lines.push(`  let outerListMapIdx = -1;`);
  lines.push(`  let outerListReduceIdx = -1;`);
  lines.push(`  let outerSlice = null;`);
  lines.push(`  if (result && typeof result === "object" && _LIST_MAP_TAG in result) {`);
  lines.push(`    outerListMapIdx = result[_LIST_MAP_TAG];`);
  lines.push(`    if (_LIST_MAP_SLICE_TAG in result) outerSlice = result[_LIST_MAP_SLICE_TAG];`);
  lines.push(`  }`);
  lines.push(`  if (result && typeof result === "object" && _LIST_REDUCE_TAG in result) {`);
  lines.push(`    outerListReduceIdx = result[_LIST_REDUCE_TAG];`);
  lines.push(`  }`);
  lines.push(`  return { selected, outerListMapIdx, outerListReduceIdx, outerSlice };`);
  lines.push(`}`);
  // Compile a recorded plan into a structured form: separate leaf-field,
  // nested-struct, and list-of-struct lists. Nested entries have their own
  // compiled sub-plans; list entries pre-build the child plan via _planRaw
  // so the materialize loop never has to re-categorize or re-plan per call.
  // The tradeoff: the compiled plan lives in a WeakMap keyed by (FIELDS, fn)
  // so a stable callback only ever pays the planning cost once.
  lines.push(`function _compilePlan(selected, outerListMapIdx, outerSlice, outerListReduceIdx = -1) {`);
  lines.push(`  const leaf = [];`);
  lines.push(`  const nestedRaw = new Map();`);
  lines.push(`  const listMapRaw = [];`);
  lines.push(`  const listReduceRaw = [];`);
  // outerListMapIdx (if set) refers to an index in `selected`. Track which
  // entry in `listMapRaw` corresponds so the runtime can find the matching
  // top-level listMap to short-circuit against. outerSlice (if non-null)
  // is [start, limit] from the planner's slice-tagged sentinel.
  lines.push(`  let outerListMapPos = -1;`);
  lines.push(`  let outerListReducePos = -1;`);
  lines.push(`  for (let i = 0; i < selected.length; i++) {`);
  lines.push(`    const item = selected[i];`);
  lines.push(`    const head = item.path[0];`);
  lines.push(`    if (!head) continue;`);
  lines.push(`    if (item.kind === "field" && item.path.length === 1) {`);
  lines.push(`      leaf.push(head);`);
  lines.push(`    } else if (item.kind === "listMap" && item.path.length === 1) {`);
  lines.push(`      if (i === outerListMapIdx) outerListMapPos = listMapRaw.length;`);
  lines.push(`      const lmEntry = { name: head, inner: item.inner, fn: item.fn };`);
  lines.push(`      if (item.filter) lmEntry.filter = item.filter;`);
  lines.push(`      listMapRaw.push(lmEntry);`);
  lines.push(`    } else if (item.kind === "listReduce" && item.path.length === 1) {`);
  lines.push(`      if (i === outerListReduceIdx) outerListReducePos = listReduceRaw.length;`);
  lines.push(`      const lrEntry = { name: head, inner: item.inner, fn: item.fn, initial: item.initial };`);
  lines.push(`      if (item.filter) lrEntry.filter = item.filter;`);
  lines.push(`      listReduceRaw.push(lrEntry);`);
  lines.push(`    } else {`);
  lines.push(`      let entry = nestedRaw.get(head);`);
  lines.push(`      if (!entry) { entry = []; nestedRaw.set(head, entry); }`);
  lines.push(`      const sliced = { kind: item.kind, path: item.path.slice(1) };`);
  lines.push(`      if (item.kind === "listMap") { sliced.inner = item.inner; sliced.fn = item.fn; }`);
  lines.push(`      entry.push(sliced);`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  const nested = [];`);
  lines.push(`  for (const [name, raw] of nestedRaw) nested.push({ name, plan: _compilePlan(raw, -1, null) });`);
  lines.push(`  const listMap = listMapRaw.map(({ name, inner, fn, filter }) => {`);
  lines.push(`    const innerPlan = _planDraft(_STRUCT_FIELDS[inner], fn).plan;`);
  // shapePreserving applies only when the inner plan is leaf-only (no
  // nested struct or list-of-struct). Otherwise the user's mapFn is doing
  // structural work the literal cannot replicate.
  lines.push(`    const shapePreserving = (innerPlan.nested.length === 0 && innerPlan.listMap.length === 0)`);
  lines.push(`      && _isShapePreservingMap(fn, innerPlan.leaf);`);
  lines.push(`    return { name, inner, fn, filter, plan: innerPlan, shapePreserving };`);
  lines.push(`  });`);
  lines.push(`  const listReduce = listReduceRaw.map(({ name, inner, fn, initial, filter }) => {`);
  lines.push(`    const innerPlan = _planDraft(_STRUCT_FIELDS[inner], (row) => { fn(_dummyAccumulator(initial), row, 0); return undefined; }).plan;`);
  lines.push(`    return { name, inner, fn, initial, filter, plan: innerPlan };`);
  lines.push(`  });`);
  lines.push(`  return { leaf, nested, listMap, listReduce, outerListMapPos, outerListReducePos, outerSlice };`);
  lines.push(`}`);
  lines.push(`function _planDraft(fields, fn) {`);
  lines.push(`  const raw = _planRaw(fields, fn);`);
  lines.push(`  return { plan: _compilePlan(raw.selected, raw.outerListMapIdx, raw.outerSlice, raw.outerListReduceIdx) };`);
  lines.push(`}`);
  lines.push(`function _getDraftPlan(fields, fn) {`);
  lines.push(`  let perFields = _DRAFT_PLAN_CACHE.get(fields);`);
  lines.push(`  if (!perFields) { perFields = new WeakMap(); _DRAFT_PLAN_CACHE.set(fields, perFields); }`);
  lines.push(`  let plan = perFields.get(fn);`);
  lines.push(`  if (!plan) { plan = _planDraft(fields, fn).plan; perFields.set(fn, plan); }`);
  lines.push(`  return plan;`);
  lines.push(`}`);
  // Materialize against a precompiled plan. Walks plan.leaf with one batched
  // wasm call, plan.nested via enter/leave_struct + recursion, plan.listMap
  // via open_list + per-row enter/leave + recursion. Returns a plain object
  // with the same field shape on every call (V8 inline-cache friendly).
  lines.push(`function _materializeDraft(cpp, fields, plan) {`);
  lines.push(`  const out = {};`);
  lines.push(`  if (plan.leaf.length > 0) Object.assign(out, _capnwasmPick(cpp, fields, plan.leaf));`);
  lines.push(`  const exp = cpp._exports;`);
  lines.push(`  for (let i = 0; i < plan.nested.length; i++) {`);
  lines.push(`    const sub = plan.nested[i];`);
  lines.push(`    const desc = fields[sub.name];`);
  lines.push(`    if (!desc || !_STRUCT_FIELDS[desc.type]) { out[sub.name] = undefined; continue; }`);
  lines.push(`    if (exp.cpp_any_enter_struct(desc.off) !== 1) { out[sub.name] = null; continue; }`);
  lines.push(`    try { out[sub.name] = _materializeDraft(cpp, _STRUCT_FIELDS[desc.type], sub.plan); }`);
  lines.push(`    finally { exp.cpp_any_leave_struct(); }`);
  lines.push(`  }`);
  lines.push(`  for (let i = 0; i < plan.listMap.length; i++) {`);
  lines.push(`    const item = plan.listMap[i];`);
  lines.push(`    const desc = fields[item.name];`);
  lines.push(`    if (!desc || !_STRUCT_FIELDS[item.inner]) { out[item.name] = []; continue; }`);
  lines.push(`    const innerFields = _STRUCT_FIELDS[item.inner];`);
  lines.push(`    if (item.plan.nested.length === 0 && item.plan.listMap.length === 0) {`);
  lines.push(`      const fast = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf);`);
  lines.push(`      if (fast !== null) { out[item.name] = fast; continue; }`);
  lines.push(`    }`);
  lines.push(`    const size = exp.cpp_any_open_list(desc.off);`);
  lines.push(`    const arr = new Array(size);`);
  lines.push(`    for (let j = 0; j < size; j++) {`);
  // Re-open the list before each enter_list_at: a deeply nested element
  // plan may itself open a different list and overwrite any_list_reader.
  // Re-opening is one cheap wasm crossing; re-opening only when needed
  // would require a "child plan touches lists" flag — left as future work.
  lines.push(`      exp.cpp_any_open_list(desc.off);`);
  lines.push(`      if (exp.cpp_any_enter_list_at(j) !== 1) { arr[j] = null; continue; }`);
  lines.push(`      try { arr[j] = _materializeDraft(cpp, innerFields, item.plan); }`);
  lines.push(`      finally { exp.cpp_any_leave_struct(); }`);
  lines.push(`    }`);
  lines.push(`    out[item.name] = arr;`);
  lines.push(`  }`);
  lines.push(`  for (let i = 0; i < plan.listReduce.length; i++) {`);
  lines.push(`    const item = plan.listReduce[i];`);
  lines.push(`    const desc = fields[item.name];`);
  lines.push(`    if (!desc || !_STRUCT_FIELDS[item.inner]) { out[item.name] = item.initial; continue; }`);
  lines.push(`    const innerFields = _STRUCT_FIELDS[item.inner];`);
  lines.push(`    if (item.plan.nested.length === 0 && item.plan.listMap.length === 0 && item.plan.listReduce.length === 0) {`);
  lines.push(`      const fast = _capnwasmListReduce(cpp, desc.off, innerFields, item.plan.leaf, item.fn, item.initial, null, item.filter);`);
  lines.push(`      if (fast !== null) { out[item.name] = fast; continue; }`);
  lines.push(`    }`);
  lines.push(`    const rows = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf);`);
  lines.push(`    if (rows === null) { out[item.name] = item.initial; continue; }`);
  lines.push(`    out[item.name] = rows.reduce(item.fn, item.initial);`);
  lines.push(`  }`);
  lines.push(`  return out;`);
  lines.push(`}`);
  // Hot path: pull the precompiled plan, materialize into a plain object,
  // hand the plain object to the user's callback. No Proxy wrapping on the
  // execution side — V8 hits the same hidden class on every call when the
  // callback is stable, so field accesses inline-cache to direct loads.
  //
  // Fast path: when the projection only touches top-level fields (no nested
  // struct paths, no list .map() calls), the plan reduces to a single batched
  // pick. We skip _materializeDraft entirely and hand the pick result straight
  // to the user's callback. This saves a function call, an Object.assign, and
  // two empty-array length checks per draft() — roughly 100ns on a hot loop.
  // Hot path: pull the precompiled plan, materialize into a plain object,
  // hand the plain object to the user's callback. No Proxy wrapping on the
  // execution side.
  //
  // Fast paths in priority order:
  //   1. outer-callback short-circuit: outer fn was `r => r.X.map(childFn)`.
  //      Materialize the listMap with childFn applied during the row
  //      decode, return that array directly. Skips both the materialized
  //      shell object AND the outer callback re-execution against POJOs.
  //   2. leaf-only: plan reduces to one batched pick; skip materialize.
  //   3. general: materialize → outer fn(POJO).
  lines.push(`function _runDraft(cpp, fields, fn) {`);
  lines.push(`  const plan = _getDraftPlan(fields, fn);`);
  lines.push(`  if (plan.outerListReducePos >= 0 && plan.listReduce.length > 0) {`);
  lines.push(`    const item = plan.listReduce[plan.outerListReducePos];`);
  lines.push(`    const desc = fields[item.name];`);
  lines.push(`    if (desc && _STRUCT_FIELDS[item.inner] && item.plan.nested.length === 0 && item.plan.listMap.length === 0 && item.plan.listReduce.length === 0) {`);
  lines.push(`      const innerFields = _STRUCT_FIELDS[item.inner];`);
  lines.push(`      const fast = _capnwasmListReduce(cpp, desc.off, innerFields, item.plan.leaf, item.fn, item.initial, plan.outerSlice, item.filter);`);
  lines.push(`      if (fast !== null) return fast;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  if (plan.outerListMapPos >= 0 && plan.listMap.length > 0) {`);
  lines.push(`    const item = plan.listMap[plan.outerListMapPos];`);
  lines.push(`    const desc = fields[item.name];`);
  lines.push(`    if (desc && _STRUCT_FIELDS[item.inner] && item.plan.nested.length === 0 && item.plan.listMap.length === 0) {`);
  lines.push(`      const innerFields = _STRUCT_FIELDS[item.inner];`);
  lines.push(`      const fastFn = item.shapePreserving ? null : item.fn;`);
  lines.push(`      const fast = _capnwasmListProject(cpp, desc.off, innerFields, item.plan.leaf, fastFn, plan.outerSlice, item.filter);`);
  lines.push(`      if (fast !== null) return fast;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  if (plan.nested.length === 0 && plan.listMap.length === 0 && plan.listReduce.length === 0) {`);
  lines.push(`    return fn(_capnwasmPick(cpp, fields, plan.leaf));`);
  lines.push(`  }`);
  lines.push(`  return fn(_materializeDraft(cpp, fields, plan));`);
  lines.push(`}`);
  lines.push("");
  const declaredStructs = new Set(structs.map((s) => s.name));
  const structByName = new Map(structs.map((s) => [s.name, s]));
  for (const s of structs) {
    lines.push(`export class ${s.name}Reader {`);
    // M5: Static struct shape. _DATA_WORDS is the number of 8-byte
    // words in the data section, used by the pure-JS pointer decoder
    // to compute the pointer-section base. Mirrors the same constant
    // already on Builders for the RPC zero-copy path.
    lines.push(`  static _DATA_WORDS = ${s.dataWords};`);
    lines.push(`  static _PTR_WORDS = ${s.ptrWords};`);
    // Cache cpp._exports so per-field getters do `this._exp.cpp_*()`
    //. One hidden-class lookup instead of walking two property chains.
    // Don't cache a Uint8Array view here: text/data getters fetch a
    // fresh one via this._cpp._u8 because the wasm calls inside them
    // can grow memory (and detach a pre-existing view).
    lines.push(`  constructor(cpp, dataPtr, opts = undefined) {`);
    lines.push(`    this._cpp = cpp;`);
    lines.push(`    this._exp = cpp._exports;`);
    lines.push(`    this._msg = opts && opts.msg ? opts.msg : null;`);
    lines.push(`    this._rebind = opts && opts.rebind ? opts.rebind : null;`);
    lines.push(`    this._gen = opts && opts.gen !== undefined ? opts.gen : (cpp._generation ?? 0);`);
    // M3: Slot pool. _slotIdx > 0 means this reader owns a wasm slot
    // and _ensureCapnwasmReader uses cpp._useSlot() to switch to it.
    // _slotHandle is the registration object the slot finalizer holds;
    // dispose() releases it explicitly (M4) instead of waiting for GC.
    lines.push(`    this._slotIdx = opts && opts.slotIdx ? opts.slotIdx : 0;`);
    lines.push(`    this._slotHandle = opts && opts.slotHandle ? opts.slotHandle : null;`);
    // M5: Pure-JS pointer decoder bounds. msgStart/msgEnd come from the
    // slot acquisition path; nested struct readers and element readers
    // inherit them from the parent so the same bounds apply across the
    // whole message. When undefined, the decoder is skipped and reads
    // fall back to the C++ path.
    lines.push(`    this._msgStart = opts && opts.msgStart !== undefined ? opts.msgStart : 0;`);
    lines.push(`    this._msgEnd = opts && opts.msgEnd !== undefined ? opts.msgEnd : 0;`);
    // Cap-table threading. RPC delivery paths populate opts.capTable with
    // the inbound CapDescriptor[] resolved to typed cap proxies; non-RPC
    // openers (openFoo, openDynamic) leave it null. Nested struct readers
    // inherit from the parent so an interface-typed field deep inside a
    // delivered struct still resolves through the same table.
    lines.push(`    this._capTable = (opts && opts.capTable) || (opts && opts.parent && opts.parent._capTable) || null;`);
    // dataPtr is supplied by openX(cpp, bytes) and by the RPC layer's
    // open_call_params / open_return_results paths. When present,
    // primitive getters can read straight from wasm memory at
    // dataPtr+offset. No per-field cpp_any_*_at boundary call. The
    // cached _u8 view stays valid for the Reader's lifetime since
    // primitive reads can't trigger memory growth.
    lines.push(`    this._dataPtr = dataPtr | 0;`);
    // Typed-array views over wasm memory. When opts.parent is present
    // (parent reader for List<Struct> element allocation), copy its views
    // directly. The parent already validated they match cpp.memory.buffer.
    // Otherwise fetch from cpp (root reader path). The parent fast path
    // saves ~6 typed-view getter calls per element on dense iteration.
    lines.push(`    if (opts && opts.parent) {`);
    lines.push(`      const _p = opts.parent;`);
    lines.push(`      this._u8 = _p._u8; this._dv = _p._dv;`);
    lines.push(`      this._u16 = _p._u16; this._i16 = _p._i16; this._u32 = _p._u32; this._i32 = _p._i32; this._f32 = _p._f32; this._f64 = _p._f64;`);
    lines.push(`    } else {`);
    lines.push(`      this._u8 = cpp._u8;`);
    lines.push(`      this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
    lines.push(`      this._u16 = cpp._u16; this._i16 = cpp._i16; this._u32 = cpp._u32; this._i32 = cpp._i32; this._f32 = cpp._f32; this._f64 = cpp._f64;`);
    lines.push(`    }`);
    // M4: dispose flag. False until dispose() runs. After dispose,
    // _ensureCapnwasmReader throws DisposedReaderError on every getter.
    lines.push(`    this._disposed = false;`);
    lines.push(`  }`);
    lines.push("");
    // M4: Explicit lifetime API.
    //
    // dispose() releases the wasm slot back to the pool immediately
    // (instead of waiting for FinalizationRegistry timing) and frees
    // the message bytes. Idempotent. Subsequent field access throws
    // DisposedReaderError. Element readers (those with a parent's
    // _slotIdx but no _slotHandle of their own) only mark themselves
    // disposed; the parent's slot stays alive until the parent's
    // dispose() runs.
    //
    // [Symbol.dispose] makes the reader compatible with TC39 explicit
    // resource management: `using r = openFoo(cpp, bytes);` runs the
    // dispose method automatically when r leaves scope. Available on
    // Node 22+, Chrome 134+, Safari 18.4+. On older runtimes the
    // method is still callable, just not invoked by `using`.
    lines.push(`  dispose() {`);
    lines.push(`    if (this._disposed) return;`);
    lines.push(`    this._disposed = true;`);
    lines.push(`    if (this._slotHandle) {`);
    lines.push(`      this._cpp._releaseSlot(this._slotHandle);`);
    lines.push(`      this._slotHandle = null;`);
    lines.push(`    } else if (this._msg) {`);
    lines.push(`      this._cpp._freeMessage(this._msg);`);
    lines.push(`      this._msg = null;`);
    lines.push(`    }`);
    lines.push(`    this._dataPtr = 0;`);
    lines.push(`    this._rebind = null;`);
    lines.push(`  }`);
    lines.push("");
    // Guard Symbol.dispose for older runtimes (Node <22, Safari <18.4)
    // where the symbol is undefined. We assign the dispose alias on the
    // class prototype after declaration; in the no-Symbol case it
    // becomes a string-keyed property named "undefined", which is
    // harmless (just unused) and does not break the class shape.
    lines.push("");
    // Union accessor: when this struct holds a union, `which()` returns the
    // discriminant value (0..N-1) and the codegen below adds `is<Foo>()`
    // guards for each variant. The discriminant lives at a fixed byte
    // offset in the data section, written as a u16.
    if (s.discriminantCount && s.discriminantOffsetBits !== undefined) {
      const byteOff = s.discriminantOffsetBits >> 3;
      lines.push(`  /** Returns the discriminant of this struct's union (0..${s.discriminantCount - 1}). */`);
      lines.push(`  which() {`);
      lines.push(`    _ensureCapnwasmReader(this);`);
      lines.push(`    return this._exp.cpp_any_uint16_at(${byteOff}, 0);`);
      lines.push(`  }`);
      lines.push("");
      // Constants for each union variant, named after the field with
      // discriminantValue. Lets users write `if (r.which() === MyStruct.Which.foo)`.
      const variants = s.fields.filter(f => f.discriminantValue !== undefined);
      if (variants.length > 0) {
        lines.push(`  static Which = Object.freeze({`);
        for (const v of variants) {
          lines.push(`    ${v.name}: ${v.discriminantValue},`);
        }
        lines.push(`  });`);
        lines.push("");
      }
    }
    for (const f of s.fields) {
      // M5: pass parent struct's data-word count down to the getter
      // so the JS pointer decoder knows where the pointer section
      // starts. Mutating the field object in place is fine; codegen
      // emits each struct once.
      f.parentDataWords = s.dataWords;
      const getter = generateGetter(f, declaredStructs);
      lines.push(`  get ${f.name}() {`);
      lines.push(`    _ensureCapnwasmReader(this);`);
      // If this field is a union variant (or lives inside a group that is),
      // gate the getter on the discriminant matching. Returning undefined
      // for non-active variants matches Cap'n Proto's "default value" model.
      if (s.discriminantCount && s.discriminantOffsetBits !== undefined) {
        const dv = f.discriminantValue ?? f.parentDiscriminantValue;
        if (dv !== undefined) {
          lines.push(`    if (this.which() !== ${dv}) return undefined;`);
        }
      }
      for (const line of getter) lines.push(`    ${line}`);
      lines.push(`  }`);
      // Also emit a typed `is<FieldName>()` guard for every union variant.
      if (s.discriminantCount && f.discriminantValue !== undefined) {
        const cap = f.name.charAt(0).toUpperCase() + f.name.slice(1);
        lines.push(`  is${cap}() { return this.which() === ${f.discriminantValue}; }`);
      }
    }
    // Per-class field descriptor table. Fed to cpp_any_batch_read so one
    // wasm boundary crossing fetches all requested fields. Codegen knows
    // each field's offset and type at build time (the Immer-pattern of
    // tracking accesses applied at codegen time, no runtime Proxy needed).
    lines.push("");
    lines.push(`  static _FIELDS = {`);
    for (const f of s.fields) {
      const desc = fieldDescriptor(f);
      lines.push(`    ${f.name}: ${JSON.stringify(desc)},`);
    }
    lines.push(`  };`);
    lines.push("");
    // Immer-style projection. Supports top-level fields, nested struct
    // paths, and list-of-struct fields via .map() inside the draft. The callback
    // first runs against a recording Proxy to build a projection plan; the
    // plan is cached per (struct, callback) so subsequent draft() calls jump
    // straight to the materialize step. This is the only documented projection
    // API on generated readers — the older pick()/access/apply variants were
    // removed in favor of this one. Internally `_capnwasmPick` is still the
    // single-batched-wasm-call primitive that powers leaf reads.
    lines.push(`  draft(fn) {`);
    lines.push(`    _ensureCapnwasmReader(this);`);
    // M5.5: when a JS-path element reader runs draft / toObject, the
    // C++ batch-read still uses any_stack(top), so we must force the
    // element's rebind closure to position the cursor onto this
    // element first. _ensureCapnwasmReader skips rebind when _gen
    // already matches the runtime generation, which is exactly the
    // common JS-path case. Calling _rebind explicitly here is cheap
    // (one cpp_any_open_list + cpp_any_enter_list_at) and only
    // applies to element readers; root readers have no _rebind so
    // this is a no-op for them.
    lines.push(`    if (this._rebind) this._rebind();`);
    lines.push(`    return _runDraft(this._cpp, ${s.name}Reader._FIELDS, fn);`);
    lines.push(`  }`);
    lines.push("");
    // Materialize every field on this struct as a plain object. Equivalent
    // to `r.draft(p => ({ ...all fields }))` but skips the recording-Proxy
    // planning step because the field set is known at codegen time. Useful
    // for "give me everything" callers (logging, JSON.stringify, building
    // an updated message via Builder.from(cpp, reader.toObject())).
    lines.push(`  toObject() {`);
    lines.push(`    _ensureCapnwasmReader(this);`);
    lines.push(`    if (this._rebind) this._rebind();`);
    lines.push(`    return _capnwasmPick(this._cpp, ${s.name}Reader._FIELDS, Object.keys(${s.name}Reader._FIELDS));`);
    lines.push(`  }`);
    lines.push(`}`);
    // M4: Wire Symbol.dispose to dispose() so `using` works on
    // runtimes that have the symbol. Older runtimes (Node <22 etc.)
    // skip this assignment and the reader still has dispose() to call
    // by hand or via withReader().
    lines.push(`if (typeof Symbol.dispose === "symbol") {`);
    lines.push(`  ${s.name}Reader.prototype[Symbol.dispose] = ${s.name}Reader.prototype.dispose;`);
    lines.push(`}`);
    lines.push("");
  }

  for (const s of structs) {
    lines.push(`_STRUCT_FIELDS[${JSON.stringify(s.name)}] = ${s.name}Reader._FIELDS;`);
  }
  if (structs.length > 0) lines.push("");

  // Builder classes. Counterpart to Readers. One Builder writes one
  // message at a time (the wasm-side AnyStruct::Builder is a global slot).
  // The static _DATA_WORDS / _PTR_WORDS counts let the RPC layer call
  // cpp_rpc_begin_call with the right shape so a Builder can write its
  // bytes directly into Call.params.content's arena (zero-copy path).
  // When opts.preinitialized is true, the constructor skips cpp_any_builder_init
  // because the slot has already been set up by cpp_rpc_begin_call/begin_return.
  for (const s of structs) {
    lines.push(`export class ${s.name}Builder {`);
    lines.push(`  static _DATA_WORDS = ${s.dataWords};`);
    lines.push(`  static _PTR_WORDS = ${s.ptrWords};`);
    lines.push(`  constructor(cpp, opts) {`);
    lines.push(`    this._cpp = cpp;`);
    lines.push(`    this._exp = cpp._exports;`);
    lines.push(`    if (!opts || !opts.preinitialized) {`);
    lines.push(`      if (this._exp.cpp_any_builder_init(${s.dataWords}, ${s.ptrWords}) !== 1) {`);
    lines.push(`        throw new Error("cpp_any_builder_init failed");`);
    lines.push(`      }`);
    lines.push(`    }`);
    // Cache the data section's address and the Uint8Array view AFTER
    // any_builder_init, since init can grow wasm memory which detaches
    // a view captured beforehand. The address stays valid until
    // any_builder_root is replaced (i.e. the next builder init), which
    // happens after this Builder's lifetime. Caching _u8 cuts per-
    // setter allocation: every `b.field = v` would otherwise do
    // `new Uint8Array(cpp.memory.buffer)`. Modern V8 spends more GC
    // time than wasm-call time on a write-heavy struct.
    // If begin_call/begin_return supplied the data pointer (zero-copy RPC
    // path), use it directly. Saves another wasm boundary call per call.
    lines.push(`    this._dataPtr = (opts && opts.dataPtr !== undefined)`);
    lines.push(`      ? opts.dataPtr : this._exp.cpp_any_builder_data_ptr();`);
    lines.push(`    this._u8 = cpp._u8;`);
    // Cache one DataView for the wasm memory.buffer. The 64-bit and float
    // setters all need a DataView; allocating one per setter call was
    // ~15 ns of GC pressure each. The setters reference this._dv directly
    //. Only text/data setters need to refresh it, since they're the
    // paths that can trigger wasm memory growth.
    // Reuse the shared DataView cached on the cpp instance. Refreshed
    // there when memory grows. Saves one alloc per Builder construction
    // (per call on the hot RPC path).
    lines.push(`    this._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
    // Cap-table sink. RPC outbound paths (build_call / build_return)
    // pass a mutable array; capability-typed setters push the cap target
    // into it and write the resulting index into the wire pointer.
    // Non-RPC builders (buildFoo, fromObject) leave it null and the
    // setter throws on non-null cap writes — matches today's behavior
    // for non-RPC contexts where there is no cap table to populate.
    lines.push(`    this._capSink = (opts && opts.capSink) || null;`);
    lines.push(`  }`);
    lines.push("");
    // Union setters: when this struct holds a union, expose
    //   `setWhich(variant)` to write the discriminant explicitly,
    // and have each variant setter automatically write the discriminant
    // before writing its value. Removes the need for users to ever poke
    // raw `cpp_any_builder_set_uint16` calls.
    if (s.discriminantCount && s.discriminantOffsetBits !== undefined) {
      const discByteOff = s.discriminantOffsetBits >> 3;
      lines.push(`  /** Write this struct's union discriminant directly. */`);
      lines.push(`  setWhich(variant) {`);
      lines.push(`    this._exp.cpp_any_builder_set_uint16(${discByteOff}, variant & 0xffff);`);
      lines.push(`  }`);
      lines.push("");
      // Mirror the Reader's static Which constants for consistent API.
      const variants = s.fields.filter(f => f.discriminantValue !== undefined);
      if (variants.length > 0) {
        lines.push(`  static Which = Object.freeze({`);
        for (const v of variants) {
          lines.push(`    ${v.name}: ${v.discriminantValue},`);
        }
        lines.push(`  });`);
        lines.push("");
      }
    }
    for (const f of s.fields) {
      // Group fields: emit a getter returning a sub-Builder writing into
      // the parent's arena (groups share storage). If the group is itself
      // a union variant, accessing it auto-sets the discriminant.
      if (f.kind === "group") {
        lines.push(`  get ${f.name}() {`);
        if (s.discriminantCount && f.discriminantValue !== undefined && s.discriminantOffsetBits !== undefined) {
          const discByteOff = s.discriminantOffsetBits >> 3;
          lines.push(`    this._exp.cpp_any_builder_set_uint16(${discByteOff}, ${f.discriminantValue});`);
        }
        // Inherit the parent's cap sink so capability-typed setters
        // inside the group still target the same outbound cap table.
        lines.push(`    return new ${f.groupStructName}Builder(this._cpp, { preinitialized: true, capSink: this._capSink });`);
        lines.push(`  }`);
        continue;
      }
      // Plain nested struct field: expose a builder-getter that pushes the
      // wasm cursor into this pointer slot before returning a sub-Builder.
      // The caller uses normal `b.nested.field = value` syntax. exitStruct()
      // pops the cursor when the caller is done.
      if (f.kind === "pointer" && declaredStructs && declaredStructs.has(f.type)) {
        const innerStruct = structByName.get(f.type);
        const dWords = innerStruct ? innerStruct.dataWords : 0;
        const pWords = innerStruct ? innerStruct.ptrWords : 0;
        lines.push(`  get ${f.name}() {`);
        if (s.discriminantCount && f.discriminantValue !== undefined && s.discriminantOffsetBits !== undefined) {
          const discByteOff = s.discriminantOffsetBits >> 3;
          lines.push(`    this._exp.cpp_any_builder_set_uint16(${discByteOff}, ${f.discriminantValue});`);
        }
        lines.push(`    if (this._exp.cpp_any_builder_enter_struct(${f.ptrIndex}, ${dWords}, ${pWords}) !== 1) {`);
        lines.push(`      throw new Error("cpp_any_builder_enter_struct failed for ${f.name}");`);
        lines.push(`    }`);
        // Inherit cap sink so a capability-typed field inside the
        // nested struct routes to the same outbound cap table.
        lines.push(`    const sub = new ${f.type}Builder(this._cpp, { preinitialized: true, capSink: this._capSink });`);
        lines.push(`    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();`);
        lines.push(`    sub._exitOnFinalize = true;`);
        lines.push(`    return sub;`);
        lines.push(`  }`);
        // Setter form: assigning a plain object pushes, applies fromObject,
        // then pops. Lets users write `b.nested = { ... }` instead of
        // `b.nested.fromObject({ ... })`.
        lines.push(`  set ${f.name}(value) {`);
        if (s.discriminantCount && f.discriminantValue !== undefined && s.discriminantOffsetBits !== undefined) {
          const discByteOff = s.discriminantOffsetBits >> 3;
          lines.push(`    this._exp.cpp_any_builder_set_uint16(${discByteOff}, ${f.discriminantValue});`);
        }
        lines.push(`    if (value == null) return;`);
        // Reader / orphan-adopt fast path: if the user passes another
        // Cap'n Proto Reader (e.g. one produced from a separately-built
        // "orphan" message), deep-copy its struct content into this
        // pointer slot via setAs<AnyPointer>. Same effect as upstream's
        // `parent.adoptField(orphan)` — gives us orphan ergonomics
        // without per-orphan slot machinery.
        lines.push(`    if (value && value._cpp && typeof value._slotIdx === "number") {`);
        lines.push(`      if (this._exp.cpp_any_builder_set_anypointer_from_slot(${f.ptrIndex}, value._slotIdx) !== 1) {`);
        lines.push(`        throw new Error("orphan/Reader adopt failed for ${f.name}");`);
        lines.push(`      }`);
        lines.push(`      this._u8 = this._cpp._u8;`);
        lines.push(`      this._dataPtr = this._exp.cpp_any_builder_data_ptr();`);
        lines.push(`      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`);
        lines.push(`      return;`);
        lines.push(`    }`);
        lines.push(`    if (value && value._capnpFrame instanceof Uint8Array) {`);
        lines.push(`      const _frame = value._capnpFrame;`);
        lines.push(`      this._cpp._u8.set(_frame, this._exp.cpp_in_ptr());`);
        lines.push(`      if (this._exp.cpp_any_builder_set_struct_from_bytes(${f.ptrIndex}, _frame.length) !== 1) {`);
        lines.push(`        throw new Error("orphan/bytes adopt failed for ${f.name}");`);
        lines.push(`      }`);
        lines.push(`      this._u8 = this._cpp._u8;`);
        lines.push(`      this._dataPtr = this._exp.cpp_any_builder_data_ptr();`);
        lines.push(`      if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`);
        lines.push(`      return;`);
        lines.push(`    }`);
        lines.push(`    if (this._exp.cpp_any_builder_enter_struct(${f.ptrIndex}, ${dWords}, ${pWords}) !== 1) {`);
        lines.push(`      throw new Error("cpp_any_builder_enter_struct failed for ${f.name}");`);
        lines.push(`    }`);
        lines.push(`    const sub = new ${f.type}Builder(this._cpp, { preinitialized: true, capSink: this._capSink });`);
        lines.push(`    sub._dataPtr = this._exp.cpp_any_builder_data_ptr();`);
        lines.push(`    sub.fromObject(value);`);
        lines.push(`    if (this._exp.cpp_any_builder_exit_struct() !== 1) {`);
        lines.push(`      throw new Error("cpp_any_builder_exit_struct failed for ${f.name}");`);
        lines.push(`    }`);
        // Re-fetch this builder's cached pointers — wasm may have grown.
        lines.push(`    this._u8 = this._cpp._u8;`);
        lines.push(`    this._dataPtr = this._exp.cpp_any_builder_data_ptr();`);
        lines.push(`    if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`);
        lines.push(`  }`);
        continue;
      }
      const setter = generateSetter(f, declaredStructs, structByName);
      if (!setter) continue;
      lines.push(`  set ${f.name}(value) {`);
      // If this field is a union variant, auto-write the discriminant.
      // Inline rather than calling setWhich so the data-section write is
      // visible to V8's inliner.
      if (s.discriminantCount && f.discriminantValue !== undefined && s.discriminantOffsetBits !== undefined) {
        const discByteOff = s.discriminantOffsetBits >> 3;
        lines.push(`    this._exp.cpp_any_builder_set_uint16(${discByteOff}, ${f.discriminantValue});`);
      }
      for (const line of setter) lines.push(`    ${line}`);
      lines.push(`  }`);
    }
    lines.push("");
    // fromObject / from. The JSON.stringify-shaped ergonomic helper.
    // Walks a plain JS object and applies its fields to this builder.
    // Per-field code is straight-line setter calls; no runtime dispatch
    // since the field list is hard-coded at codegen time. Missing fields
    // are skipped (caller's intent), unknown fields are ignored (caller's
    // intent. Schema is the contract). Same wire bytes as a hand-rolled
    // setter loop; this is just the codegen writing the loop for you.
    lines.push(`  /**`);
    lines.push(`   * Apply fields from a plain JS object to this builder. Same shape`);
    lines.push(`   * as JSON.stringify on the wire side: pass any object whose keys`);
    lines.push(`   * match the schema field names. Missing keys are skipped, unknown`);
    lines.push(`   * keys are ignored. Returns \`this\` for chaining.`);
    lines.push(`   */`);
    lines.push(`  fromObject(o) {`);
    lines.push(`    if (o == null) return this;`);
    for (const f of s.fields) {
      if (f.kind === "group") {
        // Group fields share storage with the parent struct. Recurse via
        // the getter (which auto-sets the union discriminant if needed).
        lines.push(`    if (o.${f.name} !== undefined) this.${f.name}.fromObject(o.${f.name});`);
        continue;
      }
      // Skip fields the codegen has no setter for. List pointers and
      // struct-ref pointers that aren't text/data. The codegen suppresses
      // these via `generateSetter` returning null; if we emitted them in
      // fromObject they'd silently set a regular JS property and never
      // make it into the wire bytes. Document the gap inline so users
      // see it in their generated file.
      if (!hasFieldSetter(f, declaredStructs)) {
        lines.push(`    // ${f.name}: ${f.type ?? f.kind}. No Builder setter yet for this shape; skipped by fromObject`);
        continue;
      }
      // The public setter handles type coercion (BigInt for u64/i64,
      // string for text, Uint8Array for data, etc.) and auto-writes any
      // union discriminant.
      lines.push(`    if (o.${f.name} !== undefined) this.${f.name} = o.${f.name};`);
    }
    lines.push(`    return this;`);
    lines.push(`  }`);
    lines.push("");
    lines.push(`  /**`);
    lines.push(`   * Build a ${s.name} from a plain JS object in one call.`);
    lines.push(`   * Shorthand for \`new ${s.name}Builder(cpp).fromObject(o)\`.`);
    lines.push(`   */`);
    lines.push(`  static from(cpp, o) {`);
    lines.push(`    return new ${s.name}Builder(cpp).fromObject(o);`);
    lines.push(`  }`);
    lines.push("");
    lines.push(`  /** Serialize the message to framed Cap'n Proto bytes. */`);
    lines.push(`  toBytes() {`);
    lines.push(`    const len = this._exp.cpp_any_builder_finalize();`);
    lines.push(`    if (!len) throw new Error("cpp_any_builder_finalize failed");`);
    // Re-fetch the Uint8Array view after finalize. It can grow wasm
    // memory while it's collecting segments, which detaches a
    // pre-existing typed-array view over the old buffer.
    lines.push(`    const out = this._cpp._outPtr;`);
    lines.push(`    return this._cpp._u8.slice(out, out + len);`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
  }

  // open<Name> + build<Name> helpers for every struct, so the user can pick
  // any of them as the root (e.g. they receive a Post or a Tag depending
  // on which endpoint they're talking to).
  for (const s of structs) {
    lines.push(`/**`);
    lines.push(` * Open framed Cap'n Proto bytes for typed access. Returns a ${s.name}Reader.`);
    lines.push(` */`);
    lines.push(`export function open${s.name}(cpp, bytes) {`);
    lines.push(`  const opened = _openCapnwasmMessage(cpp, bytes, false);`);
    lines.push(`  return new ${s.name}Reader(cpp, opened.dataPtr, opened);`);
    lines.push(`}`);
    lines.push("");
    lines.push(`/** Open bytes through the shared scratch buffer. Faster, but the reader is valid only until the next CapnCpp message open. */`);
    lines.push(`export function open${s.name}Unsafe(cpp, bytes) {`);
    lines.push(`  const opened = _openCapnwasmMessage(cpp, bytes, true);`);
    lines.push(`  return new ${s.name}Reader(cpp, opened.dataPtr, opened);`);
    lines.push(`}`);
    lines.push("");
    lines.push(`/** Begin building a new ${s.name} message. Returns a ${s.name}Builder. */`);
    lines.push(`export function build${s.name}(cpp) {`);
    lines.push(`  return new ${s.name}Builder(cpp);`);
    lines.push(`}`);
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

// Mirror of generateSetter's "would I emit a setter for this field?" logic.
// Used by the fromObject template to decide whether to skip a field. Kept
// in lockstep with generateSetter. If generateSetter starts emitting list
// or struct-ref setters, this needs to learn about them too.
// Names recognised by primitive-list setters. Mirrors the cpp_any_builder
// init/set list exports.
const LIST_PRIMITIVE_KINDS = new Map([
  ["Bool", "bool"],
  ["UInt8", "uint8"],   ["Int8", "int8"],
  ["UInt16", "uint16"], ["Int16", "int16"],
  ["UInt32", "uint32"], ["Int32", "int32"],
  ["UInt64", "uint64"], ["Int64", "int64"],
  ["Float32", "float32"], ["Float64", "float64"],
]);

function hasFieldSetter(field, declaredStructs) {
  if (field.kind === "group") return false;
  if (field.kind === "pointer") {
    if (field.type === "Text" || field.type === "Data" || field.type === "AnyPointer") return true;
    if (declaredStructs && declaredStructs.has(field.type)) return true;
    if (/^Capability\(/.test(field.type ?? "")) return true;
    const listMatch = /^List\(([^)]+)\)$/.exec(field.type);
    if (listMatch) {
      const inner = listMatch[1];
      if (inner === "Text" || inner === "Data") return true;
      if (LIST_PRIMITIVE_KINDS.has(inner)) return true;
      if (declaredStructs && declaredStructs.has(inner)) return true;
    }
    return false;
  }
  return true;
}

// Generate a list setter that mirrors the dynamic builder's list paths,
// but emits straight-line code keyed off the static element type. Returns
// the inlined statement list, or null if the element type isn't supported.
function generateListSetter(field, inner, declaredStructs, structByName) {
  const ptrIndex = field.ptrIndex;
  if (inner === "Text") {
    return [
      `if (!Array.isArray(value)) throw new TypeError("List(Text) field expects an array");`,
      `if (this._exp.cpp_any_builder_init_list_text(${ptrIndex}, value.length) !== 1) {`,
      `  throw new Error("init_list_text failed for ${field.name}");`,
      `}`,
      `const inPtr = this._exp.cpp_in_ptr();`,
      `const inCap = this._exp.cpp_in_capacity();`,
      `for (let i = 0; i < value.length; i++) {`,
      `  const s = value[i];`,
      `  let written;`,
      `  if (typeof s === "string") {`,
      `    const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);`,
      `    written = SHARED_ENCODER.encodeInto(s, dst).written;`,
      `  } else {`,
      `    if (s.length > inCap) throw new Error("text element larger than scratch buffer");`,
      `    this._cpp._u8.set(s, inPtr);`,
      `    written = s.length;`,
      `  }`,
      `  if (this._exp.cpp_any_builder_set_list_text(${ptrIndex}, i, written) !== 1) {`,
      `    throw new Error("set_list_text(" + i + ") failed for ${field.name}");`,
      `  }`,
      `}`,
      `this._u8 = this._cpp._u8;`,
      `this._dataPtr = this._exp.cpp_any_builder_data_ptr();`,
      `if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
    ];
  }
  if (inner === "Data") {
    return [
      `if (!Array.isArray(value)) throw new TypeError("List(Data) field expects an array");`,
      `if (this._exp.cpp_any_builder_init_list_data(${ptrIndex}, value.length) !== 1) {`,
      `  throw new Error("init_list_data failed for ${field.name}");`,
      `}`,
      `const inPtr = this._exp.cpp_in_ptr();`,
      `const inCap = this._exp.cpp_in_capacity();`,
      `for (let i = 0; i < value.length; i++) {`,
      `  const d = value[i];`,
      `  if (!(d instanceof Uint8Array)) throw new TypeError("List(Data) element " + i + " must be a Uint8Array");`,
      `  if (d.length > inCap) throw new Error("data element " + i + " larger than scratch buffer");`,
      `  this._cpp._u8.set(d, inPtr);`,
      `  if (this._exp.cpp_any_builder_set_list_data(${ptrIndex}, i, d.length) !== 1) {`,
      `    throw new Error("set_list_data(" + i + ") failed for ${field.name}");`,
      `  }`,
      `}`,
      `this._u8 = this._cpp._u8;`,
      `this._dataPtr = this._exp.cpp_any_builder_data_ptr();`,
      `if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
    ];
  }
  if (LIST_PRIMITIVE_KINDS.has(inner)) {
    const kind = LIST_PRIMITIVE_KINDS.get(inner);
    if (kind === "bool") {
      return [
        `if (!Array.isArray(value)) throw new TypeError("List(Bool) field expects an array");`,
        `if (this._exp.cpp_any_builder_init_list_bool(${ptrIndex}, value.length) !== 1) {`,
        `  throw new Error("init_list_bool failed for ${field.name}");`,
        `}`,
        `for (let i = 0; i < value.length; i++) {`,
        `  this._exp.cpp_any_builder_set_list_bool(${ptrIndex}, i, value[i] ? 1 : 0);`,
        `}`,
      ];
    }
    if (kind === "uint64" || kind === "int64") {
      return [
        `if (!Array.isArray(value)) throw new TypeError("List(${inner}) field expects an array");`,
        `if (this._exp.cpp_any_builder_init_list_${kind}(${ptrIndex}, value.length) !== 1) {`,
        `  throw new Error("init_list_${kind} failed for ${field.name}");`,
        `}`,
        `for (let i = 0; i < value.length; i++) {`,
        `  const v = value[i];`,
        `  this._exp.cpp_any_builder_set_list_${kind}(${ptrIndex}, i, typeof v === "bigint" ? v : BigInt(v));`,
        `}`,
      ];
    }
    return [
      `if (!Array.isArray(value)) throw new TypeError("List(${inner}) field expects an array");`,
      `if (this._exp.cpp_any_builder_init_list_${kind}(${ptrIndex}, value.length) !== 1) {`,
      `  throw new Error("init_list_${kind} failed for ${field.name}");`,
      `}`,
      `for (let i = 0; i < value.length; i++) {`,
      `  this._exp.cpp_any_builder_set_list_${kind}(${ptrIndex}, i, value[i]);`,
      `}`,
    ];
  }
  if (declaredStructs && declaredStructs.has(inner)) {
    const innerStruct = structByName.get(inner);
    const dWords = innerStruct ? innerStruct.dataWords : 0;
    const pWords = innerStruct ? innerStruct.ptrWords : 0;
    return [
      `if (!Array.isArray(value)) throw new TypeError("List(${inner}) field expects an array");`,
      `if (this._exp.cpp_any_builder_init_list_struct(${ptrIndex}, value.length, ${dWords}, ${pWords}) !== 1) {`,
      `  throw new Error("init_list_struct failed for ${field.name}");`,
      `}`,
      `for (let i = 0; i < value.length; i++) {`,
      `  const item = value[i];`,
      `  if (item == null) continue;`,
      `  if (this._exp.cpp_any_builder_enter_list_element(${ptrIndex}, i) !== 1) {`,
      `    throw new Error("enter_list_element(" + i + ") failed for ${field.name}");`,
      `  }`,
      `  const sub = new ${inner}Builder(this._cpp, { preinitialized: true, capSink: this._capSink });`,
      `  sub._dataPtr = this._exp.cpp_any_builder_data_ptr();`,
      `  sub.fromObject(item);`,
      `  if (this._exp.cpp_any_builder_exit_struct() !== 1) {`,
      `    throw new Error("exit_struct(list element) failed for ${field.name}");`,
      `  }`,
      `}`,
      `this._u8 = this._cpp._u8;`,
      `this._dataPtr = this._exp.cpp_any_builder_data_ptr();`,
      `if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
    ];
  }
  return null;
}

function generateSetter(field, declaredStructs, structByName) {
  // Group fields aren't assignable directly. The Builder exposes them as
  // a getter that returns a sub-Builder you write into:
  //   b.address.street = "...";
  // We emit the getter outside generateSetter (in the Builder loop above)
  // and skip setter generation here.
  if (field.kind === "group") return null;
  if (field.kind === "pointer") {
    if (field.type === "AnyPointer") {
      // Multi-shape AnyPointer setter:
      //   string                       -> Text
      //   Uint8Array                   -> Data
      //   capnwasm Reader (any class)  -> deep-copy struct from source slot
      //   { _capnpFrame: Uint8Array }  -> deep-copy from a framed Cap'n Proto
      //                                   message (e.g. produced by
      //                                   `someBuilder.toBytes()`)
      //   null / undefined             -> leave slot empty (no-op)
      //
      // Reader detection is duck-typed: any object exposing _slotIdx + _cpp
      // is treated as a capnwasm Reader. The struct copy goes through
      // cpp_any_builder_set_anypointer_from_slot, which calls upstream's
      // AnyPointer::Builder::setAs<AnyPointer>(reader.getRoot()) — bit-
      // identical to writing the same struct through a typed sibling field.
      return [
        `if (typeof value === "string") {`,
        `  const inPtr = this._exp.cpp_in_ptr();`,
        `  const inCap = this._exp.cpp_in_capacity();`,
        `  const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);`,
        `  const { written } = SHARED_ENCODER.encodeInto(value, dst);`,
        `  this._exp.cpp_any_builder_set_text(${field.ptrIndex}, written);`,
        `  this._u8 = this._cpp._u8;`,
        `  if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
        `  return;`,
        `}`,
        `if (value instanceof Uint8Array) {`,
        `  this._cpp._u8.set(value, this._exp.cpp_in_ptr());`,
        `  this._exp.cpp_any_builder_set_data(${field.ptrIndex}, value.length);`,
        `  this._u8 = this._cpp._u8;`,
        `  if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
        `  return;`,
        `}`,
        `if (value && value._cpp && typeof value._slotIdx === "number") {`,
        `  // Reader instance — deep copy via slot.`,
        `  if (this._exp.cpp_any_builder_set_anypointer_from_slot(${field.ptrIndex}, value._slotIdx) !== 1) {`,
        `    throw new Error("AnyPointer struct copy from slot failed (slot released or wrong type)");`,
        `  }`,
        `  this._u8 = this._cpp._u8;`,
        `  if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
        `  return;`,
        `}`,
        `if (value && value._capnpFrame instanceof Uint8Array) {`,
        `  const frame = value._capnpFrame;`,
        `  this._cpp._u8.set(frame, this._exp.cpp_in_ptr());`,
        `  if (this._exp.cpp_any_builder_set_struct_from_bytes(${field.ptrIndex}, frame.length) !== 1) {`,
        `    throw new Error("AnyPointer struct copy from bytes failed (malformed framed message)");`,
        `  }`,
        `  this._u8 = this._cpp._u8;`,
        `  if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
        `  return;`,
        `}`,
        `if (value == null) return;`,
        `throw new TypeError("AnyPointer setter accepts string (Text), Uint8Array (Data), a capnwasm Reader (struct deep-copy), or { _capnpFrame: Uint8Array } (raw framed message)");`,
      ];
    }
    const listMatch = /^List\(([^)]+)\)$/.exec(field.type ?? "");
    if (listMatch) {
      return generateListSetter(field, listMatch[1], declaredStructs, structByName);
    }
    if (field.type === "Text") {
      // encodeInto writes UTF-8 bytes directly into the destination Uint8Array
      //. No intermediate JS allocation. The destination is a subarray view of
      // wasm linear memory at cpp_in_ptr(), so the bytes land where the C++
      // setter will read them in one step. Re-fetch the view via cpp._u8
      // because cpp_any_builder_set_text can grow wasm memory (large texts
      // trigger MallocMessageBuilder segment allocation), which detaches
      // any pre-existing typed-array view. After the wasm call, refresh the
      // constructor-cached _u8 so subsequent primitive setters see a live
      // buffer.
      return [
        `const inPtr = this._exp.cpp_in_ptr();`,
        `const inCap = this._exp.cpp_in_capacity();`,
        `const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);`,
        `const { written } = SHARED_ENCODER.encodeInto(value, dst);`,
        `this._exp.cpp_any_builder_set_text(${field.ptrIndex}, written);`,
        `this._u8 = this._cpp._u8;`,
        // Refresh the cached DataView too. Cpp_any_builder_set_text may
        // have grown wasm memory and detached the view.
        `if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
      ];
    }
    if (field.type === "Data") {
      // Same memory.grow caveat as Text. Fetch the view, do the write, then
      // refresh the constructor-cached _u8 for any setters that follow.
      return [
        `const u8 = this._cpp._u8;`,
        `u8.set(value, this._exp.cpp_in_ptr());`,
        `this._exp.cpp_any_builder_set_data(${field.ptrIndex}, value.length);`,
        `this._u8 = this._cpp._u8;`,
        `if (this._dv.buffer !== this._u8.buffer) this._dv = new DataView(this._u8.buffer);`,
      ];
    }
    if (/^Capability\(/.test(field.type ?? "")) {
      // Capability-typed setter. Pushes the cap target into the
      // builder's cap sink (a mutable array threaded through by
      // RpcSession's outbound build paths) and writes the resulting
      // index into the wire pointer. Without a cap sink we throw —
      // the field simply cannot carry a real cap outside an RPC context.
      return [
        `if (value == null) return;`,
        `if (!this._capSink) {`,
        `  throw new TypeError("capability fields can only be set to null outside an RPC context");`,
        `}`,
        `const _capIdx = this._capSink.length;`,
        `this._capSink.push(value);`,
        `if (this._exp.cpp_any_builder_set_cap_index(${field.ptrIndex}, _capIdx) !== 1) {`,
        `  throw new Error("cpp_any_builder_set_cap_index failed");`,
        `}`,
      ];
    }
    return null;  // struct refs need nested builder support
  }
  // Primitive setters write DIRECTLY into wasm linear memory at the data
  // section's known offset. No wasm boundary crossing per setter. V8 just
  // stores bytes through the typed-array view. The DataView is rebuilt from
  // the (potentially refreshed) wasm memory on each call so we're safe
  // across memory.grow events. Allocating a DataView is cheap; V8 inlines.
  const off = field.bitOffset >> 3;
  switch (field.type) {
    case "Bool": {
      const byte = field.bitOffset >> 3;
      const bit = field.bitOffset & 7;
      const mask = 1 << bit;
      return [
        `const u8 = this._u8;`,
        `const off = this._dataPtr + ${byte};`,
        `if (value) u8[off] |= ${mask};`,
        `else u8[off] &= ${(~mask) & 0xff};`,
      ];
    }
    case "UInt8":
    case "Int8":
      return [`this._u8[this._dataPtr + ${off}] = value & 0xff;`];
    case "UInt16":
    case "Int16":
      return [
        `const u8 = this._u8;`,
        `const o = this._dataPtr + ${off};`,
        `u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;`,
      ];
    case "UInt32":
    case "Int32":
      return [
        `const u8 = this._u8;`,
        `const o = this._dataPtr + ${off};`,
        `u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;`,
        `u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;`,
      ];
    case "UInt64":
    case "Int64":
      // Use the cached _dv (allocated once at constructor; text/data
      // setters refresh it after any wasm memory growth). setBigInt64
      // handles BigInt directly. For normal-Number input, we still need
      // the manual lo/hi dance to preserve precision past 2^53.
      return [
        `const dv = this._dv;`,
        `if (typeof value === "bigint") {`,
        `  dv.setBigInt64(this._dataPtr + ${off}, value, true);`,
        `} else {`,
        `  let lo, hi;`,
        `  if (value >= 0) { lo = (value >>> 0); hi = ((value / 4294967296) >>> 0); }`,
        `  else { const abs = -value; const aLo = (abs >>> 0); const aHi = ((abs / 4294967296) >>> 0);`,
        `         lo = (~aLo + 1) >>> 0; hi = (~aHi + (lo === 0 ? 1 : 0)) >>> 0; }`,
        `  dv.setUint32(this._dataPtr + ${off}, lo, true);`,
        `  dv.setUint32(this._dataPtr + ${off + 4}, hi, true);`,
        `}`,
      ];
    case "Float32":
      return [
        `this._dv.setFloat32(this._dataPtr + ${off}, value, true);`,
      ];
    case "Float64":
      return [
        `this._dv.setFloat64(this._dataPtr + ${off}, value, true);`,
      ];
    default:
      return null;
  }
}

/**
 * Emit a `.d.ts` for the same set of structs. Each Cap'n Proto type maps
 * back to its closest TS type so consumers get autocomplete + type errors
/**
 * Emit interface metadata for capnp interfaces. The output is a single
 * `<Name>_INTERFACE` const per interface, plus a callable proxy factory
 * that the runtime helper `typedClient(cap, meta)` consumes.
 *
 * Each method entry references the params/results Builder/Reader classes
 * directly (already exported by generateJs), so no separate import step
 * is needed at the user's call site.
 */
function generateInterfaceMeta(interfaces, structs) {
  const lines = [];
  lines.push(`// --- Interface metadata ---`);
  lines.push("");
  for (const iface of interfaces) {
    const name = iface.name;
    lines.push(`export const ${name}_INTERFACE = Object.freeze({`);
    lines.push(`  name: ${JSON.stringify(name)},`);
    lines.push(`  id: BigInt("${iface.id}"),`);
    lines.push(`  methods: Object.freeze([`);
    for (const m of iface.methods) {
      // Convention: capnpc emits param/result struct displayName as
      // "<methodName>$Params" / "<methodName>$Results", which our struct
      // generator surfaces as <methodName>$ParamsBuilder etc. Reference
      // them directly by name since both live in the same .gen.mjs.
      const paramsName = `${m.name}$Params`;
      const resultsName = `${m.name}$Results`;
      lines.push(`    Object.freeze({`);
      lines.push(`      id: ${m.id},`);
      lines.push(`      name: ${JSON.stringify(m.name)},`);
      lines.push(`      Params: ${paramsName}Builder,`);
      lines.push(`      ParamsReader: ${paramsName}Reader,`);
      lines.push(`      openParams: open${paramsName},`);
      lines.push(`      Results: ${resultsName}Builder,`);
      lines.push(`      ResultsReader: ${resultsName}Reader,`);
      lines.push(`      openResults: open${resultsName},`);
      lines.push(`    }),`);
    }
    lines.push(`  ]),`);
    lines.push(`});`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Emit .d.ts companion for the interface metadata + a per-interface
 *  Client type that the typed proxy returns. The Client type maps each
 *  capnp method to a typed `(args) => Promise<results>` signature so
 *  IDE completion works on `proxy.someMethod(args)` calls. */
function generateInterfaceDts(interfaces, structs) {
  const lines = [];
  const declared = new Set(structs.map((s) => s.name));
  // Build a lookup from struct name to its definition.
  const structByName = new Map(structs.map((s) => [s.name, s]));

  lines.push(`// --- Interface metadata + typed clients ---`);
  lines.push("");
  lines.push(`export interface CapnInterfaceMeta {`);
  lines.push(`  name: string;`);
  lines.push(`  id: bigint;`);
  lines.push(`  methods: ReadonlyArray<CapnMethodMeta>;`);
  lines.push(`}`);
  lines.push(`export interface CapnMethodMeta {`);
  lines.push(`  id: number;`);
  lines.push(`  name: string;`);
  lines.push(`  Params: any;`);
  lines.push(`  ParamsReader: any;`);
  lines.push(`  openParams: (cpp: any, bytes: Uint8Array) => any;`);
  lines.push(`  Results: any;`);
  lines.push(`  ResultsReader: any;`);
  lines.push(`  openResults: (cpp: any, bytes: Uint8Array) => any;`);
  lines.push(`}`);
  lines.push("");

  // Per-interface: a Client interface listing each method as a typed call.
  for (const iface of interfaces) {
    lines.push(`/** Typed client for the ${iface.name} interface. Pass into typed/typedClient. */`);
    lines.push(`export interface ${iface.name}Client {`);
    for (const m of iface.methods) {
      const paramsStruct = structByName.get(`${m.name}$Params`);
      const resultsStruct = structByName.get(`${m.name}$Results`);
      const argsType = paramsStruct ? structToTsObjectType(paramsStruct, declared) : "void";
      const resultType = resultsStruct ? structToTsObjectType(resultsStruct, declared) : "void";
      const argsParam = argsType === "void" || argsType === "{}" ? "" : `args: ${argsType}`;
      lines.push(`  ${m.name}(${argsParam}): Promise<${resultType}>;`);
    }
    lines.push(`}`);
    lines.push("");
    lines.push(`export declare const ${iface.name}_INTERFACE: CapnInterfaceMeta;`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Render a struct's fields as a TS object-type literal: `{ a: string; b: number }`. */
function structToTsObjectType(struct, declared) {
  if (!struct.fields || struct.fields.length === 0) return "{}";
  const props = struct.fields.map((f) => `${f.name}: ${capnpToTs(f.type, declared)}`);
  return `{ ${props.join("; ")} }`;
}

/**
 * on field misuse. Map mirrors TS_TO_CAPNP from parseTsInterfaces.
 */
function generateDts(structs, schemaName) {
  const lines = [];
  lines.push(`// Generated from ${schemaName} by capnwasm-gen. Do not edit by hand.`);
  lines.push("");
  lines.push(`import type { CapnCpp } from "capnwasm";`);
  lines.push("");

  const declared = new Set(structs.map((s) => s.name));
  for (const s of structs) {
    lines.push(`export declare class ${s.name}Reader {`);
    lines.push(`  constructor(cpp: CapnCpp);`);
    for (const f of s.fields) {
      const tsType = capnpToTs(f.type, declared);
      lines.push(`  readonly ${f.name}: ${tsType};`);
    }
    // Plain-object materialization shape for toObject().
    lines.push(`  toObject(): {`);
    for (const f of s.fields) {
      const tsType = capnpToTs(f.type, declared);
      lines.push(`    ${f.name}: ${tsType};`);
    }
    lines.push(`  };`);
    // pick + plan/apply
    const fieldUnion = s.fields.map((f) => `"${f.name}"`).join(" | ");
    lines.push(`  draft<T>(fn: (draft: any) => T): T;`);
    lines.push(`}`);
    lines.push("");
  }
  if (structs.length > 0) {
    const root = structs[0];
    lines.push(`export declare function open${root.name}(cpp: CapnCpp, bytes: Uint8Array): ${root.name}Reader;`);
    lines.push(`export declare function open${root.name}Unsafe(cpp: CapnCpp, bytes: Uint8Array): ${root.name}Reader;`);
  }
  return lines.join("\n") + "\n";
}

// Maps a primitive capnp type to the typed-array constructor that view()
// returns. Mirrors PRIMITIVE_LIST_VIEWS but lives in the dts emitter so we
// can produce precise return types per field. Bool is omitted: it has no
// view() at runtime either (bit-packed).
const PRIMITIVE_TYPED_ARRAY = {
  "UInt8":   "Uint8Array",
  "Int8":    "Int8Array",
  "UInt16":  "Uint16Array",
  "Int16":   "Int16Array",
  "UInt32":  "Uint32Array",
  "Int32":   "Int32Array",
  "UInt64":  "BigUint64Array",
  "Int64":   "BigInt64Array",
  "Float32": "Float32Array",
  "Float64": "Float64Array",
};

function capnpToTs(capnpType, declaredStructs) {
  const listMatch = /^List\(([^)]+)\)$/.exec(capnpType);
  if (listMatch) {
    const inner = listMatch[1];
    const innerTs = capnpToTs(inner, declaredStructs);
    // Primitive-element lists expose view() with a precise typed-array
    // return type. Struct-element lists intentionally expose length only;
    // project rows through draft() instead of allocating stable row readers.
    const viewCtor = PRIMITIVE_TYPED_ARRAY[inner];
    if (viewCtor) {
      return `{ readonly length: number; view(): ${viewCtor}; [Symbol.iterator](): IterableIterator<${innerTs}> }`;
    }
    if (declaredStructs.has(inner)) return `{ readonly length: number }`;
    return `{ readonly length: number; [Symbol.iterator](): IterableIterator<${innerTs}> }`;
  }
  if (declaredStructs.has(capnpType)) return capnpType + "Reader";
  // Capability(<Iface>) — null today (real cap-table-backed proxies are
  // future work). Setter accepts null only.
  if (/^Capability\(/.test(capnpType)) return "null";
  switch (capnpType) {
    case "Bool":   return "boolean";
    case "Text":   return "string";
    case "Data":   return "Uint8Array";
    case "Int8": case "Int16": case "Int32":
    case "UInt8": case "UInt16": case "UInt32":
    case "Float32": case "Float64": return "number";
    case "Int64": case "UInt64":    return "number | bigint";
    case "Void":   return "void";
    default:       return "unknown";
  }
}

/**
 * Field descriptor written into the generated class's _FIELDS table. The
 * runtime helper _capnwasmPick uses these to issue ONE batched wasm call
 * via cpp_any_batch_read. Kind values must agree with wrapper.cpp.
 */
function fieldDescriptor(f) {
  if (f.kind === "pointer") {
    if (f.type === "Text") return { kind: 0, off: f.ptrIndex, type: "text" };
    if (f.type === "Data") return { kind: 6, off: f.ptrIndex, type: "data" };
    return { kind: -1, off: f.ptrIndex, type: f.type };
  }
  const off = f.bitOffset >> 3;
  switch (f.type) {
    case "Bool":   return { kind: 5, off: f.bitOffset, type: "bool" };
    case "UInt8":  return { kind: 1, off, type: "uint8" };
    case "Int8":   return { kind: 1, off, type: "int8" };
    case "UInt16": return { kind: 2, off, type: "uint16" };
    case "Int16":  return { kind: 2, off, type: "int16" };
    case "UInt32": return { kind: 3, off, type: "uint32" };
    case "Int32":  return { kind: 3, off, type: "int32" };
    case "UInt64": return { kind: 4, off, type: "uint64" };
    case "Int64":  return { kind: 4, off, type: "int64" };
    case "Float32":return { kind: 3, off, type: "float32" };
    case "Float64":return { kind: 4, off, type: "float64" };
    default:       return { kind: -1, off: 0, type: f.type };
  }
}

// Emit JS for a List<X> getter. Value lists expose length plus iteration
// (and view() for typed-array-compatible primitive lists). Struct lists expose
// length only; project rows through draft() so generated code can plan the
// object shape without allocating stable row-reader objects.
function generateListGetter(ptrIndex, innerType, parentDataWords) {
  const lines = [];
  lines.push(`const reader = this;`);
  lines.push(`const cpp = this._cpp;`);
  // Eager wasm-cursor open. Needed only by Text/Data list getters and by
  // the cursor-fallback path of primitive lists. For primitive lists with
  // a typed-array view (everything except Bool), the fast path uses
  // _jsReadListPrimPtr instead and never needs the wasm cursor — calling
  // cpp_any_open_list per getter call would push any_list_reader state
  // and (at large N with repeated opens) walk the cursor stack into a
  // trap. We delay the wasm open into the cursor-fallback branch only,
  // matching what the struct-list path already does.
  const isPrimWithView = PRIMITIVE_LIST_GETTERS[innerType] && PRIMITIVE_LIST_VIEWS[innerType];
  const eagerOpen = PRIMITIVE_LIST_GETTERS[innerType] && !isPrimWithView;
  if (eagerOpen) {
    lines.push(`const size = cpp._exports.cpp_any_open_list(${ptrIndex});`);
  }
  // The wrapper closes over `cpp` (and `size` when eagerly opened).
  if (PRIMITIVE_LIST_GETTERS[innerType]) {
    const primFn = PRIMITIVE_LIST_GETTERS[innerType];
    const viewSpec = PRIMITIVE_LIST_VIEWS[innerType];
    // For typed-array-mappable element types (everything except Bool):
    //   1. Decode the list pointer once via _jsReadListPrimPtr (pure JS).
    //   2. Cache {elementsBase, count}.
    //   3. view() returns a typed-array subarray over the cached range.
    //
    // The cursor-based fallback (cpp_any_open_list per element) is kept
    // for unsafe / no-_msgEnd readers and for Bool (bit-packed, no view).
    //
    // The previous element accessor reopened the list on every iteration.
    // That mutated the C++ any_list_reader cursor every element and at large
    // N (8000+) traps after enough opens — see Trap 9 in the notes. The
    // single-decode + typed-array path eliminates the boundary call and the
    // latent state corruption at the same time.
    if (viewSpec) {
      // Captured once at getter time: the parent's _u8 plus the decoded
      // {elementsBase, count}. view() reads through reader._<view> (refreshed
      // on memory growth by _ensureCapnwasmReader — same plumbing as primitive
      // struct-field reads). No wasm boundary call per element.
      lines.push(`const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;`);
      lines.push(`let _desc = null;`);
      lines.push(`if (_msgEnd) {`);
      lines.push(`  _desc = _jsReadListPrimPtr(reader._u8, reader._dv, reader._dataPtr, ${parentDataWords}, ${ptrIndex}, _msgStart, _msgEnd, ${1 << viewSpec.shift});`);
      lines.push(`}`);
      lines.push(`if (_desc) {`);
      lines.push(`  const _count = _desc.count;`);
      lines.push(`  const _baseByte = _desc.elementsBase;`);
      lines.push(`  const _baseIdx = _baseByte >>> ${viewSpec.shift};`);
      lines.push(`  return {`);
      lines.push(`    length: _count,`);
      lines.push(`    view() {`);
      // Subarray of the parent's cached view (when present) is the cheapest
      // form: zero allocation beyond the subarray descriptor. Otherwise
      // construct a fresh typed array; still O(1) and zero-copy.
      if (viewSpec.field) {
        lines.push(`      if (reader.${viewSpec.field}.buffer !== cpp.memory.buffer) {`);
        lines.push(`        reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
        lines.push(`        reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
        lines.push(`      }`);
        lines.push(`      return reader.${viewSpec.field}.subarray(_baseIdx, _baseIdx + _count);`);
      } else {
        lines.push(`      if (reader._u8.buffer !== cpp.memory.buffer) {`);
        lines.push(`        reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
        lines.push(`        reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
        lines.push(`      }`);
        lines.push(`      return new ${viewSpec.ctor}(reader._u8.buffer, _baseByte, _count);`);
      }
      lines.push(`    },`);
      lines.push(`    *[Symbol.iterator]() { yield* this.view(); },`);
      lines.push(`  };`);
      lines.push(`}`);
      lines.push(`// Cursor-based fallback: unsafe reader, no _msgEnd, or pointer decode failed.`);
    }
    // Cursor-based path. Used by:
    //   - Bool lists (no typed-array mapping, bit-packed)
    //   - Unsafe / cursor-only readers (no _msgEnd) when the fast path
    //     above couldn't decode the pointer in JS
    // Open the list now (the eager open at the top was skipped for
    // typed-array-able primitive lists to avoid trapping at large N).
    if (!eagerOpen) {
      lines.push(`const size = cpp._exports.cpp_any_open_list(${ptrIndex});`);
    }
    lines.push(`return {`);
    lines.push(`  length: size,`);
    lines.push(`  *[Symbol.iterator]() {`);
    lines.push(`    for (let i = 0; i < size; i++) {`);
    lines.push(`      _ensureCapnwasmReader(reader);`);
    lines.push(`      cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`      yield ${primFn};`);
    lines.push(`    }`);
    lines.push(`  },`);
    if (viewSpec) {
      // Cursor-based readers can't safely return an aliased view (the
      // bytes aren't pinned to a known address). Throw cleanly.
      lines.push(`  view() { throw new Error("view() requires a slot-pool reader; got an unsafe / cursor-only reader"); },`);
    }
    lines.push(`};`);
    return lines;
  }
  if (innerType === "Text") {
    lines.push(`const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;`);
    lines.push(`let _desc = null;`);
    lines.push(`if (_msgEnd) {`);
    lines.push(`  if (reader._u8.buffer !== cpp.memory.buffer) {`);
    lines.push(`    reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
    lines.push(`    reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
    lines.push(`  }`);
    lines.push(`  _desc = _jsReadListPointerPtr(reader._u8, reader._dv, reader._dataPtr, ${parentDataWords}, ${ptrIndex}, _msgStart, _msgEnd);`);
    lines.push(`}`);
    lines.push(`if (_desc) {`);
    lines.push(`  const _count = _desc.count;`);
    lines.push(`  const _baseByte = _desc.elementsBase;`);
    lines.push(`  return {`);
    lines.push(`    length: _count,`);
    lines.push(`    *[Symbol.iterator]() {`);
    lines.push(`      for (let i = 0; i < _count; i++) {`);
    lines.push(`      if (reader._u8.buffer !== cpp.memory.buffer) {`);
    lines.push(`        reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
    lines.push(`        reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
    lines.push(`      }`);
    lines.push(`      const v = _jsReadTextPtrAt(reader._u8, reader._dv, _baseByte + i * 8, _msgStart, _msgEnd);`);
    lines.push(`      if (v !== undefined) { yield v ?? ""; continue; }`);
    lines.push(`      _ensureCapnwasmReader(reader);`);
    lines.push(`      cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`      const len = cpp._exports.cpp_any_list_get_text(i);`);
    lines.push(`      if (len === 0) { yield ""; continue; }`);
    lines.push(`      const out = cpp._outPtr;`);
    lines.push(`      yield decodeAscii(cpp._u8.subarray(out, out + len));`);
    lines.push(`      }`);
    lines.push(`    },`);
    lines.push(`  };`);
    lines.push(`}`);
    lines.push(`const size = cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`return {`);
    lines.push(`  length: size,`);
    lines.push(`  *[Symbol.iterator]() {`);
    lines.push(`    for (let i = 0; i < size; i++) {`);
    lines.push(`      _ensureCapnwasmReader(reader);`);
    lines.push(`      cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`    const len = cpp._exports.cpp_any_list_get_text(i);`);
    lines.push(`      if (len === 0) { yield ""; continue; }`);
    lines.push(`    const out = cpp._outPtr;`);
    lines.push(`      yield decodeAscii(cpp._u8.subarray(out, out + len));`);
    lines.push(`    }`);
    lines.push(`  },`);
    lines.push(`};`);
    return lines;
  }
  if (innerType === "Data") {
    lines.push(`const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;`);
    lines.push(`let _desc = null;`);
    lines.push(`if (_msgEnd) {`);
    lines.push(`  if (reader._u8.buffer !== cpp.memory.buffer) {`);
    lines.push(`    reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
    lines.push(`    reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
    lines.push(`  }`);
    lines.push(`  _desc = _jsReadListPointerPtr(reader._u8, reader._dv, reader._dataPtr, ${parentDataWords}, ${ptrIndex}, _msgStart, _msgEnd);`);
    lines.push(`}`);
    lines.push(`if (_desc) {`);
    lines.push(`  const _count = _desc.count;`);
    lines.push(`  const _baseByte = _desc.elementsBase;`);
    lines.push(`  return {`);
    lines.push(`    length: _count,`);
    lines.push(`    *[Symbol.iterator]() {`);
    lines.push(`      for (let i = 0; i < _count; i++) {`);
    lines.push(`      if (reader._u8.buffer !== cpp.memory.buffer) {`);
    lines.push(`        reader._u8 = cpp._u8; reader._dv = (cpp._dv && cpp._dv()) || new DataView(cpp._u8.buffer);`);
    lines.push(`        reader._u16 = cpp._u16; reader._i16 = cpp._i16; reader._u32 = cpp._u32; reader._i32 = cpp._i32; reader._f32 = cpp._f32; reader._f64 = cpp._f64;`);
    lines.push(`      }`);
    lines.push(`      const v = _jsReadDataPtrAt(reader._u8, reader._dv, _baseByte + i * 8, _msgStart, _msgEnd);`);
    lines.push(`      if (v !== undefined) { yield v ?? new Uint8Array(0); continue; }`);
    lines.push(`      _ensureCapnwasmReader(reader);`);
    lines.push(`      cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`      const len = cpp._exports.cpp_any_list_get_data(i);`);
    lines.push(`      const out = cpp._outPtr;`);
    lines.push(`      yield cpp._u8.slice(out, out + len);`);
    lines.push(`      }`);
    lines.push(`    },`);
    lines.push(`  };`);
    lines.push(`}`);
    lines.push(`const size = cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`return {`);
    lines.push(`  length: size,`);
    lines.push(`  *[Symbol.iterator]() {`);
    lines.push(`    for (let i = 0; i < size; i++) {`);
    lines.push(`      _ensureCapnwasmReader(reader);`);
    lines.push(`      cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`    const len = cpp._exports.cpp_any_list_get_data(i);`);
    lines.push(`    const out = cpp._outPtr;`);
    lines.push(`      yield cpp._u8.slice(out, out + len);`);
    lines.push(`    }`);
    lines.push(`  },`);
    lines.push(`};`);
    return lines;
  }
  // Struct element list. M5.5: when the parent reader carries
  // _msgStart/_msgEnd (slot-pool path), decode the List<Struct>
  // pointer in pure JS. Generated public List(Struct) views expose length
  // only; use draft() for row projection/materialization.
  lines.push(`const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;`);
  lines.push(`const _u8 = reader._u8, _dv = reader._dv;`);
  // Decode the List<Struct> pointer once at getter time to expose length
  // without crossing into wasm when the safe slot-pool path has bounds.
  lines.push(`let _listDesc = null;`);
  lines.push(`if (_msgEnd) {`);
  lines.push(`  _listDesc = _jsReadListStructPtr(_u8, _dv, reader._dataPtr, ${parentDataWords}, ${ptrIndex}, _msgStart, _msgEnd);`);
  lines.push(`}`);
  lines.push(`if (_listDesc && _listDesc !== undefined) {`);
  lines.push(`  return {`);
  lines.push(`    length: _listDesc.count,`);
  lines.push(`  };`);
  lines.push(`}`);
  // Pre-M5.5 C++ fallback (also used by openFooUnsafe). Open the list
  // here lazily because the eager open at the top of this getter was
  // skipped for the struct case.
  lines.push(`const size = cpp._exports.cpp_any_open_list(${ptrIndex});`);
  lines.push(`let pushed = false;`);
  lines.push(`return {`);
  lines.push(`  length: size,`);
  lines.push(`};`);
  return lines;
}

const PRIMITIVE_LIST_GETTERS = {
  "Bool":   "cpp._exports.cpp_any_list_get_bool(i) === 1",
  "UInt8":  "cpp._exports.cpp_any_list_get_uint8(i)",
  "Int8":   "(cpp._exports.cpp_any_list_get_uint8(i) << 24) >> 24",
  "UInt16": "cpp._exports.cpp_any_list_get_uint16(i)",
  "Int16":  "(cpp._exports.cpp_any_list_get_uint16(i) << 16) >> 16",
  "UInt32": "cpp._exports.cpp_any_list_get_uint32(i) >>> 0",
  "Int32":  "cpp._exports.cpp_any_list_get_uint32(i) | 0",
  "UInt64": "cpp._exports.cpp_any_list_get_uint64(i)",
  "Int64":  "cpp._exports.cpp_any_list_get_uint64(i)",
  // Float bits come back as integer; reinterpret via the module-scoped
  // shared view so the cost is one typed-array store + load, no per-call
  // ArrayBuffer alloc. Without these entries codegen incorrectly treated
  // List(Float32/Float64) as struct-element lists and produced
  // "FloatXXReader is not defined" errors at first list access.
  "Float32": "(_F32_VIEW_U32[0] = (cpp._exports.cpp_any_list_get_float32_bits(i) >>> 0), _F32_VIEW_F32[0])",
  // Single wasm call returns a 64-bit BigInt; split into two u32 halves for
  // the bit-reinterpret without a second boundary crossing.
  "Float64": "((bits) => { _F64_VIEW_U32[0] = Number(bits & 0xFFFFFFFFn) >>> 0; _F64_VIEW_U32[1] = Number(bits >> 32n) >>> 0; return _F64_VIEW_F64[0]; })(cpp._exports.cpp_any_list_get_float64_bits(i))",
};

// Maps a capnp primitive type to:
//   ctor   — the JS typed-array constructor name (Float64Array, Uint32Array...)
//   shift  — log2(elementSize). For computing typed-array index from a byte
//            offset: idx = byteOffset >>> shift.
//   field  — the cached typed-array field name on the Reader (`_u8`, `_u32`, ...).
// Used by list.view() codegen. Bool is omitted: capnp bit-packs bool list
  // elements 8-per-byte, no clean typed-array mapping; those value lists use
  // iterator reads over the cursor path.
//
// Int64 / UInt64 use BigInt typed arrays — the view itself is zero-copy,
// but iterating it allocates a BigInt per element. Still useful for code
// that stays in BigInt land or hands the view to a typed consumer.
//
// The Reader doesn't currently cache _u8/_i8/_u64/_i64 typed-array fields
// (they aren't used in struct-field reads). For UInt8/Int8 lists we use
// _u8 — that field IS cached. For UInt64/Int64 we cache lazily on first
// access via the cpp's _u64()/_i64() getters; for the list-view fast path,
// the BigInt typed arrays aren't on the parent reader, so we construct
// them inline (cheap; new TypedArray(buffer, byteOffset, count) is O(1)).
const PRIMITIVE_LIST_VIEWS = {
  "UInt8":   { ctor: "Uint8Array",     shift: 0, field: "_u8"  },
  "Int8":    { ctor: "Int8Array",      shift: 0, field: null   },
  "UInt16":  { ctor: "Uint16Array",    shift: 1, field: "_u16" },
  "Int16":   { ctor: "Int16Array",     shift: 1, field: "_i16" },
  "UInt32":  { ctor: "Uint32Array",    shift: 2, field: "_u32" },
  "Int32":   { ctor: "Int32Array",     shift: 2, field: "_i32" },
  "UInt64":  { ctor: "BigUint64Array", shift: 3, field: null   },
  "Int64":   { ctor: "BigInt64Array",  shift: 3, field: null   },
  "Float32": { ctor: "Float32Array",   shift: 2, field: "_f32" },
  "Float64": { ctor: "Float64Array",   shift: 3, field: "_f64" },
};

function generateGetter(field, declaredStructs) {
  // Void: no storage, just a marker. Return null so callers can compare
  // and `r.someVoidVariant === null` works in user code.
  if (field.type === "Void") {
    return [`return null;`];
  }
  // Group field: returns a typed sub-Reader sharing the parent's wire
  // storage. The sub-Reader's getters use absolute offsets within the
  // containing struct (capnp's group-layout rule), so reading
  // `parent.group.field` is the same wasm cost as `parent.field` would be.
  if (field.kind === "group") {
    return [`return new ${field.groupStructName}Reader(this._cpp, this._dataPtr, { msg: this._msg, gen: this._gen, rebind: this._rebind });`];
  }
  if (field.kind === "pointer") {
    if (field.type === "Text") {
      // M5: Pure-JS pointer decode. Slot-pool readers carry msgStart /
      // msgEnd from _acquireSlot; we use them to decode the Text
      // pointer directly from WebAssembly.Memory. Falls back to the
      // C++ path on undefined (FAR pointer, OTHER kind, out-of-bounds,
      // or unsafe-path readers without bounds info).
      //
      // Re-fetch the view via cpp._u8 in the fallback branch because
      // cpp_any_text_at may grow wasm memory while copying the text
      // into cpp_out, detaching the constructor-cached _u8.
      return [
        `const _msgEnd = this._msgEnd;`,
        `if (_msgEnd) {`,
        `  const v = _jsReadTextPtr(this._u8, this._dv, this._dataPtr, ${field.parentDataWords ?? 0}, ${field.ptrIndex}, this._msgStart, _msgEnd);`,
        `  if (v !== undefined) return v ?? "";`,
        `}`,
        `const len = this._exp.cpp_any_text_at(${field.ptrIndex});`,
        `if (len === 0) return "";`,
        `const u8 = this._cpp._u8;`,
        `const out = this._cpp._outPtr;`,
        `return decodeAscii(u8.subarray(out, out + len));`,
      ];
    }
    if (field.type === "Data") {
      return [
        `const _msgEnd = this._msgEnd;`,
        `if (_msgEnd) {`,
        `  const v = _jsReadDataPtr(this._u8, this._dv, this._dataPtr, ${field.parentDataWords ?? 0}, ${field.ptrIndex}, this._msgStart, _msgEnd);`,
        `  if (v !== undefined) return v ?? new Uint8Array(0);`,
        `}`,
        `const len = this._exp.cpp_any_data_at(${field.ptrIndex});`,
        `const u8 = this._cpp._u8;`,
        `const out = this._cpp._outPtr;`,
        `return u8.slice(out, out + len);`,
      ];
    }
    // Lists: return a typed list-view object. Value lists expose iteration
    // (and view() for primitive numeric lists); struct lists expose length and
    // use draft() for row projection.
    const listMatch = /^List\(([^)]+)\)$/.exec(field.type);
    if (listMatch) {
      const inner = listMatch[1];
      return generateListGetter(field.ptrIndex, inner, field.parentDataWords ?? 0);
    }
    // Plain struct pointer: declared elsewhere in this schema. JS decoder
    // resolves the pointer to the target struct's data section, builds a
    // typed sub-Reader. Falls back to the C++ cursor path for unsafe /
    // pre-M5 readers (no _msgEnd).
    if (declaredStructs && declaredStructs.has(field.type)) {
      const inner = field.type;
      const parentDw = field.parentDataWords ?? 0;
      return [
        `const reader = this;`,
        `const cpp = this._cpp;`,
        `const _msgStart = reader._msgStart, _msgEnd = reader._msgEnd;`,
        `// Rebind closure for cursor-only sub-readers: re-position the C++`,
        `// any_stack onto this nested struct before any boundary call. Used`,
        `// by paths the JS decoder doesn't cover (Bool list, unsafe readers).`,
        `const _rebindNested = () => {`,
        `  _ensureCapnwasmReader(reader);`,
        `  cpp._exports.cpp_any_slot_reset_root?.();`,
        `  cpp._exports.cpp_any_enter_struct(${field.ptrIndex});`,
        `  cpp._bumpGeneration();`,
        `};`,
        `if (_msgEnd) {`,
        `  const desc = _jsReadStructPtr(reader._u8, reader._dv, reader._dataPtr, ${parentDw}, ${field.ptrIndex}, _msgStart, _msgEnd);`,
        `  if (desc !== undefined) {`,
        `    const dp = desc === null ? 0 : desc.dataPtr;`,
        `    // gen=-1 forces _ensureCapnwasmReader to invoke the rebind on the`,
        `    // first cursor-using access, which positions the C++ any_stack`,
        `    // onto this nested struct. Pure-JS reads via _dataPtr never hit`,
        `    // that branch; only Bool list / unsafe paths need the cursor.`,
        `    return new ${inner}Reader(cpp, dp, {`,
        `      slotIdx: reader._slotIdx,`,
        `      msgStart: _msgStart,`,
        `      msgEnd: _msgEnd,`,
        `      gen: -1,`,
        `      parent: reader,`,
        `      rebind: _rebindNested,`,
        `    });`,
        `  }`,
        `}`,
        `// Cursor fallback: position the C++ cursor on the nested struct so`,
        `// subsequent getters read from the right level. Pass parent so`,
        `// the nested reader inherits _capTable for cap-typed fields.`,
        `_rebindNested();`,
        `return new ${inner}Reader(cpp, 0, {`,
        `  msg: reader._msg,`,
        `  slotIdx: reader._slotIdx,`,
        `  gen: cpp._generation ?? 0,`,
        `  parent: reader,`,
        `  rebind: _rebindNested,`,
        `});`,
      ];
    }
    if (field.type === "AnyPointer") {
      const parentDw = field.parentDataWords ?? 0;
      return [
        `const reader = this;`,
        `return new _AnyPointerReadHandle(reader, ${parentDw}, ${field.ptrIndex});`,
      ];
    }
    if (/^Capability\(/.test(field.type)) {
      // Capability-typed field. cpp_any_get_cap_index reads the wire
      // pointer at (dataPtr + parentDataWords*8 + ptrIdx*8) and returns
      // the cap-table index, or 0xffffffff if the slot isn't a
      // capability descriptor. Resolution goes through the parent
      // reader's _capTable, which RpcSession populated from the inbound
      // CapDescriptor[]. Non-RPC openers leave _capTable null, so the
      // field reads as null — matches upstream behavior for a Reader
      // not imbued with a cap table.
      const parentDw = field.parentDataWords ?? 0;
      return [
        `const _idx = this._exp.cpp_any_get_cap_index(this._dataPtr, ${parentDw}, ${field.ptrIndex});`,
        `if (_idx === 0xffffffff) return null;`,
        `return this._capTable ? (this._capTable[_idx] ?? null) : null;`,
      ];
    }
    return [`throw new Error("unsupported pointer type: ${field.type}");`];
  }
  // data-section field. With _dataPtr set, primitive reads go straight to
  // wasm memory. Saves one cpp_any_*_at boundary call per field access.
  // Fallback to wasm getter when _dataPtr is 0 (e.g., a sub-Reader inside
  // a struct opened via cpp_any_enter_struct that doesn't update dataPtr).
  const off = field.bitOffset >> 3;
  switch (field.type) {
    case "Bool": {
      const byte = field.bitOffset >> 3;
      const bit = field.bitOffset & 7;
      return [`return this._dataPtr ? ((this._u8[this._dataPtr + ${byte}] >> ${bit}) & 1) === 1 : this._exp.cpp_any_bool_at(${field.bitOffset}, 0) === 1;`];
    }
    case "UInt8":
      return [`return this._dataPtr ? this._u8[this._dataPtr + ${off}] : this._exp.cpp_any_uint8_at(${off}, 0);`];
    case "Int8":
      return [`return this._dataPtr ? ((this._u8[this._dataPtr + ${off}] << 24) >> 24) : ((this._exp.cpp_any_uint8_at(${off}, 0) << 24) >> 24);`];
    case "UInt16":
      return [`return this._dataPtr ? this._u16[(this._dataPtr + ${off}) >>> 1] : this._exp.cpp_any_uint16_at(${off}, 0);`];
    case "Int16":
      return [`return this._dataPtr ? this._i16[(this._dataPtr + ${off}) >>> 1] : ((this._exp.cpp_any_uint16_at(${off}, 0) << 16) >> 16);`];
    case "UInt32":
      return [`return this._dataPtr ? this._u32[(this._dataPtr + ${off}) >>> 2] : this._exp.cpp_any_uint32_at(${off}, 0);`];
    case "Int32":
      return [`return this._dataPtr ? this._i32[(this._dataPtr + ${off}) >>> 2] : (this._exp.cpp_any_uint32_at(${off}, 0) | 0);`];
    case "UInt64":
      // BigInt64Array is aligned-only too, but BigInt construction is the
      // dominant cost (V8 BigInt allocates per call). DataView is no worse
      // here and avoids one extra TypedArray view in the cache. Keep DV.
      return [`return this._dataPtr ? this._dv.getBigUint64(this._dataPtr + ${off}, true) : this._exp.cpp_any_int64_at(${off}, 0n);`];
    case "Int64":
      return [`return this._dataPtr ? this._dv.getBigInt64(this._dataPtr + ${off}, true) : this._exp.cpp_any_int64_at(${off}, 0n);`];
    case "Float32":
      return [`return this._dataPtr ? this._f32[(this._dataPtr + ${off}) >>> 2] : (function(){ _F32_VIEW_U32[0] = (this._exp.cpp_any_uint32_at(${off}, 0) >>> 0); return _F32_VIEW_F32[0]; }).call(this);`];
    case "Float64":
      return [`return this._dataPtr ? this._f64[(this._dataPtr + ${off}) >>> 3] : (function(){ _F64_VIEW_U32[0] = (this._exp.cpp_any_uint32_at(${off}, 0) >>> 0); _F64_VIEW_U32[1] = (this._exp.cpp_any_uint32_at(${off + 4}, 0) >>> 0); return _F64_VIEW_F64[0]; }).call(this);`];
    default:
      return [`throw new Error("unsupported field type: ${field.type}");`];
  }
}

/**
 * Emit the operation manifest as canonical JSON.
 *
 * Same input formats as `gen`. .capnp, .ts (with @rest), .yaml/.json
 * (OpenAPI). Output is one JSON document per source schema; the shape is
 * defined by `js/manifest.mjs` and stable across input formats so
 * downstream consumers (drift detectors, mock generators, doc
 * generators, MCP servers, contract test harnesses) only ever have to
 * implement one parser.
 *
 * Usage:
 *   npx capnwasm manifest user.capnp                  # → user.manifest.json
 *   npx capnwasm manifest stripe.json -o stripe.json
 *   npx capnwasm manifest user.capnp -o -             # stdout
 */
async function cmdManifest(argv) {
  // Special form: `npx capnwasm manifest --schema` prints the JSON
  // Schema describing the manifest IR shape. Useful for non-JS consumers
  // (Rust dashboards, Python CI gates, Go ops tools) who want to
  // validate manifests without depending on the capnwasm runtime.
  if (argv.includes("--schema")) {
    const schemaPath = resolve(PKG_ROOT, "schemas", "manifest.schema.json");
    const text = await import("node:fs/promises").then((m) => m.readFile(schemaPath, "utf8"));
    process.stdout.write(text);
    return;
  }

  const args = parseGenArgs(argv);
  // parseGenArgs assumes a .gen.mjs default output path; manifest defaults
  // to .manifest.json next to the source instead.
  const stem = basename(args.schema, extname(args.schema));
  if (!argv.includes("-o") && !argv.includes("--output")) {
    args.output = resolve(dirname(args.schema), `${stem}.manifest.json`);
  }

  const ext = extname(args.schema).toLowerCase();
  const isOpenapi = ext === ".yaml" || ext === ".yml" || ext === ".json";

  let model, format;
  if (isOpenapi) {
    const text = await import("node:fs/promises").then((m) => m.readFile(args.schema, "utf8"));
    let spec;
    if (ext === ".json") {
      spec = JSON.parse(text);
    } else {
      try {
        const yaml = await import("yaml");
        spec = yaml.parse(text);
      } catch {
        console.error("To parse YAML OpenAPI specs install the optional 'yaml' package:");
        console.error("  npm install yaml");
        process.exit(1);
      }
    }
    const { parseOpenApi } = await import("../js/openapi_parser.mjs");
    model = parseOpenApi(spec);
    format = "openapi";
  } else if (args.schema.endsWith(".ts") || args.schema.endsWith(".tsx")) {
    model = await parseSchema(args.schema);
    format = "typescript-rest";
  } else {
    model = await parseSchema(args.schema);
    format = "capnp";
  }

  const { buildManifestJson } = await import("../js/manifest.mjs");
  const json = buildManifestJson(model, {
    source: {
      name: basename(args.schema),
      format,
      path: resolve(args.schema),
    },
  });

  if (args.output === "-") {
    process.stdout.write(json);
  } else {
    await writeFile(args.output, json);
    console.log(`Wrote ${args.output}`);
  }

  // Brief summary on stderr so '> file' redirection still gives feedback.
  const counts = {
    structs:    model.structs?.length ?? 0,
    interfaces: model.interfaces?.length ?? 0,
    restApis:   model.restApis?.length ?? 0,
  };
  const opCount = (model.interfaces ?? []).reduce((n, i) => n + (i.methods?.length ?? 0), 0)
                + (model.restApis   ?? []).reduce((n, a) => n + (a.methods?.length ?? 0), 0);
  console.error(`  ${counts.structs} struct(s), ${counts.interfaces} interface(s), ${counts.restApis} REST API(s), ${opCount} operation(s)`);
}

/**
 * Emit a Node --test contract harness from a manifest file.
 *
 * Usage:
 *   npx capnwasm harness <manifest.json> --gen <gen-import> [-o out.test.mjs|-]
 *
 * Required:
 *   <manifest.json>     A manifest produced by `npx capnwasm manifest`.
 *   --gen <import>      Import specifier for the generated codegen
 *                       module (e.g. "./user.gen.mjs"). Must export the
 *                       per-struct {Name}Builder/{Name}Reader and the
 *                       per-API create{Name}Client factory.
 *
 * Optional:
 *   -o <path|->         Output file. Default: <manifest-stem>.contract.test.mjs
 *                       next to the manifest. Use "-" for stdout.
 *   --runtime <import>  Import specifier for the capnwasm runtime.
 *                       Defaults to "capnwasm" (works for npm consumers).
 */
async function cmdHarness(argv) {
  // Replay mode: re-run a single failed-call snapshot.
  if (argv[0] === "--replay") {
    const snapPath = argv[1];
    if (!snapPath) {
      console.error("usage: npx capnwasm harness --replay <snapshot.json>");
      process.exit(1);
    }
    if (!existsSync(snapPath)) {
      console.error(`snapshot not found: ${snapPath}`);
      process.exit(1);
    }
    const { replay } = await import("../js/harness_snapshot.mjs");
    const result = await replay(snapPath);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.diff?.changed ? 0 : 1;
    return;
  }

  let manifestPath = null;
  let output = null;
  let genImport = null;
  let runtimeImport = null;
  let rpcImport = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (a === "--gen") genImport = argv[++i];
    else if (a === "--runtime") runtimeImport = argv[++i];
    else if (a === "--rpc-runtime") rpcImport = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath || !genImport) {
    console.error("usage: npx capnwasm harness <manifest.json> --gen <gen-import> [-o out.test.mjs|-] [--runtime <import>] [--rpc-runtime <import>]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  if (output === null) {
    const stem = basename(manifestPath, extname(manifestPath))
      .replace(/\.manifest$/, "");
    output = resolve(dirname(manifestPath), `${stem}.contract.test.mjs`);
  }

  const text = await import("node:fs/promises").then((m) => m.readFile(manifestPath, "utf8"));
  const manifest = JSON.parse(text);
  const { buildHarness } = await import("../js/harness.mjs");
  const src = buildHarness(manifest, {
    genImport,
    ...(runtimeImport ? { runtimeImport } : {}),
    ...(rpcImport     ? { rpcImport }     : {}),
  });

  if (output === "-") {
    process.stdout.write(src);
  } else {
    await writeFile(output, src);
    console.log(`Wrote ${output}`);
  }

  const ifaceCount = (manifest.interfaces ?? []).length;
  const restCount  = (manifest.restApis  ?? []).length;
  const opCount = (manifest.interfaces ?? []).reduce((n, i) => n + (i.methods?.length ?? 0), 0)
                + (manifest.restApis   ?? []).reduce((n, a) => n + (a.methods?.length ?? 0), 0);
  console.error(`  ${ifaceCount} capnp interface(s), ${restCount} REST API(s), ${opCount} operation(s) covered`);
}

/**
 * Probe a live target against a manifest, report drift.
 *
 * Usage:
 *   npx capnwasm probe <manifest.json>
 *       [--target <ws://...>]            (capnp interfaces)
 *       [--rest-target <https://...>]    (REST APIs)
 *       [-o report.json|-]               (default: stdout)
 *       [--timeout <ms>]                 (per-operation; default 10000)
 */
async function cmdProbe(argv) {
  let manifestPath = null;
  let capnpTarget = null;
  let restTarget = null;
  let output = "-";
  let timeoutMs = 10000;
  let maxRetries = 3;
  let env = null;
  let configFile = null;
  let authCli = { type: null, token: null, in: null, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (a === "--target") capnpTarget = argv[++i];
    else if (a === "--rest-target") restTarget = argv[++i];
    else if (a === "--timeout") timeoutMs = parseInt(argv[++i], 10);
    else if (a === "--max-retries") maxRetries = parseInt(argv[++i], 10);
    else if (a === "--env") env = argv[++i];
    else if (a === "--config") configFile = argv[++i];
    else if (a === "--auth") authCli.type = argv[++i];
    else if (a === "--auth-token") authCli.token = argv[++i];
    else if (a === "--auth-in") authCli.in = argv[++i];
    else if (a === "--auth-name") authCli.name = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm probe <manifest.json|dir/> [--target <ws://...>] [--rest-target <https://...>] [-o report.json|-]");
    console.error("        [--timeout <ms>] [--max-retries <N>] [--env <name>] [--config <path>]");
    console.error("        [--auth bearer|apikey|basic|none] [--auth-token <secret>] [--auth-in header|query|cookie] [--auth-name <header-name>]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  // Multi-input mode: when given a directory, probe every *.manifest.json
  // inside it and write per-API reports + a summary.
  const stat = await import("node:fs/promises").then((m) => m.stat(manifestPath));
  if (stat.isDirectory()) {
    return cmdProbeDir(manifestPath, {
      capnpTarget, restTarget, output, timeoutMs, maxRetries, env, configFile, authCli,
    });
  }

  const text = await import("node:fs/promises").then((m) => m.readFile(manifestPath, "utf8"));
  const manifest = JSON.parse(text);

  if (env) {
    if (!restTarget) restTarget = process.env[`CAPNWASM_PROBE_${env.toUpperCase()}_REST_TARGET`] ?? null;
    if (!capnpTarget) capnpTarget = process.env[`CAPNWASM_PROBE_${env.toUpperCase()}_TARGET`] ?? null;
    process.env.CAPNWASM_PROBE_ENV = env;
  }
  let cfgFileObj = null;
  if (configFile) {
    if (!existsSync(configFile)) { console.error(`config not found: ${configFile}`); process.exit(1); }
    cfgFileObj = JSON.parse(await import("node:fs/promises").then((m) => m.readFile(configFile, "utf8")));
  }

  const { load } = await import("../dist/inlined.mjs");
  const cpp = await load();
  const probeMod = await import("../js/probe.mjs");
  const auth = probeMod.resolveAuth({ cli: authCli.type ? authCli : null, configFile: cfgFileObj });
  const report = await probeMod.probe(cpp, manifest, {
    capnpTarget,
    restTarget,
    timeoutMs,
    maxRetries,
    auth,
  });

  const json = JSON.stringify(report, null, 2) + "\n";
  if (output === "-") {
    process.stdout.write(json);
  } else {
    await writeFile(output, json);
    console.log(`Wrote ${output}`);
  }

  // Summary on stderr so the JSON on stdout is consumable by tools.
  const s = report.summary;
  console.error(`  ${s.total} operation(s): ${s.ok} ok, ${s.error} error, ${s.drift} with drift`);
  // Non-zero exit on drift so CI can gate on it.
  if (s.drift > 0) process.exitCode = 2;
}

/**
 * Multi-input probe: take a directory of *.manifest.json files,
 * probe each one, and write per-API reports plus an aggregate summary.
 */
async function cmdProbeDir(dir, opts) {
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(dir);
  const manifests = entries.filter((e) => e.endsWith(".manifest.json")).map((e) => resolve(dir, e));
  if (manifests.length === 0) {
    console.error(`probe: no *.manifest.json files in ${dir}`);
    process.exit(1);
  }
  const outDir = (opts.output && opts.output !== "-")
    ? opts.output
    : resolve(dir, "probe-reports");
  await fs.mkdir(outDir, { recursive: true });

  const probeMod = await import("../js/probe.mjs");
  const { load } = await import("../dist/inlined.mjs");
  const cpp = await load();

  let cfgFileObj = null;
  if (opts.configFile) cfgFileObj = JSON.parse(await fs.readFile(opts.configFile, "utf8"));
  if (opts.env) process.env.CAPNWASM_PROBE_ENV = opts.env;
  const auth = probeMod.resolveAuth({ cli: opts.authCli?.type ? opts.authCli : null, configFile: cfgFileObj });

  const summaries = [];
  let totalDrift = 0;
  for (const path of manifests) {
    const text = await fs.readFile(path, "utf8");
    const m = JSON.parse(text);
    const report = await probeMod.probe(cpp, m, {
      capnpTarget: opts.capnpTarget,
      restTarget: opts.restTarget,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      auth,
    });
    const reportPath = resolve(outDir, basename(path).replace(/\.manifest\.json$/, ".report.json"));
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    summaries.push({ manifest: basename(path), summary: report.summary });
    totalDrift += report.summary.drift;
  }

  const aggregatePath = resolve(outDir, "summary.json");
  await writeFile(aggregatePath, JSON.stringify({
    probedAt: new Date().toISOString(),
    capnpTarget: opts.capnpTarget,
    restTarget: opts.restTarget,
    perManifest: summaries,
    aggregate: summaries.reduce((acc, s) => {
      acc.total += s.summary.total;
      acc.ok += s.summary.ok;
      acc.error += s.summary.error;
      acc.drift += s.summary.drift;
      return acc;
    }, { total: 0, ok: 0, error: 0, drift: 0 }),
  }, null, 2) + "\n");

  console.error(`Wrote ${manifests.length} report(s) + summary to ${outDir}`);
  for (const { manifest, summary } of summaries) {
    console.error(`  ${manifest}: ${summary.total} ops, ${summary.drift} drift`);
  }
  if (totalDrift > 0) process.exitCode = 2;
}

/** Compare two manifests and report compatibility. */
async function cmdCompat(argv) {
  let oldPath = null;
  let newPath = null;
  let output = "-";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (!oldPath) oldPath = a;
    else if (!newPath) newPath = a;
  }
  if (!oldPath || !newPath) {
    console.error("usage: npx capnwasm compat <old.manifest.json> <new.manifest.json> [-o report.json|-]");
    process.exit(1);
  }
  if (!existsSync(oldPath)) { console.error(`manifest not found: ${oldPath}`); process.exit(1); }
  if (!existsSync(newPath)) { console.error(`manifest not found: ${newPath}`); process.exit(1); }

  const fs = await import("node:fs/promises");
  const previous = JSON.parse(await fs.readFile(oldPath, "utf8"));
  const next = JSON.parse(await fs.readFile(newPath, "utf8"));
  const { diffManifests } = await import("../js/compat.mjs");
  const report = diffManifests(previous, next);
  const json = JSON.stringify(report, null, 2) + "\n";
  if (output === "-") process.stdout.write(json);
  else { await writeFile(output, json); console.log(`Wrote ${output}`); }

  const s = report.summary;
  console.error(`compat: ${s.total} change(s): ${s.breaking} breaking, ${s.nonBreaking} non-breaking`);
  console.error(`  previous ${report.previousFingerprint.slice(0, 12)}  next ${report.nextFingerprint.slice(0, 12)}`);
  if (s.breaking > 0) process.exitCode = 2;
}

// ===== New CLI subcommands re-applied after history rewrite =====

/** Emit canonical OpenAPI 3.x from a manifest. */
async function cmdEmitOpenapi(argv) {
  let manifestPath = null;
  let output = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm emit-openapi <manifest.json> [-o spec.json|-]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) { console.error(`manifest not found: ${manifestPath}`); process.exit(1); }
  if (!output) {
    const stem = basename(manifestPath, extname(manifestPath)).replace(/\.manifest$/, "");
    output = resolve(dirname(manifestPath), `${stem}.openapi.json`);
  }
  const text = await import("node:fs/promises").then((m) => m.readFile(manifestPath, "utf8"));
  const manifest = JSON.parse(text);
  const { buildOpenApiJson } = await import("../js/emit_openapi.mjs");
  const json = buildOpenApiJson(manifest);
  if (output === "-") process.stdout.write(json);
  else { await writeFile(output, json); console.log(`Wrote ${output}`); }
}

/** Emit canonical .capnp from a manifest. */
async function cmdEmitCapnp(argv) {
  let manifestPath = null;
  let output = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm emit-capnp <manifest.json> [-o schema.capnp|-]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) { console.error(`manifest not found: ${manifestPath}`); process.exit(1); }
  if (!output) {
    const stem = basename(manifestPath, extname(manifestPath)).replace(/\.manifest$/, "");
    output = resolve(dirname(manifestPath), `${stem}.capnp`);
  }
  const text = await import("node:fs/promises").then((m) => m.readFile(manifestPath, "utf8"));
  const manifest = JSON.parse(text);
  const { buildCapnp } = await import("../js/emit_capnp.mjs");
  const result = buildCapnp(manifest);
  if (output === "-") process.stdout.write(result.text);
  else { await writeFile(output, result.text); console.log(`Wrote ${output}`); }
  const s = result.summary;
  console.error(`  ${s.structs} struct(s), ${s.enums} enum(s), ${s.interfaces} interface(s), ${s.methods} method(s)`);
  if (s.dropped.length > 0) console.error(`  ${s.dropped.length} schema(s) dropped (see report)`);
}

/** Emit AGENTS.md / skill.md / llms.txt from a manifest. */
async function cmdEmitAgents(argv) {
  let manifestPath = null;
  let outDir = null;
  let format = "all";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out-dir") outDir = argv[++i];
    else if (a === "--format") format = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm emit-agents <manifest.json> [--out-dir <dir>] [--format agents|skill|llms|all]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) { console.error(`manifest not found: ${manifestPath}`); process.exit(1); }
  if (!outDir) outDir = dirname(manifestPath);
  const fs = await import("node:fs/promises");
  await fs.mkdir(outDir, { recursive: true });
  const text = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(text);
  const mod = await import("../js/emit_agents.mjs");
  const want = (k) => format === "all" || format === k;
  const wrote = [];
  if (want("agents")) { const p = resolve(outDir, "AGENTS.md"); await writeFile(p, mod.buildAgentsMd(manifest)); wrote.push(p); }
  if (want("skill"))  { const p = resolve(outDir, "skill.md");  await writeFile(p, mod.buildSkillMd(manifest));  wrote.push(p); }
  if (want("llms"))   { const p = resolve(outDir, "llms.txt");  await writeFile(p, mod.buildLlmsTxt(manifest));  wrote.push(p); }
  for (const p of wrote) console.log(`Wrote ${p}`);
}

/** Emit JSON ↔ capnp wire-bytes codec from a manifest. */
async function cmdEmitCodec(argv) {
  let manifestPath = null;
  let output = null;
  let runtimeImport = null;
  let dynamicImport = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (a === "--runtime") runtimeImport = argv[++i];
    else if (a === "--dynamic") dynamicImport = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm emit-codec <manifest.json> [-o codec.mjs|-] [--runtime <import>] [--dynamic <import>]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) { console.error(`manifest not found: ${manifestPath}`); process.exit(1); }
  if (!output) {
    const stem = basename(manifestPath, extname(manifestPath)).replace(/\.manifest$/, "");
    output = resolve(dirname(manifestPath), `${stem}.codec.mjs`);
  }
  const fs = await import("node:fs/promises");
  const text = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(text);
  let structs = manifest.structs ?? [];
  if (!structs.some((s) => typeof s.dataWords === "number")) {
    const { buildCapnp } = await import("../js/emit_capnp.mjs");
    const { text: capnpText } = buildCapnp(manifest);
    try {
      structs = await compileCapnpForCodec(capnpText);
    } catch (err) {
      if (String(err?.message ?? err).includes("scratch")) {
        console.error("emit-codec: the materialized .capnp text is too large for the bundled wasm capnp compiler.");
        console.error("Two-step path for very large specs:");
        console.error("  1. npx capnwasm emit-capnp <manifest> -o schema.capnp");
        console.error("  2. capnp compile schema.capnp -o<your-language>");
        process.exit(1);
      }
      throw err;
    }
  }
  const opts = { structs };
  if (runtimeImport) opts.runtimeImport = runtimeImport;
  if (dynamicImport) opts.dynamicImport = dynamicImport;
  const { buildCodec } = await import("../js/emit_codec.mjs");
  const result = buildCodec(manifest, opts);
  if (output === "-") process.stdout.write(result.text);
  else { await writeFile(output, result.text); console.log(`Wrote ${output}`); }
  console.error(`  ${result.summary.emitted.length} codec(s) emitted, ${result.summary.skipped.length} skipped`);
  for (const s of result.summary.skipped) console.error(`    skipped ${s.name}: ${s.reason}`);
}

/** Detect pagination + error envelopes; enrich the manifest. */
async function cmdAdapt(argv) {
  let manifestPath = null;
  let output = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm adapt <manifest.json> [-o out.json|-]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) { console.error(`manifest not found: ${manifestPath}`); process.exit(1); }
  if (!output) {
    const stem = basename(manifestPath, extname(manifestPath)).replace(/\.manifest$/, "");
    output = resolve(dirname(manifestPath), `${stem}.adapted.json`);
  }
  const text = await import("node:fs/promises").then((m) => m.readFile(manifestPath, "utf8"));
  const manifest = JSON.parse(text);
  const { adapt, summarize } = await import("../js/adapter.mjs");
  const enriched = adapt(manifest);
  const json = JSON.stringify(enriched, null, 2) + "\n";
  if (output === "-") process.stdout.write(json);
  else { await writeFile(output, json); console.log(`Wrote ${output}`); }
  const s = summarize(enriched);
  console.error(`  ${s.total} operation(s)`);
  console.error(`  pagination: cursor=${s.pagination.cursor} offset=${s.pagination.offset} page=${s.pagination.page} page-token=${s.pagination["page-token"]} unknown=${s.pagination.unknown}`);
  console.error(`  errors: rfc7807=${s.errors.rfc7807} single=${s.errors.single} list=${s.errors.list} passthrough=${s.errors.passthrough}`);
}

/** Manage the field-ID / op-ID lock file. */
async function cmdLock(argv) {
  let manifestPath = null;
  let inPath = null;
  let output = null;
  let detectRenames = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (a === "--in") inPath = argv[++i];
    else if (a === "--detect-renames") detectRenames = true;
    else if (!manifestPath) manifestPath = a;
  }
  if (!manifestPath) {
    console.error("usage: npx capnwasm lock <manifest.json> [--in <existing-lock>] [-o capnwasm.lock|-] [--detect-renames]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) { console.error(`manifest not found: ${manifestPath}`); process.exit(1); }
  if (!output) output = resolve(dirname(manifestPath), "capnwasm.lock");
  const fs = await import("node:fs/promises");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  let prev = null;
  if (inPath) {
    if (!existsSync(inPath)) { console.error(`lock not found: ${inPath}`); process.exit(1); }
    prev = JSON.parse(await fs.readFile(inPath, "utf8"));
  }
  const { buildCapnp } = await import("../js/emit_capnp.mjs");
  const { structures } = buildCapnp(manifest);
  const lockMod = await import("../js/lock.mjs");
  const { lock, diff } = lockMod.updateLock(prev, structures, {
    manifestSource: manifest.source?.name,
    detectRenames,
  });
  const json = lockMod.lockToJson(lock);
  if (output === "-") process.stdout.write(json);
  else { await writeFile(output, json); console.log(`Wrote ${output}`); }
  console.error(`  ${diff.unchanged} pinned, ${diff.added.length} added, ${diff.removed.length} removed (tombstoned), ${diff.renamed.length} renamed`);
}

/** Run the full schema-truth pipeline in one pass. */
async function cmdPipeline(argv) {
  let input = null;
  let outputDir = null;
  let lockIn = null;
  let configPath = null;
  const stepsOverride = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") configPath = argv[++i];
    else if (a === "--out-dir" || a === "--output-dir") outputDir = argv[++i];
    else if (a === "--lock-in") lockIn = argv[++i];
    else if (a.startsWith("--no-")) stepsOverride[kebabToCamel(a.slice("--no-".length))] = false;
    else if (a.startsWith("--with-")) stepsOverride[kebabToCamel(a.slice("--with-".length))] = true;
    else if (!input) input = a;
  }
  if (!configPath && !input) {
    const candidate = resolve(process.cwd(), "capnwasm.config.json");
    if (existsSync(candidate)) configPath = candidate;
  }
  const { runPipeline, loadConfig } = await import("../js/run_pipeline.mjs");
  const cfg = await loadConfig({
    configPath,
    cli: { input, outputDir, lockIn, steps: stepsOverride },
  });
  if (!cfg.input) {
    console.error("usage: npx capnwasm pipeline <input> [--config capnwasm.config.json] [--out-dir <dir>] [--lock-in <lock>] [--no-<step>] [--with-<step>]");
    console.error("       <input> may be a .capnp, .ts (with @rest), or OpenAPI .json/.yaml");
    process.exit(1);
  }
  const report = await runPipeline(cfg);
  console.error(`Pipeline finished. ${report.artifacts.length} artifact(s) in ${report.outputDir}`);
}

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

async function cmdGen(argv) {
  const args = parseGenArgs(argv);
  const { structs, interfaces, restApis, typeInterfaces } = await parseSchema(args.schema);
  if (structs.length === 0 && restApis.length === 0 && (!interfaces || interfaces.length === 0)) {
    console.error("No struct, interface, or REST interface definitions found in schema.");
    process.exit(1);
  }

  // Emit a single .mjs that contains both capnp-wire bindings and any
  // REST clients defined via @rest interfaces.
  const jsParts = [];
  if (structs.length > 0) jsParts.push(generateJs(structs, basename(args.schema)));
  if (interfaces && interfaces.length > 0) jsParts.push(generateInterfaceMeta(interfaces, structs));
  for (const api of restApis) jsParts.push(generateRestClient(api, basename(args.schema), structs));
  await writeFile(args.output, jsParts.join("\n\n"));
  console.log(`Wrote ${args.output}`);

  const dtsParts = [];
  if (structs.length > 0) dtsParts.push(generateDts(structs, basename(args.schema)));
  if (interfaces && interfaces.length > 0) dtsParts.push(generateInterfaceDts(interfaces, structs));
  for (const api of restApis) dtsParts.push(generateRestDts(api, basename(args.schema), structs, typeInterfaces));
  const dtsPath = args.output.replace(/\.mjs$/, ".d.ts");
  await writeFile(dtsPath, dtsParts.join("\n\n"));
  console.log(`Wrote ${dtsPath}`);

  if (structs.length > 0) {
    console.log(`  ${structs.length} struct(s):`);
    for (const s of structs) console.log(`    ${s.name}  (${s.fields.length} fields)`);
  }
  if (restApis.length > 0) {
    console.log(`  ${restApis.length} REST API(s):`);
    for (const a of restApis) console.log(`    ${a.name}  (${a.methods.length} methods)`);
  }
  if (typeInterfaces && typeInterfaces.length > 0) {
    console.log(`  ${typeInterfaces.length} type interface(s):`);
    for (const t of typeInterfaces) console.log(`    ${t.name}`);
  }
}

/** Emit the .mjs for a REST API: a `create<Name>Client(opts)` factory. */
function generateRestClient(api, schemaName, structs) {
  const lines = [];
  lines.push(`// Generated from ${schemaName} by capnwasm-gen. Do not edit by hand.`);
  lines.push(`// REST client for "${api.name}".`);
  lines.push(``);
  lines.push(`import { _restCall, _restPaginate, _buildRestCfg } from "capnwasm/rest";`);
  lines.push(`export { auth, RestError } from "capnwasm/rest";`);
  lines.push(``);
  // The defaults captured from interface-level directives.
  const defaults = {
    baseUrl: api.baseUrl,
    ...api.defaults,
  };
  lines.push(`const _DEFAULTS = ${JSON.stringify(defaults, null, 2)};`);
  lines.push(``);
  lines.push(`export function create${api.name}Client(opts = {}) {`);
  lines.push(`  const cfg = _buildRestCfg(_DEFAULTS, opts);`);
  lines.push(`  return {`);
  for (const m of api.methods) {
    lines.push(...generateRestMethod(m).map(l => "    " + l));
  }
  lines.push(`  };`);
  lines.push(`}`);
  return lines.join("\n");
}

/** Emit the per-method dispatch entry on the client. */
function generateRestMethod(m) {
  const lines = [];
  const paramList = m.params.map(p => p.name).concat(["callOpts"]).join(", ");
  lines.push(`${m.name}(${paramList}) {`);

  // Build the request descriptor inline.
  lines.push(`  const _req = {`);
  lines.push(`    method: ${JSON.stringify(m.method)},`);
  lines.push(`    path: ${JSON.stringify(m.path)},`);

  // Path params: gather into an object keyed by param name.
  const pathParams = m.params.filter(p => p.role === "path");
  if (pathParams.length > 0) {
    const obj = pathParams.map(p => `${JSON.stringify(p.name)}: ${p.name}`).join(", ");
    lines.push(`    pathParams: { ${obj} },`);
  }

  // Query params: include each if not undefined.
  const queryParams = m.params.filter(p => p.role === "query");
  if (queryParams.length > 0) {
    const entries = queryParams.map(p => `${JSON.stringify(p.name)}: ${p.name}`).join(", ");
    lines.push(`    query: { ${entries} },`);
  }

  // Header params. Use wire header name (may differ from JS identifier).
  const headerParams = m.params.filter(p => p.role === "header");
  if (headerParams.length > 0) {
    const entries = headerParams
      .map(p => `${JSON.stringify((p.wireName ?? p.name).toLowerCase())}: ${p.name}`)
      .join(", ");
    lines.push(`    headers: { ${entries} },`);
  }

  // Body param (at most one).
  const bodyParam = m.params.find(p => p.role === "body");
  if (bodyParam) {
    lines.push(`    body: ${bodyParam.name},`);
  }

  if (m.bodyEncoding) lines.push(`    bodyEncoding: ${JSON.stringify(m.bodyEncoding)},`);
  if (m.decode)        lines.push(`    decode: ${JSON.stringify(m.decode)},`);

  lines.push(`  };`);

  if (m.paginated) {
    lines.push(`  return _restPaginate(cfg, _req, callOpts, ${JSON.stringify(m.paginated)});`);
  } else {
    lines.push(`  return _restCall(cfg, _req, callOpts);`);
  }
  lines.push(`},`);
  return lines;
}

/** Emit a .d.ts for the REST client matching the source TS interface. */
function generateRestDts(api, schemaName, structs, typeInterfaces = []) {
  const lines = [];
  lines.push(`// Generated from ${schemaName} by capnwasm-gen. Do not edit by hand.`);
  lines.push(`// REST client types for "${api.name}".`);
  lines.push(``);
  lines.push(`import type { RestClientOpts, RestCallOpts, RestError } from "capnwasm/rest";`);
  lines.push(`export { auth, RestError } from "capnwasm/rest";`);
  lines.push(``);
  // Re-emit any data-type interfaces declared in the same file. Two sources:
  //   1. capnp-style structs (parsed strictly into our struct model)
  //   2. pure TS type interfaces captured verbatim (when @rest is present
  //      in the file, non-REST interfaces use full TS syntax)
  const declared = new Set(structs.map(s => s.name));
  for (const s of structs) {
    lines.push(`export interface ${s.name} {`);
    for (const f of s.fields) {
      lines.push(`  ${f.name}: ${capnpToTs(f.type, declared)};`);
    }
    lines.push(`}`);
    lines.push(``);
  }
  for (const t of typeInterfaces) {
    lines.push(`export interface ${t.name} {`);
    for (const line of t.body) {
      // re-emit line as-is, with any leading whitespace stripped to a single
      // 2-space indent for consistency.
      const trimmed = line.replace(/^\s+/, "");
      if (trimmed) lines.push(`  ${trimmed}`);
    }
    lines.push(`}`);
    lines.push(``);
  }
  // Client interface.
  lines.push(`export interface ${api.name}Client {`);
  for (const m of api.methods) {
    const params = m.params
      .map(p => `${p.name}${p.optional ? "?" : ""}: ${p.type}`)
      .concat([`callOpts?: RestCallOpts`])
      .join(", ");
    const ret = m.isAsyncIterable
      ? `AsyncIterable<${m.returnType}>`
      : `Promise<${m.returnType}>`;
    lines.push(`  ${m.name}(${params}): ${ret};`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function create${api.name}Client(opts?: RestClientOpts): ${api.name}Client;`);
  return lines.join("\n");
}

function cmdBuild(extra = []) {
  const buildScript = join(PKG_ROOT, "cpp", "build.sh");
  if (!existsSync(buildScript)) {
    console.error(`cpp/build.sh missing at ${buildScript}`);
    process.exit(1);
  }
  const r = spawnSync("bash", [buildScript, ...extra], { stdio: "inherit", cwd: PKG_ROOT });
  process.exit(r.status ?? 1);
}

function cmdBench() {
  // Bench needs the bench-only wasm helpers (cpp_make_big_user_bytes etc.)
  // so trigger a bench-mode rebuild before running.
  const buildScript = join(PKG_ROOT, "cpp", "build.sh");
  const big = join(PKG_ROOT, "bench", "big_runner.mjs");
  const small = join(PKG_ROOT, "bench", "runner.mjs");

  console.log("[capnwasm] rebuilding wasm in bench mode (CW_BENCH=1) ...");
  let r = spawnSync("bash", [buildScript, "bench"], { stdio: "inherit", cwd: PKG_ROOT });
  if (r.status !== 0) process.exit(r.status ?? 1);

  if (existsSync(big)) {
    console.log("[capnwasm] running big bench ...");
    r = spawnSync("node", [big], { stdio: "inherit", cwd: PKG_ROOT });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  if (existsSync(small)) {
    console.log("[capnwasm] running small bench ...");
    r = spawnSync("node", [small], { stdio: "inherit", cwd: PKG_ROOT });
  }
  process.exit(r.status ?? 1);
}

async function cmdOpenapi(argv) {
  const args = parseGenArgs(argv);
  const text = await import("node:fs/promises").then(m => m.readFile(args.schema, "utf8"));
  let spec;
  if (args.schema.endsWith(".json")) {
    spec = JSON.parse(text);
  } else {
    // YAML. Try the optional `yaml` package. If unavailable, give the
    // user a clear install command. Most published OpenAPI specs are also
    // available as JSON (Stripe, GitHub, etc.).
    try {
      const yaml = await import("yaml");
      spec = yaml.parse(text);
    } catch {
      console.error(`To parse YAML OpenAPI specs install the optional 'yaml' package:`);
      console.error(`  npm install yaml`);
      console.error(`Or convert your spec to JSON first.`);
      process.exit(1);
    }
  }

  const { parseOpenApi } = await import("../js/openapi_parser.mjs");
  const { restApis, typeInterfaces, structs } = parseOpenApi(spec);

  const jsParts = [];
  for (const api of restApis) jsParts.push(generateRestClient(api, basename(args.schema), structs));
  await writeFile(args.output, jsParts.join("\n\n"));
  console.log(`Wrote ${args.output}`);

  const dtsParts = [];
  for (const api of restApis) dtsParts.push(generateRestDts(api, basename(args.schema), structs, typeInterfaces));
  const dtsPath = args.output.replace(/\.mjs$/, ".d.ts");
  await writeFile(dtsPath, dtsParts.join("\n\n"));
  console.log(`Wrote ${dtsPath}`);

  console.log(`  ${restApis.length} REST API(s):`);
  for (const a of restApis) console.log(`    ${a.name}  (${a.methods.length} methods)`);
  if (typeInterfaces.length > 0) console.log(`  ${typeInterfaces.length} type interface(s)`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) topUsage();

  const cmd = argv[0];
  switch (cmd) {
    case "gen":      await cmdGen(argv.slice(1)); return;
    case "openapi":  await cmdOpenapi(argv.slice(1)); return;
    case "manifest": await cmdManifest(argv.slice(1)); return;
    case "harness":  await cmdHarness(argv.slice(1)); return;
    case "probe":    await cmdProbe(argv.slice(1)); return;
    case "compat":
    case "diff":     await cmdCompat(argv.slice(1)); return;
    case "emit-openapi": await cmdEmitOpenapi(argv.slice(1)); return;
    case "emit-capnp":   await cmdEmitCapnp(argv.slice(1)); return;
    case "emit-agents":  await cmdEmitAgents(argv.slice(1)); return;
    case "emit-codec":   await cmdEmitCodec(argv.slice(1)); return;
    case "adapt":        await cmdAdapt(argv.slice(1)); return;
    case "lock":         await cmdLock(argv.slice(1)); return;
    case "pipeline":     await cmdPipeline(argv.slice(1)); return;
    case "build":    cmdBuild(); return;
    case "bench":    cmdBench(); return;
    case "-h": case "--help": case "help": topUsage(); return;
  }
  // Shorthand: `npx capnwasm path/to/schema.capnp` runs the generator.
  if (cmd.endsWith(".capnp") && existsSync(cmd)) {
    await cmdGen(argv);
    return;
  }
  // Shorthand: `npx capnwasm path/to/spec.yaml` runs openapi.
  if ((cmd.endsWith(".yaml") || cmd.endsWith(".yml") || cmd.endsWith(".json")) && existsSync(cmd)) {
    await cmdOpenapi(argv);
    return;
  }
  console.error(`unknown command: ${cmd}`);
  topUsage();
}

// --------------------------------------------------------------------------
// Programmatic API. For the Vite plugin and any other tool that wants to
// drive codegen without shelling out.
//
// generateFromSchema(path) → { mjs, dts, meta }
//
//   path: absolute or cwd-relative path to a .capnp, .ts, .yaml, or .json
//   schema. The format is auto-detected from the extension.
//   mjs:  the JS module text. Write to disk or feed straight to a bundler.
//   dts:  the corresponding TypeScript declarations.
//   meta: { schemaName, structs, restApis, typeInterfaces }. Useful for
//         logging or display in a build dashboard.
//
// Errors are thrown as `CapnwasmCodegenError` so callers (e.g. Vite's HMR
// path) can format them in a dev-server overlay without sniffing strings.
// --------------------------------------------------------------------------

export class CapnwasmCodegenError extends Error {
  constructor(message, { schemaPath, cause } = {}) {
    super(message);
    this.name = "CapnwasmCodegenError";
    this.schemaPath = schemaPath;
    if (cause) this.cause = cause;
  }
}

export async function generateFromSchema(schemaPath) {
  if (!schemaPath) {
    throw new CapnwasmCodegenError("schemaPath is required");
  }
  const abs = resolve(schemaPath);
  if (!existsSync(abs)) {
    throw new CapnwasmCodegenError(`schema not found: ${abs}`, { schemaPath: abs });
  }
  const ext = extname(abs).toLowerCase();
  const isOpenapi = ext === ".yaml" || ext === ".yml" || ext === ".json";

  let structs, restApis, typeInterfaces;
  try {
    if (isOpenapi) {
      // OpenAPI path: read + parse the spec, then run it through the same
      // openapi_parser the CLI uses. YAML support requires the optional
      // 'yaml' package; surface that as a clear codegen error.
      const text = await import("node:fs/promises").then((m) => m.readFile(abs, "utf8"));
      let spec;
      if (ext === ".json") {
        spec = JSON.parse(text);
      } else {
        try {
          const yaml = await import("yaml");
          spec = yaml.parse(text);
        } catch (yamlErr) {
          throw new CapnwasmCodegenError(
            `YAML OpenAPI specs require the optional 'yaml' package. Run \`npm install yaml\`, or convert to JSON.`,
            { schemaPath: abs, cause: yamlErr },
          );
        }
      }
      const { parseOpenApi } = await import("../js/openapi_parser.mjs");
      ({ restApis, typeInterfaces, structs } = parseOpenApi(spec));
    } else {
      ({ structs, restApis, typeInterfaces } = await parseSchema(abs));
    }
  } catch (err) {
    if (err instanceof CapnwasmCodegenError) throw err;
    throw new CapnwasmCodegenError(
      `failed to parse ${abs}: ${err.message}`,
      { schemaPath: abs, cause: err },
    );
  }

  if (structs.length === 0 && restApis.length === 0) {
    throw new CapnwasmCodegenError(
      `no struct or REST interface definitions found in ${abs}`,
      { schemaPath: abs },
    );
  }

  const schemaName = basename(abs);
  let mjs, dts;
  try {
    const mjsParts = [];
    if (structs.length > 0) mjsParts.push(generateJs(structs, schemaName));
    for (const api of restApis) mjsParts.push(generateRestClient(api, schemaName, structs));
    mjs = mjsParts.join("\n\n");

    const dtsParts = [];
    if (structs.length > 0) dtsParts.push(generateDts(structs, schemaName));
    for (const api of restApis) dtsParts.push(generateRestDts(api, schemaName, structs, typeInterfaces ?? []));
    dts = dtsParts.join("\n\n");
  } catch (err) {
    throw new CapnwasmCodegenError(
      `failed to emit code for ${abs}: ${err.message}`,
      { schemaPath: abs, cause: err },
    );
  }

  return {
    mjs,
    dts,
    meta: {
      schemaName,
      structs: structs.map((s) => ({ name: s.name, fieldCount: s.fields.length })),
      restApis: restApis.map((a) => ({ name: a.name, methodCount: a.methods.length })),
      typeInterfaces: (typeInterfaces ?? []).map((t) => ({ name: t.name })),
    },
  };
}

// Only execute the CLI when this file is invoked directly (node bin/...,
// npx capnwasm). Importing it as a module. E.g. from the Vite plugin -
// must not run main(), or the imported file's top-level work would race
// with whatever the importer was doing.
const isDirectInvocation = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
