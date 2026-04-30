#!/usr/bin/env node
// capnwasm-gen — generate typed JS reader bindings from a .capnp schema.
//
// Usage:  npx capnwasm-gen <schema.capnp> [-o output.gen.mjs]
//
// The generated file exports one Reader class per top-level struct in the
// schema. Each reader is backed by the capnwasm wasm runtime, with field
// access by precomputed integer offset — same wire format as any other
// Cap'n Proto language binding.

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, basename, resolve, extname } from "node:path";

function usage() {
  console.error("Usage: capnwasm-gen <schema.capnp> [-o <output.gen.mjs>]");
  process.exit(1);
}

function parseArgs(argv) {
  const args = { schema: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o" || argv[i] === "--output") {
      args.output = argv[++i];
    } else if (!args.schema) {
      args.schema = argv[i];
    }
  }
  if (!args.schema) usage();
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

// Locate the upstream capnp tool; users provide it via PATH or CAPNP_BIN.
function locateCapnp() {
  if (process.env.CAPNP_BIN) return process.env.CAPNP_BIN;
  const candidates = [
    "capnp",
    resolve(process.cwd(), "../capnproto/c++/build/src/capnp/capnp"),
  ];
  for (const cand of candidates) {
    const r = spawnSync(cand, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return cand;
  }
  console.error("capnp tool not found. Set CAPNP_BIN or put 'capnp' on PATH.");
  process.exit(1);
}

/**
 * Parse a .capnp file into a list of struct definitions.
 *
 * Strategy: the upstream `capnp` tool can convert any .capnp source to its
 * canonical text form via `capnp compile -ocapnp`. That output normalizes
 * the syntax and resolves imports, but is still text. We then run a focused
 * regex pass over it to extract struct + field info — sufficient for the
 * shapes the runtime currently supports (Text, Data, primitive numbers).
 *
 * For full schema coverage (groups, unions, generics, capabilities) the
 * recommended path is to invoke this as a real capnp codegen plugin
 * (capnpc-js) which receives the parsed CodeGeneratorRequest as Cap'n Proto
 * bytes — see TODO at the bottom.
 */
async function parseSchema(schemaPath) {
  const capnp = locateCapnp();
  const abs = resolve(schemaPath);
  // The -ocapnp plugin (canonical text output) lives next to the capnp tool.
  const pluginDir = dirname(capnp);
  const env = { ...process.env, PATH: `${pluginDir}:${process.env.PATH ?? ""}` };
  const r = spawnSync(capnp, ["compile", "-ocapnp", basename(abs)], {
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
 * Walk canonical .capnp text, extract every top-level `struct Name { ... }`.
 * Computes data + pointer section offsets per field.
 */
function parseCanonicalCapnp(text) {
  const structs = [];
  // Match struct definitions allowing for nested braces by counting depth.
  let i = 0;
  while (i < text.length) {
    const m = text.slice(i).match(/struct\s+([A-Z][A-Za-z0-9_]*)\s*(?:@0x[0-9a-fA-F]+\s*)?{/);
    if (!m) break;
    const start = i + m.index + m[0].length;
    let depth = 1;
    let j = start;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(start, j - 1);
    structs.push({ name: m[1], fields: parseStructBody(body) });
    i = j;
  }

  // Compute Cap'n Proto field offsets per struct using its packing rules:
  //   - Text/Data/struct/list -> pointer slot, sequential index
  //   - Primitives -> data section, packed by size with alignment
  for (const s of structs) {
    let nextPtr = 0;
    let dataBits = 0;
    for (const f of s.fields) {
      if (isPointerType(f.type)) {
        f.kind = "pointer";
        f.ptrIndex = nextPtr++;
      } else {
        const size = primitiveBitSize(f.type);
        f.kind = "data";
        f.bitSize = size;
        // align
        if (size > 0 && (dataBits % size) !== 0) {
          dataBits += size - (dataBits % size);
        }
        f.bitOffset = dataBits;
        dataBits += size;
      }
    }
  }
  return structs;
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
    case "UInt16":
      return [`return this._cpp._exports.cpp_any_uint16_at(${off}, 0);`];
    case "UInt32":
      return [`return this._cpp._exports.cpp_any_uint32_at(${off}, 0);`];
    case "UInt64":
    case "Int64":
      return [`return this._cpp._exports.cpp_any_int64_at(${off}, 0n);`];
    case "Int32":
      return [`return this._cpp._exports.cpp_any_uint32_at(${off}, 0) | 0;`];
    default:
      return [`throw new Error("unsupported field type: ${field.type}");`];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const structs = await parseSchema(args.schema);
  if (structs.length === 0) {
    console.error("No struct definitions found in schema.");
    process.exit(1);
  }
  const js = generateJs(structs, basename(args.schema));
  await writeFile(args.output, js);
  console.log(`Wrote ${args.output}`);
  console.log(`  ${structs.length} struct(s):`);
  for (const s of structs) {
    console.log(`    ${s.name}  (${s.fields.length} fields)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
