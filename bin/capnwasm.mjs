#!/usr/bin/env node
// capnwasm — single CLI for codegen, build, and bench. Same package also
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
import { existsSync } from "node:fs";
import { dirname, basename, resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

function topUsage() {
  console.error(`capnwasm — typed clients from one schema, two wire formats

Usage:
  npx capnwasm gen <schema.capnp|schema.ts> [-o output.gen.mjs]
      Generate a Cap'n Proto reader/builder, or (when the .ts file declares
      an @rest interface) a typed REST client.

  npx capnwasm openapi <spec.yaml|spec.json> [-o output.gen.mjs]
      Generate a typed REST client from an OpenAPI 3.x spec. Works against
      any service that publishes one (Stripe, GitHub, Twilio, etc.).

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
          // Pure TS type interface alongside a REST API — capture the
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
          // These can repeat (multiple @query lines) — accumulate as arrays/maps.
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

  // @body paramName — explicit body param. If just `@body` (no name), the
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
  // default — it shows up as a ?key=value pair on the URL).
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
      if (VALID_CAPNP_PRIMS.has(f.type)) continue;
      if (declared.has(f.type)) continue;
      // List(X) is valid if X is a known type. Recurse via inner-type extract.
      const listMatch = /^List\(([^)]+)\)$/.exec(f.type);
      if (listMatch) {
        const inner = listMatch[1];
        if (VALID_CAPNP_PRIMS.has(inner) || declared.has(inner)) continue;
        if (/^List\(/.test(inner)) continue;  // nested list — assume well-formed; validated by upstream compiler
      }
      throw new Error(
        `capnwasm: ${s.name}.${f.name}: type '${f.type}' is not a known ` +
        `Cap'n Proto primitive nor a struct declared in this file.`
      );
    }
  }
}

// .capnp files are compiled via our wasm-built capnp schema compiler
// (zig-out/capnpc.opt.wasm), so the same vendored sources produce both
// runtime and compiler — no version skew, no external binary required.
//
// Cached compiler instance — wasm load is one-time and the compiler is
// heavyweight. Reused across all .capnp parses in a single CLI invocation.
let _capnpCompiler = null;
async function getCapnpCompiler() {
  if (_capnpCompiler) return _capnpCompiler;
  const { CapnpCompiler } = await import("../js/capnpc_loader.mjs");
  _capnpCompiler = await CapnpCompiler.load();
  return _capnpCompiler;
}

async function parseSchema(schemaPath) {
  const abs = resolve(schemaPath);
  const text = await import("node:fs/promises").then((m) => m.readFile(abs, "utf8"));
  if (abs.endsWith(".ts") || abs.endsWith(".tsx")) {
    return parseTsInterfaces(text);
  }
  // .capnp paths — compile via our bundled wasm-built capnp compiler. No
  // external binary, no version skew with the runtime. The same vendor/
  // sources produce both compiler and runtime, guaranteed compatible.
  const compiler = await getCapnpCompiler();
  const structs = await compiler.compileToModel(basename(abs), text);
  validateStructs(structs);
  return { structs, restApis: [], typeInterfaces: [] };
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
 * whenever fields are not in size-decreasing order — readers get garbage
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

      // No hole worked — extend the data section. Alignment padding becomes
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
 * normal V8 inlinable call — no string lookup, no Proxy.
 */
function generateJs(structs, schemaName) {
  const lines = [];
  lines.push(`// Generated from ${schemaName} by capnwasm-gen — do not edit by hand.`);
  lines.push("");
  lines.push(`const SHARED_TEXT_DECODER = new TextDecoder();`);
  lines.push(`const SHARED_ENCODER = new TextEncoder();`);
  lines.push(`function decodeAscii(bytes) {`);
  lines.push(`  let asciiOk = true;`);
  lines.push(`  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { asciiOk = false; break; }`);
  lines.push(`  if (asciiOk) {`);
  lines.push(`    let s = "";`);
  lines.push(`    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);`);
  lines.push(`    return s;`);
  lines.push(`  }`);
  lines.push(`  return SHARED_TEXT_DECODER.decode(bytes);`);
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
  lines.push(`// Per-(class, field-list) cache of pre-encoded request bytes. Compiling the
// request is a tight loop but it's still wasted work in a hot pick loop.
// We key on a frozen Uint8Array of the descriptor bytes so identical field
// sets (the common case in batch processing) hit the cache.
const _PICK_REQ_CACHE = new WeakMap();  // fields -> Map<namesKey, Uint8Array>

function _getPickRequest(fields, names) {
  let perFields = _PICK_REQ_CACHE.get(fields);
  if (!perFields) { perFields = new Map(); _PICK_REQ_CACHE.set(fields, perFields); }
  const key = names.join("\\0");
  let req = perFields.get(key);
  if (req) return req;
  const buf = new Uint8Array(4 + names.length * 5);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, names.length, true);
  let pos = 4;
  for (let i = 0; i < names.length; i++) {
    const d = fields[names[i]];
    if (!d) throw new Error("unknown field: " + names[i]);
    buf[pos] = d.kind; pos += 1;
    dv.setUint32(pos, d.off, true); pos += 4;
  }
  perFields.set(key, buf);
  return buf;
}

function _capnwasmPick(cpp, fields, names) {`);
  lines.push(`  // Cached request prep — same names hit the WeakMap and skip the encode loop.`);
  lines.push(`  const req = _getPickRequest(fields, names);`);
  lines.push(`  const u8 = cpp._u8;`);
  lines.push(`  const aux = cpp._exports.cpp_lazy_aux_ptr();`);
  lines.push(`  u8.set(req, aux);`);
  lines.push(`  const descs = new Array(names.length);`);
  lines.push(`  for (let i = 0; i < names.length; i++) descs[i] = fields[names[i]];`);
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
  lines.push(`      case "uint64":`);
  lines.push(`      case "int64": {`);
  lines.push(`        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true);`);
  lines.push(`        const hi = dv2.getInt32 (out - dv2.byteOffset + readPos + 4, true);`);
  lines.push(`        result[names[i]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv2.getBigInt64(out - dv2.byteOffset + readPos, true);`);
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

  for (const s of structs) {
    lines.push(`export class ${s.name}Reader {`);
    lines.push(`  constructor(cpp) { this._cpp = cpp; }`);
    lines.push("");
    // Union accessor: when this struct holds a union, `which()` returns the
    // discriminant value (0..N-1) and the codegen below adds `is<Foo>()`
    // guards for each variant. The discriminant lives at a fixed byte
    // offset in the data section, written as a u16.
    if (s.discriminantCount && s.discriminantOffsetBits !== undefined) {
      const byteOff = s.discriminantOffsetBits >> 3;
      lines.push(`  /** Returns the discriminant of this struct's union (0..${s.discriminantCount - 1}). */`);
      lines.push(`  which() {`);
      lines.push(`    return this._cpp._exports.cpp_any_uint16_at(${byteOff}, 0);`);
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
      const getter = generateGetter(f);
      lines.push(`  get ${f.name}() {`);
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
    // Per-class field descriptor table — fed to cpp_any_batch_read so one
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
    // Pick: one wasm call to fetch N fields packed.
    lines.push(`  pick(names) {`);
    lines.push(`    return ${s.name}Reader._pickImpl(this._cpp, names);`);
    lines.push(`  }`);
    lines.push("");
    lines.push(`  static _pickImpl(cpp, names) {`);
    lines.push(`    return _capnwasmPick(cpp, ${s.name}Reader._FIELDS, names);`);
    lines.push(`  }`);
    lines.push("");
    // Plan/apply: write `r.access.field0; r.access.field5` etc, then `r.apply()`
    // fetches them all in one wasm call. Proxy traps run only during the plan
    // phase so their cost is paid once per record, not per hot-loop iteration.
    // Same shape as Terraform plan -> apply.
    lines.push(`  get access() {`);
    lines.push(`    if (!this._plan) {`);
    lines.push(`      this._plan = [];`);
    lines.push(`      const recorded = this._plan;`);
    lines.push(`      const fields = ${s.name}Reader._FIELDS;`);
    lines.push(`      this._access = new Proxy(Object.create(null), {`);
    lines.push(`        get(_, name) {`);
    lines.push(`          if (typeof name === "string" && (name in fields)) recorded.push(name);`);
    lines.push(`          return undefined;`);
    lines.push(`        }`);
    lines.push(`      });`);
    lines.push(`    }`);
    lines.push(`    return this._access;`);
    lines.push(`  }`);
    lines.push("");
    lines.push(`  apply() {`);
    lines.push(`    if (!this._plan || this._plan.length === 0) return {};`);
    lines.push(`    const result = ${s.name}Reader._pickImpl(this._cpp, this._plan);`);
    lines.push(`    this._plan = null;`);
    lines.push(`    this._access = null;`);
    lines.push(`    return result;`);
    lines.push(`  }`);
    lines.push("");
    // Materializing helper: every field at once via the same batched primitive.
    lines.push(`  toObject() {`);
    lines.push(`    return ${s.name}Reader._pickImpl(this._cpp, Object.keys(${s.name}Reader._FIELDS));`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
  }

  // Builder classes — counterpart to Readers. One Builder writes one
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
    lines.push(`    if (!opts || !opts.preinitialized) {`);
    lines.push(`      if (cpp._exports.cpp_any_builder_init(${s.dataWords}, ${s.ptrWords}) !== 1) {`);
    lines.push(`        throw new Error("cpp_any_builder_init failed");`);
    lines.push(`      }`);
    lines.push(`    }`);
    // Cache the data section's address in linear memory so primitive
    // setters can write straight to wasm memory — no per-setter wasm call.
    // The address stays valid until any_builder_root is replaced (i.e. the
    // next builder init), which happens after this Builder's lifetime.
    lines.push(`    this._dataPtr = cpp._exports.cpp_any_builder_data_ptr();`);
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
      lines.push(`    this._cpp._exports.cpp_any_builder_set_uint16(${discByteOff}, variant & 0xffff);`);
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
          lines.push(`    this._cpp._exports.cpp_any_builder_set_uint16(${discByteOff}, ${f.discriminantValue});`);
        }
        lines.push(`    return new ${f.groupStructName}Builder(this._cpp, { preinitialized: true });`);
        lines.push(`  }`);
        continue;
      }
      const setter = generateSetter(f);
      if (!setter) continue;
      lines.push(`  set ${f.name}(value) {`);
      // If this field is a union variant, auto-write the discriminant.
      // Inline rather than calling setWhich so the data-section write is
      // visible to V8's inliner.
      if (s.discriminantCount && f.discriminantValue !== undefined && s.discriminantOffsetBits !== undefined) {
        const discByteOff = s.discriminantOffsetBits >> 3;
        lines.push(`    this._cpp._exports.cpp_any_builder_set_uint16(${discByteOff}, ${f.discriminantValue});`);
      }
      for (const line of setter) lines.push(`    ${line}`);
      lines.push(`  }`);
    }
    lines.push("");
    lines.push(`  /** Serialize the message to framed Cap'n Proto bytes. */`);
    lines.push(`  toBytes() {`);
    lines.push(`    const len = this._cpp._exports.cpp_any_builder_finalize();`);
    lines.push(`    if (!len) throw new Error("cpp_any_builder_finalize failed");`);
    lines.push(`    const u8 = this._cpp._u8;`);
    lines.push(`    const out = this._cpp._outPtr;`);
    lines.push(`    return u8.slice(out, out + len);`);
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
    lines.push(`  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");`);
    lines.push(`  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());`);
    lines.push(`  if (cpp._exports.cpp_any_open(bytes.length) !== 1) throw new Error("cpp_any_open failed");`);
    lines.push(`  return new ${s.name}Reader(cpp);`);
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

function generateSetter(field) {
  // Group fields aren't assignable directly. The Builder exposes them as
  // a getter that returns a sub-Builder you write into:
  //   b.address.street = "...";
  // We emit the getter outside generateSetter (in the Builder loop above)
  // and skip setter generation here.
  if (field.kind === "group") return null;
  if (field.kind === "pointer") {
    if (field.type === "Text") {
      // encodeInto writes UTF-8 bytes directly into the destination Uint8Array
      // — no intermediate JS allocation. The destination is a subarray view of
      // wasm linear memory at cpp_in_ptr(), so the bytes land where the C++
      // setter will read them in one step.
      return [
        `const inPtr = this._cpp._exports.cpp_in_ptr();`,
        `const inCap = this._cpp._exports.cpp_in_capacity();`,
        `const dst = this._cpp._u8.subarray(inPtr, inPtr + inCap);`,
        `const { written } = SHARED_ENCODER.encodeInto(value, dst);`,
        `this._cpp._exports.cpp_any_builder_set_text(${field.ptrIndex}, written);`,
      ];
    }
    if (field.type === "Data") {
      // Data already lives in a typed-array buffer. If it's a view into wasm
      // memory, u8.set is a memmove (free-ish); if it's in JS heap, the copy
      // into wasm is unavoidable without changing the caller's allocation site.
      return [
        `const u8 = this._cpp._u8;`,
        `u8.set(value, this._cpp._exports.cpp_in_ptr());`,
        `this._cpp._exports.cpp_any_builder_set_data(${field.ptrIndex}, value.length);`,
      ];
    }
    return null;  // struct refs need nested builder support
  }
  // Primitive setters write DIRECTLY into wasm linear memory at the data
  // section's known offset. No wasm boundary crossing per setter — V8 just
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
        `const u8 = this._cpp._u8;`,
        `const off = this._dataPtr + ${byte};`,
        `if (value) u8[off] |= ${mask};`,
        `else u8[off] &= ${(~mask) & 0xff};`,
      ];
    }
    case "UInt8":
    case "Int8":
      return [`this._cpp._u8[this._dataPtr + ${off}] = value & 0xff;`];
    case "UInt16":
    case "Int16":
      return [
        `const u8 = this._cpp._u8;`,
        `const o = this._dataPtr + ${off};`,
        `u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;`,
      ];
    case "UInt32":
    case "Int32":
      return [
        `const u8 = this._cpp._u8;`,
        `const o = this._dataPtr + ${off};`,
        `u8[o] = value & 0xff; u8[o+1] = (value >>> 8) & 0xff;`,
        `u8[o+2] = (value >>> 16) & 0xff; u8[o+3] = (value >>> 24) & 0xff;`,
      ];
    case "UInt64":
    case "Int64":
      // Use DataView for the 64-bit case — setBigInt64 handles BigInt
      // directly. For normal-Number input, we still need the manual lo/hi
      // dance to preserve precision.
      return [
        `const dv = new DataView(this._cpp._u8.buffer);`,
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
        `new DataView(this._cpp._u8.buffer).setFloat32(this._dataPtr + ${off}, value, true);`,
      ];
    case "Float64":
      return [
        `new DataView(this._cpp._u8.buffer).setFloat64(this._dataPtr + ${off}, value, true);`,
      ];
    default:
      return null;
  }
}

/**
 * Emit a `.d.ts` for the same set of structs. Each Cap'n Proto type maps
 * back to its closest TS type so consumers get autocomplete + type errors
 * on field misuse. Map mirrors TS_TO_CAPNP from parseTsInterfaces.
 */
function generateDts(structs, schemaName) {
  const lines = [];
  lines.push(`// Generated from ${schemaName} by capnwasm-gen — do not edit by hand.`);
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
    lines.push(`  pick<K extends ${fieldUnion}>(names: K[]): { [P in K]: this[P] };`);
    lines.push(`  readonly access: { readonly [P in ${fieldUnion}]: undefined };`);
    lines.push(`  apply(): Partial<{ [P in ${fieldUnion}]: this[P] }>;`);
    lines.push(`}`);
    lines.push("");
  }
  if (structs.length > 0) {
    const root = structs[0];
    lines.push(`export declare function open${root.name}(cpp: CapnCpp, bytes: Uint8Array): ${root.name}Reader;`);
  }
  return lines.join("\n") + "\n";
}

function capnpToTs(capnpType, declaredStructs) {
  if (declaredStructs.has(capnpType)) return capnpType + "Reader";
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
    return { kind: -1, off: 0, type: f.type };
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

// Emit JS for a List<X> getter. Returns a list-view with .length, .at(i),
// and Symbol.iterator. The element type drives at(i)'s return shape.
//
// For struct element lists, at(i) navigates the wasm reader stack and
// constructs a typed Reader. The reader is "live" — it shares the wasm
// any_stack[top] slot, so accessing fields on it after another at(i) call
// would read the new element. Treat at(i) as "open one element at a time."
function generateListGetter(ptrIndex, innerType) {
  const lines = [];
  // Open the list once, capture size, then return a wrapper.
  lines.push(`const cpp = this._cpp;`);
  lines.push(`const size = cpp._exports.cpp_any_open_list(${ptrIndex});`);
  // The wrapper closes over `cpp` and `size`. Each .at(i) re-opens the
  // list (since other readers may have changed any_list_reader state) and
  // either reads a primitive or pushes the element struct on the stack
  // and constructs a typed Reader.
  if (PRIMITIVE_LIST_GETTERS[innerType]) {
    const primFn = PRIMITIVE_LIST_GETTERS[innerType];
    lines.push(`return {`);
    lines.push(`  length: size,`);
    lines.push(`  at(i) {`);
    lines.push(`    if (i < 0 || i >= size) return undefined;`);
    lines.push(`    cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`    return ${primFn};`);
    lines.push(`  },`);
    lines.push(`  *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },`);
    lines.push(`};`);
    return lines;
  }
  if (innerType === "Text") {
    lines.push(`const decoder = SHARED_TEXT_DECODER;`);
    lines.push(`return {`);
    lines.push(`  length: size,`);
    lines.push(`  at(i) {`);
    lines.push(`    if (i < 0 || i >= size) return undefined;`);
    lines.push(`    cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`    const len = cpp._exports.cpp_any_list_get_text(i);`);
    lines.push(`    if (len === 0) return "";`);
    lines.push(`    const out = cpp._outPtr;`);
    lines.push(`    return decodeAscii(cpp._u8.subarray(out, out + len));`);
    lines.push(`  },`);
    lines.push(`  *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },`);
    lines.push(`};`);
    return lines;
  }
  if (innerType === "Data") {
    lines.push(`return {`);
    lines.push(`  length: size,`);
    lines.push(`  at(i) {`);
    lines.push(`    if (i < 0 || i >= size) return undefined;`);
    lines.push(`    cpp._exports.cpp_any_open_list(${ptrIndex});`);
    lines.push(`    const len = cpp._exports.cpp_any_list_get_data(i);`);
    lines.push(`    const out = cpp._outPtr;`);
    lines.push(`    return cpp._u8.slice(out, out + len);`);
    lines.push(`  },`);
    lines.push(`  *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },`);
    lines.push(`};`);
    return lines;
  }
  // Struct element list: at(i) navigates into element i and constructs a
  // typed Reader. The Reader shares any_stack — calling at again will move
  // the stack pointer, so callers reading multiple elements should
  // materialize before iterating further.
  lines.push(`return {`);
  lines.push(`  length: size,`);
  lines.push(`  at(i) {`);
  lines.push(`    if (i < 0 || i >= size) return undefined;`);
  lines.push(`    cpp._exports.cpp_any_open_list(${ptrIndex});`);
  lines.push(`    cpp._exports.cpp_any_enter_list_at(i);`);
  lines.push(`    const r = new ${innerType}Reader(cpp);`);
  lines.push(`    return r;`);
  lines.push(`  },`);
  lines.push(`  *[Symbol.iterator]() { for (let i = 0; i < size; i++) yield this.at(i); },`);
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
};

function generateGetter(field) {
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
    return [`return new ${field.groupStructName}Reader(this._cpp);`];
  }
  if (field.kind === "pointer") {
    if (field.type === "Text") {
      return [
        `const len = this._cpp._exports.cpp_any_text_at(${field.ptrIndex});`,
        `if (len === 0) return "";`,
        `const u8 = this._cpp._u8;`,
        `const out = this._cpp._outPtr;`,
        `return decodeAscii(u8.subarray(out, out + len));`,
      ];
    }
    if (field.type === "Data") {
      return [
        `const len = this._cpp._exports.cpp_any_data_at(${field.ptrIndex});`,
        `const u8 = this._cpp._u8;`,
        `const out = this._cpp._outPtr;`,
        `return u8.slice(out, out + len);`,
      ];
    }
    // Lists: return a typed list-view object (length + at(i) + iterator).
    // The element type drives whether at(i) returns a primitive, a string,
    // a Uint8Array, or a typed Reader for nested struct elements.
    const listMatch = /^List\(([^)]+)\)$/.exec(field.type);
    if (listMatch) {
      const inner = listMatch[1];
      return generateListGetter(field.ptrIndex, inner);
    }
    return [`throw new Error("unsupported pointer type: ${field.type}");`];
  }
  // data-section field
  const off = field.bitOffset >> 3;
  switch (field.type) {
    case "Bool":
      return [`return this._cpp._exports.cpp_any_bool_at(${field.bitOffset}, 0) === 1;`];
    case "UInt8":
      return [`return this._cpp._exports.cpp_any_uint8_at(${off}, 0);`];
    case "Int8":
      // sign-extend 8 -> 32 via <<24 >>24
      return [`return (this._cpp._exports.cpp_any_uint8_at(${off}, 0) << 24) >> 24;`];
    case "UInt16":
      return [`return this._cpp._exports.cpp_any_uint16_at(${off}, 0);`];
    case "Int16":
      return [`return (this._cpp._exports.cpp_any_uint16_at(${off}, 0) << 16) >> 16;`];
    case "UInt32":
      return [`return this._cpp._exports.cpp_any_uint32_at(${off}, 0);`];
    case "Int32":
      return [`return this._cpp._exports.cpp_any_uint32_at(${off}, 0) | 0;`];
    case "UInt64":
      return [`return this._cpp._exports.cpp_any_int64_at(${off}, 0n);`];
    case "Int64":
      return [`return this._cpp._exports.cpp_any_int64_at(${off}, 0n);`];
    case "Float32":
      // Reinterpret u32 bits as f32 via a stack-allocated typed-array view.
      return [
        `const u = this._cpp._exports.cpp_any_uint32_at(${off}, 0) >>> 0;`,
        `if (!this._f32buf) { this._f32buf = new ArrayBuffer(4); this._f32u32 = new Uint32Array(this._f32buf); this._f32f32 = new Float32Array(this._f32buf); }`,
        `this._f32u32[0] = u;`,
        `return this._f32f32[0];`,
      ];
    case "Float64":
      return [
        `const lo = this._cpp._exports.cpp_any_uint32_at(${off}, 0) >>> 0;`,
        `const hi = this._cpp._exports.cpp_any_uint32_at(${off + 4}, 0) >>> 0;`,
        `if (!this._f64buf) { this._f64buf = new ArrayBuffer(8); this._f64u32 = new Uint32Array(this._f64buf); this._f64f64 = new Float64Array(this._f64buf); }`,
        `this._f64u32[0] = lo; this._f64u32[1] = hi;`,
        `return this._f64f64[0];`,
      ];
    default:
      return [`throw new Error("unsupported field type: ${field.type}");`];
  }
}

async function cmdGen(argv) {
  const args = parseGenArgs(argv);
  const { structs, restApis, typeInterfaces } = await parseSchema(args.schema);
  if (structs.length === 0 && restApis.length === 0) {
    console.error("No struct or REST interface definitions found in schema.");
    process.exit(1);
  }

  // Emit a single .mjs that contains both capnp-wire bindings and any
  // REST clients defined via @rest interfaces.
  const jsParts = [];
  if (structs.length > 0) jsParts.push(generateJs(structs, basename(args.schema)));
  for (const api of restApis) jsParts.push(generateRestClient(api, basename(args.schema), structs));
  await writeFile(args.output, jsParts.join("\n\n"));
  console.log(`Wrote ${args.output}`);

  const dtsParts = [];
  if (structs.length > 0) dtsParts.push(generateDts(structs, basename(args.schema)));
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
  lines.push(`// Generated from ${schemaName} by capnwasm-gen — do not edit by hand.`);
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

  // Header params — use wire header name (may differ from JS identifier).
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
  lines.push(`// Generated from ${schemaName} by capnwasm-gen — do not edit by hand.`);
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
    // YAML — try the optional `yaml` package. If unavailable, give the
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
    case "gen":     await cmdGen(argv.slice(1)); return;
    case "openapi": await cmdOpenapi(argv.slice(1)); return;
    case "build":   cmdBuild(); return;
    case "bench":   cmdBench(); return;
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
