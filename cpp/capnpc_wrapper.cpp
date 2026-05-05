// Wasm wrapper around the upstream capnp schema compiler. JS hands us
// the source of one .capnp file via a shared scratch buffer; we run the
// compiler against an in-memory filesystem (so all imports resolve to
// schemas we've pre-loaded; no host fs touched), and write the resulting
// CodeGeneratorRequest's bytes back to the same scratch area for JS to
// walk via the schema.capnp Reader.
//
// No CAPNP_BIN, no version skew. The compiler shipped here matches the
// runtime in dist/inlined.mjs because they're built from the same vendor/.

#include <exception>
#include <cstdio>
#include <capnp/compiler/compiler.h>
#include <capnp/compiler/lexer.h>
#include <capnp/compiler/parser.h>
#include <capnp/compiler/grammar.capnp.h>
#include <capnp/compiler/error-reporter.h>
#include <capnp/compiler/module-loader.h>
#include <capnp/schema-loader.h>
#include <capnp/schema.capnp.h>
#include <capnp/serialize.h>
#include <capnp/dynamic.h>
#include <kj/arena.h>
#include <kj/string.h>
#include <kj/vector.h>
#include <kj/exception.h>
#include <cstring>
#include <cstdint>

// Embedded standard schemas (c++.capnp, schema.capnp, etc.); generated
// by cpp/embed_standard_schemas.sh from the vendored .capnp sources, so
// the compiler can serve `import "/capnp/c++.capnp"` etc. without any
// host filesystem access. Critical for browser-side codegen.
#include "standard_schemas.h"

extern "C" {

// Two scratch buffers: input source (and import contents, when JS preloads
// them) and output (the binary CodeGeneratorRequest plus error text).
// Sized at 32 MB so emit-codec / capnpc_compile can handle the materialized
// .capnp text from large OpenAPI corpora (e.g., the Cloudflare public spec
// produces ~5.7 MB of capnp). Each buffer lives in linear memory so the
// total wasm footprint grows by 64 MB but only when the compiler module is
// instantiated (the slim runtime is a separate wasm module and stays at
// ~28 KB brotli).
constexpr size_t CAPNPC_CAP = 32 * 1024 * 1024;
alignas(8) static uint8_t capnpc_in[CAPNPC_CAP];
alignas(8) static uint8_t capnpc_out[CAPNPC_CAP];

uint8_t* capnpc_in_ptr()       { return capnpc_in; }
uint8_t* capnpc_out_ptr()      { return capnpc_out; }
uint32_t capnpc_in_capacity()  { return CAPNPC_CAP; }
uint32_t capnpc_out_capacity() { return CAPNPC_CAP; }

// Track virtual files added via capnpc_add_file. They live in our arena so
// pointers stay valid for the full compile.
struct VFile {
  kj::String name;
  kj::Array<capnp::byte> bytes;
};

// Reset between compiles; JS calls capnpc_reset() before staging the next
// schema.
static kj::Maybe<kj::Own<kj::Arena>> g_arena;
static kj::Vector<VFile>* g_files = nullptr;
static kj::Vector<kj::String>* g_errors = nullptr;

static kj::Arena& ensureArena() {
  KJ_IF_SOME(a, g_arena) { return *a; }
  g_arena = kj::heap<kj::Arena>();
  KJ_IF_SOME(a, g_arena) {
    g_files = &a->allocate<kj::Vector<VFile>>();
    g_errors = &a->allocate<kj::Vector<kj::String>>();
    return *a;
  }
  KJ_UNREACHABLE;
}

// Pre-load every embedded standard schema into g_files. Called from
// capnpc_reset() so each compile session starts with the standard imports
// already resolvable.
static void preloadStandardSchemas() {
  for (size_t i = 0; i < STANDARD_SCHEMA_COUNT; i++) {
    auto& s = STANDARD_SCHEMAS[i];
    auto bytes = kj::heapArray<capnp::byte>(s.len);
    std::memcpy(bytes.begin(), s.content, s.len);
    g_files->add(VFile { kj::heapString(s.name), kj::mv(bytes) });
  }
}

void capnpc_reset() {
  g_arena = kj::none;
  g_files = nullptr;
  g_errors = nullptr;
  // Re-initialize and pre-load standards. Safe to call from JS for every
  // compile cycle.
  ensureArena();
  preloadStandardSchemas();
}

// JS calls this once per file the compiler may import (including the root).
// The bytes for `name` are pre-staged in capnpc_in[0..len].
uint32_t capnpc_add_file(const char* name, uint32_t name_len, uint32_t src_len) {
  ensureArena();
  kj::String fname = kj::heapString(kj::ArrayPtr<const char>(name, name_len));
  auto bytes = kj::heapArray<capnp::byte>(src_len);
  std::memcpy(bytes.begin(), capnpc_in, src_len);
  g_files->add(VFile { kj::mv(fname), kj::mv(bytes) });
  return 1;
}

// In-memory module loader / error reporter / source. We implement the
// minimum capnp::compiler::Module interface needed to serve files we
// previously registered via capnpc_add_file, and forward all errors to a
// string buffer JS can read.

class JsErrorReporter : public capnp::compiler::ErrorReporter {
public:
  void addError(uint32_t startByte, uint32_t endByte, kj::StringPtr message) override {
    g_errors->add(kj::str(startByte, "-", endByte, ": ", message));
  }
  bool hadErrors() override { return g_errors->size() > 0; }
};

class JsModule : public capnp::compiler::Module {
public:
  JsModule(VFile& f, JsErrorReporter& er) : file(f), reporter(er) {}

  kj::StringPtr getSourceName() override { return file.name; }

  capnp::Orphan<capnp::compiler::ParsedFile> loadContent(capnp::Orphanage orphanage) override {
    auto src = kj::heapString(kj::ArrayPtr<const char>(
        reinterpret_cast<const char*>(file.bytes.begin()), file.bytes.size()));
    capnp::MallocMessageBuilder lexed;
    auto lexedRoot = lexed.initRoot<capnp::compiler::LexedStatements>();
    if (!capnp::compiler::lex(src, lexedRoot, reporter)) {
      return orphanage.newOrphan<capnp::compiler::ParsedFile>();
    }
    auto parsed = orphanage.newOrphan<capnp::compiler::ParsedFile>();
    capnp::compiler::parseFile(
        lexedRoot.asReader().getStatements(), parsed.get(), reporter, false);
    return parsed;
  }

  kj::Maybe<capnp::compiler::Module&> importRelative(kj::StringPtr importPath) override {
    for (auto& f : *g_files) {
      kj::StringPtr trimmed = importPath;
      if (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
      if (kj::StringPtr(f.name) == importPath || kj::StringPtr(f.name) == trimmed) {
        return ensureArena().allocate<JsModule>(f, reporter);
      }
    }
    return kj::none;
  }

  kj::Maybe<kj::Array<const capnp::byte>> embedRelative(kj::StringPtr embedPath) override {
    // Not supported in wasm; we'd need host fs access. Embeds are rare;
    // user can avoid by inlining the data into the schema.
    return kj::none;
  }

  void addError(uint32_t startByte, uint32_t endByte, kj::StringPtr message) override {
    reporter.addError(startByte, endByte, message);
  }
  bool hadErrors() override { return reporter.hadErrors(); }

private:
  VFile& file;
  JsErrorReporter& reporter;
};

// Run the compiler over the file at index `root_idx` (typically 0 = the
// last-added is the root, but JS picks). Writes the resulting
// CodeGeneratorRequest bytes to capnpc_out and returns the byte count.
// Returns 0 on error; JS can read errors via capnpc_get_errors().
uint32_t capnpc_compile(uint32_t root_idx) {
  if (!g_files || root_idx >= g_files->size()) return 0;
  ensureArena();

  JsErrorReporter reporter;
  auto& rootFile = (*g_files)[root_idx];
  auto& rootModule = ensureArena().allocate<JsModule>(rootFile, reporter);

  // capnp::compiler::Compiler can throw on hard errors (e.g. generic
  // parameter constraints, malformed AST). Catch them so the JS side gets a
  // typed error string instead of a wasm trap.
  try {
    capnp::compiler::Compiler compiler{};
    uint64_t rootId = compiler.add(rootModule).getId();
    compiler.eagerlyCompile(rootId, capnp::compiler::Compiler::ALL_RELATED_NODES);

    if (reporter.hadErrors()) return 0;

    // Emit CodeGeneratorRequest containing the root's compiled schema.
    auto requestSchemas = compiler.getLoader().getAllLoaded();
    capnp::MallocMessageBuilder mb;
    auto request = mb.initRoot<capnp::schema::CodeGeneratorRequest>();
    auto nodes = request.initNodes(requestSchemas.size());
    for (size_t i = 0; i < requestSchemas.size(); i++) {
      nodes.setWithCaveats(i, requestSchemas[i].getProto());
    }
    // Mark the root file as "requested" so JS-side codegen knows where to start.
    auto requested = request.initRequestedFiles(1);
    auto rf = requested[0];
    rf.setId(rootId);
    rf.setFilename(rootFile.name);

    auto words = capnp::messageToFlatArray(mb);
    auto bytes = words.asBytes();
    if (bytes.size() > CAPNPC_CAP) return 0;
    std::memcpy(capnpc_out, bytes.begin(), bytes.size());
    return static_cast<uint32_t>(bytes.size());
  } catch (kj::Exception& e) {
    reporter.addError(0, 0, e.getDescription());
    return 0;
  } catch (std::exception& e) {
    reporter.addError(0, 0, kj::heapString(e.what() ? e.what() : "std::exception"));
    return 0;
  } catch (...) {
    reporter.addError(0, 0, kj::StringPtr("capnpc_compile: unknown C++ exception"));
    return 0;
  }
}

// Concatenate any errors emitted during the last compile, separated by '\n'.
// Writes to capnpc_out and returns byte count.
uint32_t capnpc_get_errors() {
  if (!g_errors || g_errors->size() == 0) return 0;
  size_t total = 0;
  for (auto& e : *g_errors) total += e.size() + 1;
  if (total > CAPNPC_CAP) total = CAPNPC_CAP;
  uint8_t* p = capnpc_out;
  uint8_t* end = capnpc_out + CAPNPC_CAP;
  for (auto& e : *g_errors) {
    size_t n = e.size();
    if (p + n + 1 > end) break;
    std::memcpy(p, e.cStr(), n);
    p[n] = '\n';
    p += n + 1;
  }
  return static_cast<uint32_t>(p - capnpc_out);
}

// Walk the CodeGeneratorRequest currently in capnpc_in (caller copies the
// bytes it got from capnpc_compile back into capnpc_in with a 4-byte LE
// length prefix at offset 0) and emit a JSON model of struct definitions
// that JS-side codegen can consume directly. The format intentionally
// matches the model parseTsInterfaces / parseRawCapnp would produce, so
// the downstream generator is identical regardless of source.
//
// Emitted JSON shape:
// [
//   { "name": "User", "id": <uint64>,
//     "dataWords": N, "ptrWords": M,
//     "fields": [
//       { "name": "id", "ordinal": 0, "codeOrder": 0,
//         "slot": { "offset": 0, "type": "UInt64" } },
//       ...
//   ]}, ...
// ]

static const char* primitiveTypeName(capnp::schema::Type::Which w) {
  using W = capnp::schema::Type::Which;
  switch (w) {
    case W::VOID:    return "Void";
    case W::BOOL:    return "Bool";
    case W::INT8:    return "Int8";
    case W::INT16:   return "Int16";
    case W::INT32:   return "Int32";
    case W::INT64:   return "Int64";
    case W::UINT8:   return "UInt8";
    case W::UINT16:  return "UInt16";
    case W::UINT32:  return "UInt32";
    case W::UINT64:  return "UInt64";
    case W::FLOAT32: return "Float32";
    case W::FLOAT64: return "Float64";
    case W::TEXT:    return "Text";
    case W::DATA:    return "Data";
    // ANY_POINTER deliberately omitted: appendTypeJson handles it
    // separately so it can distinguish unconstrained AnyPointer from a
    // generic parameter reference (which carries scopeId + index for
    // brand resolution).
    default: return nullptr;
  }
}

// Append a JSON string with proper escaping.
static void appendJsonString(kj::Vector<char>& out, kj::StringPtr s) {
  out.add('"');
  for (size_t i = 0; i < s.size(); i++) {
    char c = s[i];
    switch (c) {
      case '"':  out.addAll(kj::StringPtr("\\\"")); break;
      case '\\': out.addAll(kj::StringPtr("\\\\")); break;
      case '\n': out.addAll(kj::StringPtr("\\n"));  break;
      case '\r': out.addAll(kj::StringPtr("\\r"));  break;
      case '\t': out.addAll(kj::StringPtr("\\t"));  break;
      default:
        if ((unsigned char)c < 0x20) {
          auto hex = kj::str("\\u00", kj::hex((uint8_t)c));
          out.addAll(kj::ArrayPtr<const char>(hex.cStr(), hex.size()));
        } else {
          out.add(c);
        }
    }
  }
  out.add('"');
}

static void appendUint(kj::Vector<char>& out, uint64_t v) {
  auto s = kj::str(v);
  out.addAll(kj::ArrayPtr<const char>(s.cStr(), s.size()));
}

// JS Number can only safely represent u53; capnp interface/struct IDs are
// 64-bit hashes that routinely exceed that. Emit u64 as a decimal STRING
// so the JS side can BigInt() it without precision loss. Forward-declared
// here so callers earlier in the file can use it.
static void appendU64Str(kj::Vector<char>& out, uint64_t v) {
  out.add('"');
  auto s = kj::str(v);
  out.addAll(kj::ArrayPtr<const char>(s.cStr(), s.size()));
  out.add('"');
}

// Walk one Type Reader and append a JSON value (string for primitives /
// special tokens like {"struct": id} for struct refs).
// Forward decl: brand emission walks back into appendTypeJson for each
// binding, since brand bindings are themselves Type values (which may
// be parameterized struct refs in turn).
static void appendBrandJson(kj::Vector<char>& out, capnp::schema::Brand::Reader brand);

static void appendTypeJson(kj::Vector<char>& out, capnp::schema::Type::Reader t) {
  using W = capnp::schema::Type::Which;
  W w = t.which();
  const char* p = primitiveTypeName(w);
  if (p) { out.add('"'); out.addAll(kj::StringPtr(p)); out.add('"'); return; }
  if (w == W::LIST) {
    out.addAll(kj::StringPtr("{\"list\":"));
    appendTypeJson(out, t.getList().getElementType());
    out.add('}');
    return;
  }
  if (w == W::STRUCT) {
    // Type IDs are 64-bit hashes that exceed JS Number's 2^53 precision,
    // so emit them as decimal STRINGS. JS-side byId resolution stringifies
    // ids consistently and avoids silent precision-loss collisions.
    auto sref = t.getStruct();
    out.addAll(kj::StringPtr("{\"struct\":"));
    appendU64Str(out, sref.getTypeId());
    auto brand = sref.getBrand();
    if (brand.getScopes().size() > 0) {
      out.addAll(kj::StringPtr(",\"brand\":"));
      appendBrandJson(out, brand);
    }
    out.add('}');
    return;
  }
  if (w == W::ENUM) {
    out.addAll(kj::StringPtr("{\"enum\":"));
    appendU64Str(out, t.getEnum().getTypeId());
    out.add('}');
    return;
  }
  if (w == W::INTERFACE) {
    auto iref = t.getInterface();
    out.addAll(kj::StringPtr("{\"interface\":"));
    appendU64Str(out, iref.getTypeId());
    auto brand = iref.getBrand();
    if (brand.getScopes().size() > 0) {
      out.addAll(kj::StringPtr(",\"brand\":"));
      appendBrandJson(out, brand);
    }
    out.add('}');
    return;
  }
  if (w == W::ANY_POINTER) {
    auto ap = t.getAnyPointer();
    if (ap.isParameter()) {
      // Generic parameter reference. Codegen needs the (scopeId,
      // parameterIndex) pair to resolve the binding via the surrounding
      // brand context when synthesizing a specialized struct.
      auto pp = ap.getParameter();
      out.addAll(kj::StringPtr("{\"parameter\":{\"scopeId\":"));
      appendU64Str(out, pp.getScopeId());
      out.addAll(kj::StringPtr(",\"index\":"));
      appendUint(out, pp.getParameterIndex());
      out.addAll(kj::StringPtr("}}"));
      return;
    }
    if (ap.isImplicitMethodParameter()) {
      // Method-level generic parameter — rare; treat as opaque
      // AnyPointer for now (codegen returns the bytes-handle).
      out.addAll(kj::StringPtr("\"AnyPointer\""));
      return;
    }
    // Unconstrained AnyPointer (`:AnyPointer` with no specialization).
    out.addAll(kj::StringPtr("\"AnyPointer\""));
    return;
  }
  out.addAll(kj::StringPtr("\"Unknown\""));
}

// Emit a Brand as JSON. Shape:
//   {"scopes":[{"scopeId":"...","bind":[{"type":<Type>}|{"unbound":true}]}]}
// Used when a parameterized struct/interface reference carries explicit
// bindings (e.g. `Box(Tag)` -> brand binds Box's parameter 0 to Tag).
static void appendBrandJson(kj::Vector<char>& out, capnp::schema::Brand::Reader brand) {
  out.addAll(kj::StringPtr("{\"scopes\":["));
  bool firstScope = true;
  for (auto scope : brand.getScopes()) {
    if (!firstScope) out.add(',');
    firstScope = false;
    out.addAll(kj::StringPtr("{\"scopeId\":"));
    appendU64Str(out, scope.getScopeId());
    if (scope.isBind()) {
      out.addAll(kj::StringPtr(",\"bind\":["));
      bool firstBind = true;
      for (auto b : scope.getBind()) {
        if (!firstBind) out.add(',');
        firstBind = false;
        if (b.isType()) {
          out.addAll(kj::StringPtr("{\"type\":"));
          appendTypeJson(out, b.getType());
          out.add('}');
        } else {
          out.addAll(kj::StringPtr("{\"unbound\":true}"));
        }
      }
      out.add(']');
    } else if (scope.isInherit()) {
      out.addAll(kj::StringPtr(",\"inherit\":true"));
    }
    out.add('}');
  }
  out.addAll(kj::StringPtr("]}"));
}

// Build a short name from the displayName by taking the last component
// after the last '.' / ':' / '/'. e.g. "user.capnp:User" -> "User".
static kj::String shortNameOf(kj::StringPtr displayName) {
  size_t last = 0;
  for (size_t i = 0; i < displayName.size(); i++) {
    char c = displayName[i];
    if (c == '.' || c == ':' || c == '/') last = i + 1;
  }
  return kj::heapString(displayName.slice(last));
}

uint32_t capnpc_extract_structs() {
  // Wrap in try/catch so a malformed CodeGeneratorRequest (e.g. from a
  // schema with bad generic bindings caught only at validation time)
  // surfaces as a return-0 + error string the JS side can read via
  // capnpc_get_errors, instead of an uncaught WebAssembly.Exception.
  try {
  // Read length prefix from start of capnpc_in.
  uint32_t reqLen;
  std::memcpy(&reqLen, capnpc_in, 4);
  if (reqLen + 4 > CAPNPC_CAP) return 0;
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(capnpc_in + 4),
      reqLen / sizeof(capnp::word));

  capnp::FlatArrayMessageReader reader(words);
  auto req = reader.getRoot<capnp::schema::CodeGeneratorRequest>();

  kj::Vector<char> out(8192);
  out.add('[');
  bool firstStruct = true;
  for (auto node : req.getNodes()) {
    if (!node.isStruct()) continue;
    auto sn = node.getStruct();
    if (sn.getIsGroup()) continue;  // groups emitted as nested fields under their parent
    if (!firstStruct) out.add(',');
    firstStruct = false;
    out.add('{');
    out.addAll(kj::StringPtr("\"name\":"));
    appendJsonString(out, shortNameOf(node.getDisplayName()));
    out.addAll(kj::StringPtr(",\"id\":"));
    appendU64Str(out, node.getId());
    out.addAll(kj::StringPtr(",\"dataWords\":"));
    appendUint(out, sn.getDataWordCount());
    out.addAll(kj::StringPtr(",\"ptrWords\":"));
    appendUint(out, sn.getPointerCount());
    // Union info: discriminantCount > 0 means this struct has a union.
    // discriminantOffset is the byte offset of the discriminant inside the
    // data section (in u16 units per the schema, but we surface bytes).
    if (sn.getDiscriminantCount() > 0) {
      out.addAll(kj::StringPtr(",\"discriminantCount\":"));
      appendUint(out, sn.getDiscriminantCount());
      out.addAll(kj::StringPtr(",\"discriminantOffset\":"));
      appendUint(out, sn.getDiscriminantOffset());  // in u16 units
    }
    out.addAll(kj::StringPtr(",\"fields\":["));
    bool firstField = true;
    for (auto f : sn.getFields()) {
      if (!firstField) out.add(',');
      firstField = false;
      out.add('{');
      out.addAll(kj::StringPtr("\"name\":"));
      appendJsonString(out, f.getName());
      out.addAll(kj::StringPtr(",\"ordinal\":"));
      appendUint(out, f.getOrdinal().getExplicit());
      out.addAll(kj::StringPtr(",\"codeOrder\":"));
      appendUint(out, f.getCodeOrder());
      // Union membership: discriminantValue != 0xffff means this field is
      // part of the parent's union, with the given variant value.
      uint16_t dv = f.getDiscriminantValue();
      if (dv != 0xffff) {
        out.addAll(kj::StringPtr(",\"discriminantValue\":"));
        appendUint(out, dv);
      }
      if (f.isSlot()) {
        auto slot = f.getSlot();
        out.addAll(kj::StringPtr(",\"slot\":{\"offset\":"));
        appendUint(out, slot.getOffset());
        out.addAll(kj::StringPtr(",\"type\":"));
        appendTypeJson(out, slot.getType());
        out.add('}');
      } else if (f.isGroup()) {
        out.addAll(kj::StringPtr(",\"group\":"));
        appendU64Str(out, f.getGroup().getTypeId());
      }
      out.add('}');
    }
    out.addAll(kj::StringPtr("]}"));
  }
  // Also emit group structs (isGroup=true) so the JS-side translator can
  // look them up by id when expanding group fields. They're tagged with
  // "isGroup": true and share their parent's storage layout.
  for (auto node : req.getNodes()) {
    if (!node.isStruct()) continue;
    auto sn = node.getStruct();
    if (!sn.getIsGroup()) continue;
    out.add(',');
    out.add('{');
    out.addAll(kj::StringPtr("\"name\":"));
    appendJsonString(out, shortNameOf(node.getDisplayName()));
    out.addAll(kj::StringPtr(",\"id\":"));
    appendU64Str(out, node.getId());
    out.addAll(kj::StringPtr(",\"isGroup\":true"));
    out.addAll(kj::StringPtr(",\"dataWords\":"));
    appendUint(out, sn.getDataWordCount());
    out.addAll(kj::StringPtr(",\"ptrWords\":"));
    appendUint(out, sn.getPointerCount());
    if (sn.getDiscriminantCount() > 0) {
      out.addAll(kj::StringPtr(",\"discriminantCount\":"));
      appendUint(out, sn.getDiscriminantCount());
      out.addAll(kj::StringPtr(",\"discriminantOffset\":"));
      appendUint(out, sn.getDiscriminantOffset());
    }
    out.addAll(kj::StringPtr(",\"fields\":["));
    bool firstField = true;
    for (auto f : sn.getFields()) {
      if (!firstField) out.add(',');
      firstField = false;
      out.add('{');
      out.addAll(kj::StringPtr("\"name\":"));
      appendJsonString(out, f.getName());
      out.addAll(kj::StringPtr(",\"ordinal\":"));
      appendUint(out, f.getOrdinal().getExplicit());
      out.addAll(kj::StringPtr(",\"codeOrder\":"));
      appendUint(out, f.getCodeOrder());
      uint16_t dv = f.getDiscriminantValue();
      if (dv != 0xffff) {
        out.addAll(kj::StringPtr(",\"discriminantValue\":"));
        appendUint(out, dv);
      }
      if (f.isSlot()) {
        auto slot = f.getSlot();
        out.addAll(kj::StringPtr(",\"slot\":{\"offset\":"));
        appendUint(out, slot.getOffset());
        out.addAll(kj::StringPtr(",\"type\":"));
        appendTypeJson(out, slot.getType());
        out.add('}');
      } else if (f.isGroup()) {
        out.addAll(kj::StringPtr(",\"group\":"));
        appendU64Str(out, f.getGroup().getTypeId());
      }
      out.add('}');
    }
    out.addAll(kj::StringPtr("]}"));
  }
  out.add(']');
  if ((uint32_t)out.size() > CAPNPC_CAP) return 0;
  std::memcpy(capnpc_out, out.begin(), out.size());
  return static_cast<uint32_t>(out.size());
  } catch (kj::Exception& e) {
    if (g_errors) g_errors->add(kj::str("0-0: ", e.getDescription()));
    return 0;
  } catch (...) {
    if (g_errors) g_errors->add(kj::heapString("0-0: capnpc_extract_structs: unknown C++ exception"));
    return 0;
  }
}

// Extract interface metadata from the buffered CodeGeneratorRequest. Emits a
// JSON array of interfaces; each method's ordinal is its index in the
// methods list (the same convention the runtime uses on the wire).
//
// Output shape per interface:
//   { "name":"Echo", "id":"<decimal u64>", "methods":[
//       { "id":0, "name":"echo",
//         "paramStructId":"<decimal u64>",
//         "resultStructId":"<decimal u64>" }, ...
//   ]}
// The u64 fields are quoted strings so JS BigInt(s) reads them losslessly.
uint32_t capnpc_extract_interfaces() {
  // Same try/catch story as capnpc_extract_structs: a malformed
  // CodeGeneratorRequest can throw kj::Exception during validation; we
  // surface it via g_errors instead of letting it cross into JS as
  // an uncaught WebAssembly.Exception.
  try {
  uint32_t reqLen;
  std::memcpy(&reqLen, capnpc_in, 4);
  if (reqLen + 4 > CAPNPC_CAP) return 0;
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(capnpc_in + 4),
      reqLen / sizeof(capnp::word));

  capnp::FlatArrayMessageReader reader(words);
  auto req = reader.getRoot<capnp::schema::CodeGeneratorRequest>();

  kj::Vector<char> out(4096);
  out.add('[');
  bool firstIface = true;
  for (auto node : req.getNodes()) {
    if (!node.isInterface()) continue;
    if (!firstIface) out.add(',');
    firstIface = false;
    out.add('{');
    out.addAll(kj::StringPtr("\"name\":"));
    appendJsonString(out, shortNameOf(node.getDisplayName()));
    out.addAll(kj::StringPtr(",\"id\":"));
    appendU64Str(out, node.getId());
    out.addAll(kj::StringPtr(",\"methods\":["));
    auto in = node.getInterface();
    bool firstMethod = true;
    uint32_t methodOrdinal = 0;
    for (auto method : in.getMethods()) {
      if (!firstMethod) out.add(',');
      firstMethod = false;
      out.add('{');
      out.addAll(kj::StringPtr("\"id\":"));
      appendUint(out, methodOrdinal++);
      out.addAll(kj::StringPtr(",\"name\":"));
      appendJsonString(out, method.getName());
      out.addAll(kj::StringPtr(",\"paramStructId\":"));
      appendU64Str(out, method.getParamStructType());
      out.addAll(kj::StringPtr(",\"resultStructId\":"));
      appendU64Str(out, method.getResultStructType());
      out.add('}');
    }
    out.addAll(kj::StringPtr("]}"));
  }
  out.add(']');
  if ((uint32_t)out.size() > CAPNPC_CAP) return 0;
  std::memcpy(capnpc_out, out.begin(), out.size());
  return static_cast<uint32_t>(out.size());
  } catch (kj::Exception& e) {
    if (g_errors) g_errors->add(kj::str("0-0: ", e.getDescription()));
    return 0;
  } catch (...) {
    if (g_errors) g_errors->add(kj::heapString("0-0: capnpc_extract_interfaces: unknown C++ exception"));
    return 0;
  }
}

}  // extern "C"
