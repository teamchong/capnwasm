// JS shim around zig-out/capnpc.opt.wasm. The upstream Cap'n Proto schema
// compiler statically linked into wasm. Lets us compile any .capnp source
// to a binary CodeGeneratorRequest with no external `capnp` binary. The
// compiler's version is locked to whatever vendor/ we shipped, so there's
// no version-skew risk vs the runtime.
//
// Public API:
//   const compiler = await CapnpCompiler.load();
//   const requestBytes = compiler.compile("my.capnp", sourceString);
//   // requestBytes is a Uint8Array containing a serialized
//   // capnp::schema::CodeGeneratorRequest (Cap'n Proto framed message).

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWasiImports } from "./cpp_wasi_shim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");

// Number of standard capnp schemas embedded inside the compiler wasm
// (cpp/embed_standard_schemas.sh). Bumped when SCHEMAS in that script
// changes. Used by the JS loader to compute the user file's index after
// the wasm-side preload runs.
const EMBEDDED_STANDARD_COUNT = 6;  // c++, schema, stream, rpc, rpc-twoparty, persistent

export class CapnpCompiler {
  #instance;
  #memory;
  #exports;
  #u8() { return new Uint8Array(this.#memory.buffer); }
  // Optional extra schemas the user wants resolvable on top of the
  // embedded standards. Registered via addSchema() before compile().
  #extraFiles = [];
  // Track total files added in the current compile cycle so we know the
  // user's file index. Reset in compile().
  #addedThisCompile = 0;

  static async load(wasmPath) {
    // Three sources, in order of preference:
    //   1. wasmPath argument (caller knows where the wasm lives)
    //   2. dist/capnpc.wasm.gz (gzipped, shipped in npm. Gunzip on load
    //      saves 460 KB of unpacked package weight vs raw .wasm; sub-ms
    //      gunzip cost is invisible behind WebAssembly.compile that
    //      follows)
    //   3. zig-out/capnpc.opt.wasm (raw, source checkout fallback)
    let bytes;
    if (wasmPath) {
      bytes = await readFile(wasmPath);
    } else {
      try {
        const gz = await readFile(resolve(PKG_ROOT, "dist", "capnpc.wasm.gz"));
        const ds = new DecompressionStream("gzip");
        const stream = new Response(gz).body.pipeThrough(ds);
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        bytes = await readFile(resolve(PKG_ROOT, "zig-out", "capnpc.opt.wasm"));
      }
    }
    const wasi = buildWasiImports();
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: wasi.imports,
    });
    wasi.setMemory(instance.exports.memory);
    const c = new CapnpCompiler();
    c.#instance = instance;
    c.#memory = instance.exports.memory;
    c.#exports = instance.exports;
    return c;
  }

  /** Register an extra schema file resolvable by name during compile(). */
  addSchema(name, source) {
    const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
    this.#extraFiles.push({ name, bytes });
  }

  /**
   * Count of files registered with the compiler this cycle (standards +
   * extras + user). Wasm-side preloads happen on capnpc_reset; we can't
   * directly query that count, so we hardcode the embedded-standards
   * count to match cpp/embed_standard_schemas.sh's SCHEMAS array.
   */
  async #getFileCount() {
    return EMBEDDED_STANDARD_COUNT + this.#extraFiles.length + this.#addedThisCompile;
  }

  /** Stage `bytes` in capnpc_in then call capnpc_add_file. */
  #addFile(name, bytes) {
    const u8 = this.#u8();
    const inPtr = this.#exports.capnpc_in_ptr();
    const cap = this.#exports.capnpc_in_capacity();
    if (bytes.length > cap) throw new Error(`schema source exceeds compiler scratch (${cap} bytes)`);
    u8.set(bytes, inPtr);
    // The name itself goes through a separate small allocation: write it
    // adjacent to the source bytes in cpp_in (we have plenty of room).
    const nameBytes = new TextEncoder().encode(name);
    if (bytes.length + nameBytes.length > cap) throw new Error("name + source exceeds scratch");
    u8.set(nameBytes, inPtr + bytes.length);  // appended after src; we pass ptr+len directly
    if (this.#exports.capnpc_add_file(inPtr + bytes.length, nameBytes.length, bytes.length) !== 1) {
      throw new Error(`capnpc_add_file(${name}) failed`);
    }
    this.#addedThisCompile++;
  }

  /**
   * One-shot pipeline: compile + extract a struct model. Returns an array
   * of struct definitions in the shape consumed by our generator (same as
   * what parseTsInterfaces produces). Throws on compile errors.
   */
  async compileToModel(name, source) {
    const requestBytes = await this.compile(name, source);

    // Stage the request bytes back into capnpc_in with a 4-byte length
    // prefix at offset 0, then call extract.
    const u8 = this.#u8();
    const inPtr = this.#exports.capnpc_in_ptr();
    new DataView(u8.buffer).setUint32(inPtr, requestBytes.length, true);
    u8.set(requestBytes, inPtr + 4);

    const len = this.#exports.capnpc_extract_structs();
    if (len === 0) throw new Error("capnpc_extract_structs failed");
    const outPtr = this.#exports.capnpc_out_ptr();
    const json = new TextDecoder().decode(u8.slice(outPtr, outPtr + len));
    const raw = JSON.parse(json);

    // Pull interface nodes out of the same compile request so byId in
    // translateStruct can resolve `Capability(<IfaceName>)` types. The
    // struct extractor doesn't emit them; capnpc_extract_interfaces does.
    const ifaces = this.extractInterfaces();

    // raw is [{ name, id, dataWords, ptrWords, fields: [{name, ordinal, codeOrder, slot:{offset,type}}] }]
    // Translate types and compute bitOffsets so the existing codegen consumes it.
    // Translate each top-level struct (skipping raw group entries. Those
    // are referenced via parent.field.group lookups during translateField
    // and re-synthesized with parent-prefixed names so they don't clash
    // with user types). Then lift the synthesized group-Reader structs
    // into the flat output list so the generator emits classes for them.
    const refs = [...raw, ...ifaces];
    const top = raw.filter(s => !s.isGroup).map(s => translateStruct(s, refs));
    const out = [];
    for (const s of top) {
      if (s._synthStructs) {
        out.push(...s._synthStructs);
        delete s._synthStructs;
      }
      out.push(s);
    }
    return out;
  }

  /**
   * Extract interface metadata from the most recently compiled request.
   * Must be called *after* compileToModel. They share the same buffered
   * CodeGeneratorRequest in capnpc_in. Returns a list of:
   *   { name, id, methods: [{ id, name, paramStructId, resultStructId }] }
   * Empty array if the schema declares no interfaces.
   */
  extractInterfaces() {
    const len = this.#exports.capnpc_extract_interfaces();
    if (len === 0) return [];
    const outPtr = this.#exports.capnpc_out_ptr();
    const u8 = this.#u8();
    const json = new TextDecoder().decode(u8.slice(outPtr, outPtr + len));
    return JSON.parse(json);
  }

  /**
   * Compile a single .capnp source. Returns the binary CodeGeneratorRequest
   * (Cap'n Proto framed message) as a Uint8Array, or throws with the
   * concatenated error text.
   *
   * Standard schemas (c++.capnp, schema.capnp, rpc.capnp, etc.) are
   * embedded in the compiler wasm and pre-loaded by capnpc_reset, so user
   * imports of `/capnp/c++.capnp` resolve without host filesystem access.
   * To inject additional schemas the user owns, call addSchema() before
   * compile().
   */
  async compile(name, source) {
    const sourceBytes = typeof source === "string"
      ? new TextEncoder().encode(source)
      : source;
    // Reset compiler state. This also re-pre-loads the embedded standard
    // schemas via the wasm-side preloadStandardSchemas().
    this.#addedThisCompile = 0;
    this.#exports.capnpc_reset();

    // Apply any user-registered extra files registered via addSchema().
    for (const extra of this.#extraFiles) this.#addFile(extra.name, extra.bytes);

    // Add the user's file last; its index is the count of all preloaded
    // files (standards + extras).
    this.#addFile(name, sourceBytes);
    const userIdx = (await this.#getFileCount()) - 1;

    const len = this.#exports.capnpc_compile(userIdx);
    if (len === 0) {
      const errLen = this.#exports.capnpc_get_errors();
      const u8 = this.#u8();
      const outPtr = this.#exports.capnpc_out_ptr();
      const errText = new TextDecoder().decode(u8.slice(outPtr, outPtr + errLen));
      throw new Error(`capnp compile failed:\n${errText || "(no error text)"}`);
    }

    const u8 = this.#u8();
    const outPtr = this.#exports.capnpc_out_ptr();
    return u8.slice(outPtr, outPtr + len);
  }
}

// Map from Cap'n Proto schema type to the canonical type name our codegen
// uses. Primitives map directly; struct/enum refs resolve their name from
// the request's id table. Lists return a structured marker so the
// generator can emit element-type-aware accessors.
function typeToName(t, byId) {
  if (typeof t === "string") return t;  // primitive
  if (t.list) {
    const inner = typeToName(t.list, byId);
    return `List(${inner})`;
  }
  if (t.struct)    return byId.get(String(t.struct))?.name ?? "AnyPointer";
  if (t.enum)      return byId.get(String(t.enum))?.name ?? "UInt16";
  // Interface-typed (capability) fields: tagged so codegen can emit a
  // null-returning getter / null-accepting setter without colliding with
  // a same-named struct. Resolving the cap proper requires an RPC cap
  // table, which non-RPC openers (openDynamic, raw bytes) don't have.
  if (t.interface) {
    const ifaceName = byId.get(String(t.interface))?.name ?? "AnyPointer";
    return `Capability(${ifaceName})`;
  }
  return "AnyPointer";
}

// For the codegen we also need to know whether a struct ref resolves to a
// known struct (so we can emit a typed Reader for it) or is opaque.
function structNameOrNull(t, byId) {
  if (t && t.struct) return byId.get(String(t.struct))?.name ?? null;
  return null;
}

// Bit width for Cap'n Proto data-section primitive types. Used to convert
// slot.offset (which is in units of the type's width) to a bit offset.
const TYPE_WIDTHS = {
  Bool: 1, Int8: 8, UInt8: 8, Int16: 16, UInt16: 16,
  Int32: 32, UInt32: 32, Int64: 64, UInt64: 64,
  Float32: 32, Float64: 64,
};

// Translate a single field into 0..N codegen field entries. Groups produce
// ONE entry of kind "group" pointing at a synthetic nested struct that the
// generator emits its own Reader/Builder class for; this gives the natural
// `r.parent.child` API while still sharing the parent's wire storage.
//
// `synthAccum` is a mutable list the caller passes in to collect synthetic
// nested-struct definitions discovered during translation. The caller
// appends them to the final structs array so they get a Reader class.
function translateField(f, byId, parentName, synthAccum) {
  if (f.slot) {
    const typeName = typeToName(f.slot.type, byId);
    const width = TYPE_WIDTHS[typeName];
    const isPtr = !width;
    return [{
      name: f.name,
      ordinal: f.ordinal,
      type: typeName,
      kind: isPtr ? "pointer" : "data",
      bitOffset: isPtr ? 0 : (f.slot.offset * width),
      bitSize: isPtr ? 0 : width,
      ptrIndex: isPtr ? f.slot.offset : undefined,
      discriminantValue: f.discriminantValue,
    }];
  }
  if (f.group !== undefined) {
    const groupNode = byId.get(String(f.group));
    if (!groupNode) return [];
    // Synthesize a nested Reader/Builder class for the group. Its name is
    // `<Parent>_<groupField>` so it doesn't collide with any user type.
    // It shares wire storage with the parent. Its field offsets are
    // already absolute inside the containing struct (capnp's group layout
    // rule), so generated getters work unchanged.
    const synthName = `${parentName}_${f.name}`;
    const inner = translateStruct(
      { ...groupNode, name: synthName },
      // groupNode's fields are recursively translated, and any of them
      // that are themselves groups will get further synthesized.
      // Pass the accumulator so child synths land in the same array.
      [],
      byId,
      synthAccum,
    );
    synthAccum.push(inner);
    return [{
      name: f.name,
      ordinal: f.ordinal,
      type: synthName,
      kind: "group",
      groupStructName: synthName,
      discriminantValue: f.discriminantValue,
    }];
  }
  return [{ name: f.name, ordinal: f.ordinal, type: "Unknown", bitOffset: 0 }];
}

function translateStruct(s, _unusedAll, byIdParam, synthAccumParam) {
  // First-call public form: translateStruct(s, allStructs). Recursive form:
  // translateStruct(s, [], byId, synthAccum). Detect by argument shape.
  const byId = byIdParam ?? new Map(_unusedAll.map(x => [String(x.id), x]));
  const synthAccum = synthAccumParam ?? [];
  const fields = s.fields.flatMap(f =>
    translateField(f, byId, s.name, synthAccum));
  const result = {
    name: s.name,
    fields,
    dataWords: s.dataWords,
    ptrWords: s.ptrWords,
    discriminantCount: s.discriminantCount,
    discriminantOffsetBits: s.discriminantOffset !== undefined ? s.discriminantOffset * 16 : undefined,
  };
  // If we're being called as the top-level translation of a user struct
  // (no synthAccumParam), append the synthesized group structs to the
  // returned model so they get codegen alongside the parent.
  if (!synthAccumParam && synthAccum.length > 0) {
    result._synthStructs = synthAccum;
  }
  return result;
}
