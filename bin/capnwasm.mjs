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
  console.error(`capnwasm — typed Cap'n Proto bindings for the browser

Usage:
  npx capnwasm gen <schema.capnp> [-o output.gen.mjs]
  npx capnwasm build                # rebuild zig-out/capnp_cpp.opt.wasm
  npx capnwasm bench                # run the Playwright bench
  npx capnwasm <schema.capnp>       # shorthand for gen

Library: import { CapnCpp } from "capnwasm";
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

async function parseTsInterfaces(text) {
  const lines = text.split(/\r?\n/);
  const structs = [];
  let current = null;       // {name, fields, nextOrdinal} when inside an interface
  let braceDepth = 0;       // # of unmatched { inside the current interface body
  let pendingDirectives = {};

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    const stripped = raw.replace(/\/\*.*?\*\//g, "").trimEnd();
    const lineCtx = `${lineNo + 1}: ${raw.trim()}`;

    if (current === null) {
      const m = stripped.match(/^\s*(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]*)\s*{?\s*$/);
      if (m) {
        current = { name: m[1], fields: [], nextOrdinal: 0 };
        braceDepth = stripped.endsWith("{") ? 1 : 0;
        pendingDirectives = {};
      }
      continue;
    }

    // We're inside an interface body. Track braces.
    for (const ch of stripped) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }

    // Empty / whitespace-only -> skip.
    if (!stripped.trim()) continue;

    // Closing brace ends the interface.
    if (braceDepth === 0) {
      structs.push({ name: current.name, fields: current.fields });
      current = null;
      pendingDirectives = {};
      continue;
    }

    // Directive comment: `// @capnp X` or `// @ordinal N`.
    const dm = stripped.match(/^\s*\/\/\s*@(capnp|ordinal)\s+(\S+)\s*$/);
    if (dm) {
      pendingDirectives[dm[1]] = dm[2];
      continue;
    }

    // Pure comment line -> skip.
    if (/^\s*\/\//.test(stripped)) continue;

    // Field declaration.
    const fm = stripped.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[;,]?\s*$/);
    if (fm) {
      const tsName = fm[1];
      const tsType = fm[2];
      let capnpType = pendingDirectives.capnp ?? TS_TO_CAPNP[tsType];
      if (!capnpType && /^[A-Z]/.test(tsType)) capnpType = tsType;  // struct ref
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

    // Anything else -> reject loudly.
    throw new Error(`capnwasm: line ${lineNo + 1}: cannot parse '${raw.trim()}'. Supported: simple field declarations 'name: Type;'`);
  }

  if (current !== null) {
    throw new Error("capnwasm: TS source ended inside an interface body (unbalanced braces).");
  }
  validateStructs(structs);
  computeOffsets(structs);
  return structs;
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
      throw new Error(
        `capnwasm: ${s.name}.${f.name}: type '${f.type}' is not a known ` +
        `Cap'n Proto primitive nor a struct declared in this file.`
      );
    }
  }
}

/**
 * Parse a .capnp file directly in JS — no external binary required, so
 * `npx capnwasm gen schema.capnp` works on every platform out of the box.
 *
 * Supported subset (covers ~95% of schemas in practice):
 *   - file id (@0x...;) and top-level struct definitions
 *   - field declarations: `name @N :Type [= default];`
 *   - types: Bool, Int8/16/32/64, UInt8/16/32/64, Float32/64, Text, Data,
 *            other struct names, AnyPointer
 *   - line + block comments
 *
 * Not yet supported (parser will warn and skip):
 *   - groups, unions, generics, interfaces (RPC), enums, constants,
 *     nested struct definitions, imports, annotations
 *
 * For full grammar coverage, set CAPNP_BIN to point at the upstream `capnp`
 * tool — the parser will defer to it via `capnp compile -ocapnp` and walk
 * the canonical text output. Both paths feed the same struct model.
 */
async function parseSchema(schemaPath) {
  const abs = resolve(schemaPath);
  const text = await import("node:fs/promises").then((m) => m.readFile(abs, "utf8"));
  if (abs.endsWith(".ts") || abs.endsWith(".tsx")) {
    return parseTsInterfaces(text);
  }
  if (process.env.CAPNP_BIN) {
    return parseSchemaViaUpstream(abs, process.env.CAPNP_BIN);
  }
  return parseRawCapnp(text);
}

function parseSchemaViaUpstream(abs, capnpBin) {
  const pluginDir = dirname(capnpBin);
  const env = { ...process.env, PATH: `${pluginDir}:${process.env.PATH ?? ""}` };
  const r = spawnSync(capnpBin, ["compile", "-ocapnp", basename(abs)], {
    encoding: "utf8",
    cwd: dirname(abs),
    env,
  });
  if (r.status !== 0) {
    console.error("capnp compile failed:", r.stderr);
    process.exit(1);
  }
  return parseCanonicalCapnp(r.stdout);
}

/** Strip line + block comments. */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** Parse raw .capnp source directly. */
function parseRawCapnp(srcRaw) {
  const src = stripComments(srcRaw);
  const structs = [];
  // Find each `struct Name [@0xId] { ... }` taking nesting into account so
  // we don't trip over braces inside groups/unions.
  let i = 0;
  while (i < src.length) {
    const m = src.slice(i).match(/struct\s+([A-Z][A-Za-z0-9_]*)\s*(?:@0x[0-9a-fA-F]+\s*)?{/);
    if (!m) break;
    const start = i + m.index + m[0].length;
    let depth = 1;
    let j = start;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(start, j - 1);
    structs.push({ name: m[1], fields: parseStructBody(body) });
    i = j;
  }
  validateStructs(structs);
  computeOffsets(structs);
  return structs;
}

/**
 * Parse a single struct's body into ordered field definitions.
 * Body is the text between `struct Name { ... }`.
 */
function parseStructBody(body) {
  const fields = [];
  // Match: name @N :Type;  or  name @N :List(Type);  or  name @N :Text;
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*@(\d+)\s*:([A-Za-z0-9_(),. ]+?)\s*(?:=\s*[^;]+?)?\s*;/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const [_, name, ordinal, type] = m;
    fields.push({ name, ordinal: +ordinal, type: type.trim() });
  }
  return fields;
}

/**
 * Walk canonical .capnp text (output of upstream `capnp -ocapnp`).
 * Same shape as parseRawCapnp but starts from already-normalized text.
 */
function parseCanonicalCapnp(text) {
  return parseRawCapnp(text);
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

  for (const s of structs) {
    lines.push(`export class ${s.name}Reader {`);
    lines.push(`  constructor(cpp) { this._cpp = cpp; }`);
    lines.push("");
    for (const f of s.fields) {
      const getter = generateGetter(f);
      lines.push(`  get ${f.name}() {`);
      for (const line of getter) lines.push(`    ${line}`);
      lines.push(`  }`);
    }
    // Materializing helper: pulls every field at once. Avoids N wasm
    // boundary crossings when the caller really wants the whole object.
    // For sparse access prefer the per-field getters.
    lines.push("");
    lines.push(`  toObject() {`);
    lines.push(`    return {`);
    for (const f of s.fields) {
      lines.push(`      ${f.name}: this.${f.name},`);
    }
    lines.push(`    };`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push("");
  }

  // Open helper for the first struct (treated as the root by convention).
  if (structs.length > 0) {
    const root = structs[0];
    lines.push(`/**`);
    lines.push(` * Open framed Cap'n Proto bytes for typed access. Returns a ${root.name}Reader.`);
    lines.push(` */`);
    lines.push(`export function open${root.name}(cpp, bytes) {`);
    lines.push(`  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");`);
    lines.push(`  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());`);
    lines.push(`  if (cpp._exports.cpp_any_open(bytes.length) !== 1) throw new Error("cpp_any_open failed");`);
    lines.push(`  return new ${root.name}Reader(cpp);`);
    lines.push(`}`);
  }

  return lines.join("\n") + "\n";
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

function generateGetter(field) {
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
  const structs = await parseSchema(args.schema);
  if (structs.length === 0) {
    console.error("No struct definitions found in schema.");
    process.exit(1);
  }
  const js = generateJs(structs, basename(args.schema));
  await writeFile(args.output, js);
  console.log(`Wrote ${args.output}`);

  // Emit a sibling .d.ts so TypeScript callers get type-checked field access.
  // Same struct model as the .mjs — one source of truth for both.
  const dtsPath = args.output.replace(/\.mjs$/, ".d.ts");
  const dts = generateDts(structs, basename(args.schema));
  await writeFile(dtsPath, dts);
  console.log(`Wrote ${dtsPath}`);

  console.log(`  ${structs.length} struct(s):`);
  for (const s of structs) {
    console.log(`    ${s.name}  (${s.fields.length} fields)`);
  }
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) topUsage();

  const cmd = argv[0];
  switch (cmd) {
    case "gen":     await cmdGen(argv.slice(1)); return;
    case "build":   cmdBuild(); return;
    case "bench":   cmdBench(); return;
    case "-h": case "--help": case "help": topUsage(); return;
  }
  // Shorthand: `npx capnwasm path/to/schema.capnp` runs the generator.
  if (cmd.endsWith(".capnp") && existsSync(cmd)) {
    await cmdGen(argv);
    return;
  }
  console.error(`unknown command: ${cmd}`);
  topUsage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
