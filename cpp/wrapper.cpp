// C-ABI wrapper exposing real capnproto C++ serialize/deserialize to JS.
// Linked statically with capnp + kj source via `zig cc`, no emscripten.

#include "schema.capnp.h"
#include "typed_schema.capnp.h"
#include "big_schema.capnp.h"
#include "conformance_schema.capnp.h"
#include "vendor/capnp/rpc.capnp.h"
#include <capnp/serialize.h>
#include <capnp/message.h>
#include <capnp/any.h>
#include <kj/array.h>
#include <kj/io.h>
#include <cstring>
#include <cstdint>
#include <cstdio>
#include <new>
#include <cstdlib>

// Note: __cxa_allocate_exception and __cxa_throw are provided by linking
// zig's libcxxabi cxa_exception.cpp directly into the build (see build.sh).

extern "C" {

// Scratch regions in linear memory shared with JS. 4 MB each; enough for
// most realistic RPC payloads (gRPC's default max-message size is also
// 4 MB). Anything bigger should be chunked at the application layer or
// streamed via openFromStream.
constexpr size_t SCRATCH_CAP = 4 * 1024 * 1024;
alignas(8) static uint8_t cpp_in[SCRATCH_CAP];
alignas(8) static uint8_t cpp_out[SCRATCH_CAP];

// Auxiliary scratch region for boundary-call request payloads (e.g. the
// field-descriptor list passed to cpp_any_batch_read). Separate from cpp_in
// so the request encoding does not clobber the parsed message that the
// reader is pointing at. Originally named "lazy_aux" because LazyReader
// used it; that reader was removed in 0.0.4 but the scratch region is now
// the canonical batch-read input buffer used by every generated reader.
constexpr size_t SCRATCH_AUX_CAP = 8 * 1024;
alignas(8) static uint8_t cpp_scratch_aux[SCRATCH_AUX_CAP];

uint8_t* cpp_in_ptr() { return cpp_in; }
uint8_t* cpp_out_ptr() { return cpp_out; }
uint32_t cpp_in_capacity() { return SCRATCH_CAP; }
uint32_t cpp_out_capacity() { return SCRATCH_CAP; }
uint8_t* cpp_scratch_aux_ptr() { return cpp_scratch_aux; }
uint32_t cpp_scratch_aux_capacity() { return SCRATCH_AUX_CAP; }

uint32_t cpp_abi_version() { return 1; }

uint8_t* cpp_msg_alloc(uint32_t bytes_len) {
  // Cap'n Proto messages are word-addressed. Align allocations so C++ can
  // safely reinterpret the region as capnp::word[] and JS can still address
  // it as bytes through WebAssembly.Memory.
  size_t n = (static_cast<size_t>(bytes_len) + 7u) & ~static_cast<size_t>(7u);
  if (n == 0) n = 8;
  return reinterpret_cast<uint8_t*>(std::malloc(n));
}

void cpp_msg_free(uint8_t* ptr) {
  std::free(ptr);
}

// Serialize a tape (in cpp_in[0..tape_len], same byte format as src/tape.zig)
// to a Cap'n Proto framed message in cpp_out. Returns bytes written, or 0
// on failure.
//
// Tape grammar mirrors src/tape.zig: u8 msg_tag, then per-tag args.
struct TapeReader {
  const uint8_t* p;
  const uint8_t* end;
  uint8_t u8() { return *p++; }
  uint32_t u32() {
    uint32_t v;
    std::memcpy(&v, p, 4); p += 4; return v;
  }
  int64_t i64() {
    int64_t v;
    std::memcpy(&v, p, 8); p += 8; return v;
  }
  double f64() {
    double v;
    std::memcpy(&v, p, 8); p += 8; return v;
  }
  kj::ArrayPtr<const uint8_t> bytes(uint32_t n) {
    auto out = kj::ArrayPtr<const uint8_t>(p, n);
    p += n;
    return out;
  }
  kj::StringPtr text(uint32_t n) {
    auto out = kj::StringPtr(reinterpret_cast<const char*>(p), n);
    p += n;
    return out;
  }
};

static void encodeExpression(Expression::Builder b, TapeReader& r);

static void encodeExpression(Expression::Builder b, TapeReader& r) {
  uint8_t tag = r.u8();
  switch (tag) {
    case 0x00: b.setNullVal(); break;
    case 0x01: b.setBoolTrue(); break;
    case 0x02: b.setBoolFalse(); break;
    case 0x03: b.setIntVal(r.i64()); break;
    case 0x04: b.setFloatVal(r.f64()); break;
    case 0x05: {
      uint32_t len = r.u32();
      b.setText(r.text(len));
      break;
    }
    case 0x06: {
      uint32_t len = r.u32();
      b.setData(r.bytes(len));
      break;
    }
    case 0x07: b.setDate(r.f64()); break;
    case 0x08: {
      uint32_t len = r.u32();
      b.setBigint(r.text(len));
      break;
    }
    case 0x09: b.setUndefinedVal(); break;
    case 0x10: {
      uint32_t count = r.u32();
      auto list = b.initArray(count);
      for (uint32_t i = 0; i < count; i++) encodeExpression(list[i], r);
      break;
    }
    case 0x11: {
      uint32_t count = r.u32();
      auto list = b.initObject(count);
      for (uint32_t i = 0; i < count; i++) {
        uint32_t klen = r.u32();
        auto kv = list[i];
        kv.setKey(r.text(klen));
        encodeExpression(kv.initValue(), r);
      }
      break;
    }
    case 0x20: b.setImportRef(r.i64()); break;
    case 0x21: b.setExportRef(r.i64()); break;
    case 0x22: {
      auto pl = b.initPipeline();
      encodeExpression(pl.initSource(), r);
      uint32_t pcount = r.u32();
      auto path = pl.initPath(pcount);
      for (uint32_t i = 0; i < pcount; i++) {
        uint32_t klen = r.u32();
        path.set(i, r.text(klen));
      }
      uint8_t hasArgs = r.u8();
      if (hasArgs) encodeExpression(pl.initArgs(), r);
      break;
    }
    case 0x23: {
      auto e = b.initErrorVal();
      uint32_t tlen = r.u32(); e.setType(r.text(tlen));
      uint32_t mlen = r.u32(); e.setMessage(r.text(mlen));
      break;
    }
    default: b.setNullVal(); break;
  }
}

uint32_t cpp_serialize_tape(uint32_t tape_len) {
  TapeReader r{cpp_in, cpp_in + tape_len};

  capnp::MallocMessageBuilder builder;
  auto msg = builder.initRoot<Message>();
  uint8_t mtag = r.u8();
  switch (mtag) {
    case 0: encodeExpression(msg.initPush(), r); break;
    case 1: msg.setPull(r.i64()); break;
    case 2: {
      auto rr = msg.initResolve();
      rr.setId(r.i64());
      encodeExpression(rr.initExpr(), r);
      break;
    }
    case 3: {
      auto rr = msg.initReject();
      rr.setId(r.i64());
      encodeExpression(rr.initExpr(), r);
      break;
    }
    case 4: {
      auto rel = msg.initRelease();
      rel.setId(r.i64());
      rel.setRefcount(r.u32());
      break;
    }
    case 5: encodeExpression(msg.initStream(), r); break;
    case 6: encodeExpression(msg.initAbort(), r); break;
    case 7: msg.setPipe(); break;
    default: return 0;
  }

  // Serialize to a flat array, then copy into cpp_out.
  auto words = capnp::messageToFlatArray(builder);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

// Decode framed Cap'n Proto bytes (in cpp_in[0..len]) and emit a tape
// (same format) into cpp_out. Returns tape bytes, or 0 on failure.
struct TapeWriter {
  uint8_t* p;
  uint8_t* end;
  void u8(uint8_t v) { *p++ = v; }
  void u32(uint32_t v) { std::memcpy(p, &v, 4); p += 4; }
  void i64(int64_t v) { std::memcpy(p, &v, 8); p += 8; }
  void f64(double v) { std::memcpy(p, &v, 8); p += 8; }
  void writeText(kj::StringPtr s) {
    u32(static_cast<uint32_t>(s.size()));
    std::memcpy(p, s.cStr(), s.size()); p += s.size();
  }
  void writeData(kj::ArrayPtr<const uint8_t> b) {
    u32(static_cast<uint32_t>(b.size()));
    std::memcpy(p, b.begin(), b.size()); p += b.size();
  }
};

static void decodeExpression(Expression::Reader r, TapeWriter& w);

static void decodeExpression(Expression::Reader r, TapeWriter& w) {
  switch (r.which()) {
    case Expression::NULL_VAL: w.u8(0x00); break;
    case Expression::BOOL_TRUE: w.u8(0x01); break;
    case Expression::BOOL_FALSE: w.u8(0x02); break;
    case Expression::INT_VAL: w.u8(0x03); w.i64(r.getIntVal()); break;
    case Expression::FLOAT_VAL: w.u8(0x04); w.f64(r.getFloatVal()); break;
    case Expression::TEXT: w.u8(0x05); w.writeText(r.getText()); break;
    case Expression::DATA: w.u8(0x06); w.writeData(r.getData()); break;
    case Expression::DATE: w.u8(0x07); w.f64(r.getDate()); break;
    case Expression::BIGINT: w.u8(0x08); w.writeText(r.getBigint()); break;
    case Expression::UNDEFINED_VAL: w.u8(0x09); break;
    case Expression::ARRAY: {
      auto list = r.getArray();
      w.u8(0x10);
      w.u32(list.size());
      for (auto e : list) decodeExpression(e, w);
      break;
    }
    case Expression::OBJECT: {
      auto list = r.getObject();
      w.u8(0x11);
      w.u32(list.size());
      for (auto kv : list) {
        w.writeText(kv.getKey());
        decodeExpression(kv.getValue(), w);
      }
      break;
    }
    case Expression::IMPORT_REF: w.u8(0x20); w.i64(r.getImportRef()); break;
    case Expression::EXPORT_REF: w.u8(0x21); w.i64(r.getExportRef()); break;
    case Expression::PIPELINE: {
      auto pl = r.getPipeline();
      w.u8(0x22);
      decodeExpression(pl.getSource(), w);
      auto path = pl.getPath();
      w.u32(path.size());
      for (auto seg : path) w.writeText(seg);
      if (pl.hasArgs()) { w.u8(1); decodeExpression(pl.getArgs(), w); }
      else { w.u8(0); }
      break;
    }
    case Expression::ERROR_VAL: {
      auto e = r.getErrorVal();
      w.u8(0x23);
      w.writeText(e.getType());
      w.writeText(e.getMessage());
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Lazy reader: parse the message once, then JS pulls individual fields on
// demand. This is the access pattern Cap'n Proto's wire format is designed
// for; skip materializing the whole tree, fetch only what's read.
// ---------------------------------------------------------------------------

// Heap-allocated reader so its lifetime spans many cpp_lazy_* calls.
// Cleared on each cpp_lazy_open. Uses MallocMessageBuilder's allocator
// indirectly via FlatArrayMessageReader (which is a value-type).
alignas(8) static char lazy_reader_storage[1024];
static capnp::FlatArrayMessageReader* lazy_reader = nullptr;

uint32_t cpp_lazy_open_at(const uint8_t* bytes_ptr, uint32_t bytes_len) {
  if (lazy_reader) {
    lazy_reader->~FlatArrayMessageReader();
    lazy_reader = nullptr;
  }
  static_assert(sizeof(capnp::FlatArrayMessageReader) <= sizeof(lazy_reader_storage),
                "lazy_reader_storage too small");
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(bytes_ptr),
      bytes_len / sizeof(capnp::word));
  lazy_reader = new (lazy_reader_storage) capnp::FlatArrayMessageReader(words);
  return 1;
}

uint32_t cpp_lazy_open(uint32_t bytes_len) {
  return cpp_lazy_open_at(cpp_in, bytes_len);
}

// Helper: extract the inner Expression payload from a Message reader.
static bool extractExpr(Expression::Reader& out, Message::Reader msg) {
  switch (msg.which()) {
    case Message::PUSH:    out = msg.getPush(); return true;
    case Message::RESOLVE: out = msg.getResolve().getExpr(); return true;
    case Message::REJECT:  out = msg.getReject().getExpr(); return true;
    case Message::STREAM:  out = msg.getStream(); return true;
    case Message::ABORT:   out = msg.getAbort(); return true;
    default: return false;
  }
}

// For a push/resolve/reject/stream/abort message whose payload is an Object,
// look up the named field's text value. Copies it to cpp_out. Returns the
// number of bytes written, 0 if not found / not text.
uint32_t cpp_lazy_msg_obj_field_text(const uint8_t* name_ptr, uint32_t name_len) {
  if (!lazy_reader) return 0;
  auto msg = lazy_reader->getRoot<Message>();
  Expression::Reader expr;
  if (!extractExpr(expr, msg)) return 0;
  if (!expr.isObject()) return 0;

  auto target = kj::StringPtr(reinterpret_cast<const char*>(name_ptr), name_len);
  for (auto kv : expr.getObject()) {
    if (kv.getKey() == target) {
      auto val = kv.getValue();
      if (!val.isText()) return 0;
      auto text = val.getText();
      if (text.size() > SCRATCH_CAP) return 0;
      std::memcpy(cpp_out, text.cStr(), text.size());
      return static_cast<uint32_t>(text.size());
    }
  }
  return 0;
}

// Batched: fetch text values for multiple fields in one boundary crossing.
// Input layout in cpp_in (after lazy_open already consumed it; the JS side
// stages the name list into the lazy_aux scratch instead). Format:
//   u32 count
//   u32 name_len[count]
//   bytes...           the name strings packed back-to-back
//
// Output layout in cpp_out:
//   u32 result_len[count]   (0xFFFFFFFF if missing/non-text)
//   bytes...                results packed back-to-back
uint32_t cpp_lazy_obj_fields_text(const uint8_t* input_ptr, uint32_t input_len) {
  if (!lazy_reader) return 0;
  auto msg = lazy_reader->getRoot<Message>();
  Expression::Reader expr;
  if (!extractExpr(expr, msg)) return 0;
  if (!expr.isObject()) return 0;

  if (input_len < 4) return 0;
  uint32_t count;
  std::memcpy(&count, input_ptr, 4);
  if (count == 0 || count > 256) return 0;

  const size_t lens_off = 4;
  const size_t names_off = lens_off + count * 4;
  if (input_len < names_off) return 0;

  // Parse name list into spans.
  struct NameSpan { const uint8_t* ptr; uint32_t len; bool found; };
  NameSpan names[256];
  size_t cursor = names_off;
  for (uint32_t i = 0; i < count; i++) {
    uint32_t nl;
    std::memcpy(&nl, input_ptr + lens_off + i * 4, 4);
    if (cursor + nl > input_len) return 0;
    names[i] = { input_ptr + cursor, nl, false };
    cursor += nl;
  }

  // Reserve the result-length header.
  const size_t header_bytes = count * 4;
  size_t write_pos = header_bytes;
  uint32_t found_count = 0;

  // Mark all as missing first.
  for (uint32_t i = 0; i < count; i++) {
    uint32_t missing = 0xFFFFFFFFu;
    std::memcpy(cpp_out + i * 4, &missing, 4);
  }

  // One pass over the entries.
  for (auto kv : expr.getObject()) {
    if (found_count == count) break;
    auto key = kv.getKey();
    for (uint32_t ni = 0; ni < count; ni++) {
      if (names[ni].found) continue;
      if (key.size() != names[ni].len) continue;
      if (std::memcmp(key.cStr(), names[ni].ptr, names[ni].len) != 0) continue;

      auto val = kv.getValue();
      if (val.isText()) {
        auto text = val.getText();
        if (write_pos + text.size() > SCRATCH_CAP) return 0;
        uint32_t tl = static_cast<uint32_t>(text.size());
        std::memcpy(cpp_out + ni * 4, &tl, 4);
        std::memcpy(cpp_out + write_pos, text.cStr(), text.size());
        write_pos += text.size();
      }
      // Else: leave header as 0xFFFFFFFF (missing).
      names[ni].found = true;
      found_count++;
      break;
    }
  }

  return static_cast<uint32_t>(write_pos);
}

// ---------------------------------------------------------------------------
// Typed schema (cpp/typed_schema.capnp): WideUserData with 32 named Text
// fields. Demonstrates the access pattern Cap'n Proto users would actually
// deploy; fields by integer offset, not string lookup.
// ---------------------------------------------------------------------------

alignas(8) static char typed_reader_storage[1024];
static capnp::FlatArrayMessageReader* typed_reader = nullptr;

uint32_t cpp_typed_open(uint32_t bytes_len) {
  if (typed_reader) {
    typed_reader->~FlatArrayMessageReader();
    typed_reader = nullptr;
  }
  static_assert(sizeof(capnp::FlatArrayMessageReader) <= sizeof(typed_reader_storage),
                "typed_reader_storage too small");
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      bytes_len / sizeof(capnp::word));
  typed_reader = new (typed_reader_storage) capnp::FlatArrayMessageReader(words);
  return 1;
}

// Build a WideUserData message from a flat string array.
// JS lays out: u32 count (must be 32), [u32 len + bytes]*32 in cpp_in.
// Output: framed Cap'n Proto bytes in cpp_out.
uint32_t cpp_typed_serialize_wide(uint32_t input_len) {
  if (input_len < 4) return 0;
  uint32_t count;
  std::memcpy(&count, cpp_in, 4);
  if (count != 32) return 0;

  capnp::MallocMessageBuilder builder;
  auto root = builder.initRoot<WideUserData>();

  // Setter pointers: indexed array of member function pointers, one per field.
  using Setter = void (WideUserData::Builder::*)(capnp::Text::Reader);
  static constexpr Setter setters[32] = {
    &WideUserData::Builder::setField0,  &WideUserData::Builder::setField1,
    &WideUserData::Builder::setField2,  &WideUserData::Builder::setField3,
    &WideUserData::Builder::setField4,  &WideUserData::Builder::setField5,
    &WideUserData::Builder::setField6,  &WideUserData::Builder::setField7,
    &WideUserData::Builder::setField8,  &WideUserData::Builder::setField9,
    &WideUserData::Builder::setField10, &WideUserData::Builder::setField11,
    &WideUserData::Builder::setField12, &WideUserData::Builder::setField13,
    &WideUserData::Builder::setField14, &WideUserData::Builder::setField15,
    &WideUserData::Builder::setField16, &WideUserData::Builder::setField17,
    &WideUserData::Builder::setField18, &WideUserData::Builder::setField19,
    &WideUserData::Builder::setField20, &WideUserData::Builder::setField21,
    &WideUserData::Builder::setField22, &WideUserData::Builder::setField23,
    &WideUserData::Builder::setField24, &WideUserData::Builder::setField25,
    &WideUserData::Builder::setField26, &WideUserData::Builder::setField27,
    &WideUserData::Builder::setField28, &WideUserData::Builder::setField29,
    &WideUserData::Builder::setField30, &WideUserData::Builder::setField31,
  };

  size_t pos = 4;
  for (uint32_t i = 0; i < 32; i++) {
    if (pos + 4 > input_len) return 0;
    uint32_t flen;
    std::memcpy(&flen, cpp_in + pos, 4);
    pos += 4;
    if (pos + flen > input_len) return 0;
    auto sp = capnp::Text::Reader(reinterpret_cast<const char*>(cpp_in + pos), flen);
    (root.*setters[i])(sp);
    pos += flen;
  }

  auto words = capnp::messageToFlatArray(builder);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

// Read field N (0..31) of the currently-open WideUserData. Copies text to
// cpp_out, returns byte count. This is what real Cap'n Proto consumers do:
// integer-offset access to a typed struct, no string scanning.
uint32_t cpp_typed_field_at(uint32_t field_idx) {
  if (!typed_reader || field_idx >= 32) return 0;
  auto root = typed_reader->getRoot<WideUserData>();

  using Getter = capnp::Text::Reader (WideUserData::Reader::*)() const;
  static constexpr Getter getters[32] = {
    &WideUserData::Reader::getField0,  &WideUserData::Reader::getField1,
    &WideUserData::Reader::getField2,  &WideUserData::Reader::getField3,
    &WideUserData::Reader::getField4,  &WideUserData::Reader::getField5,
    &WideUserData::Reader::getField6,  &WideUserData::Reader::getField7,
    &WideUserData::Reader::getField8,  &WideUserData::Reader::getField9,
    &WideUserData::Reader::getField10, &WideUserData::Reader::getField11,
    &WideUserData::Reader::getField12, &WideUserData::Reader::getField13,
    &WideUserData::Reader::getField14, &WideUserData::Reader::getField15,
    &WideUserData::Reader::getField16, &WideUserData::Reader::getField17,
    &WideUserData::Reader::getField18, &WideUserData::Reader::getField19,
    &WideUserData::Reader::getField20, &WideUserData::Reader::getField21,
    &WideUserData::Reader::getField22, &WideUserData::Reader::getField23,
    &WideUserData::Reader::getField24, &WideUserData::Reader::getField25,
    &WideUserData::Reader::getField26, &WideUserData::Reader::getField27,
    &WideUserData::Reader::getField28, &WideUserData::Reader::getField29,
    &WideUserData::Reader::getField30, &WideUserData::Reader::getField31,
  };

  auto text = (root.*getters[field_idx])();
  if (text.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, text.cStr(), text.size());
  return static_cast<uint32_t>(text.size());
}

// Forward decl; the AnyStruct section below owns the storage.
extern capnp::FlatArrayMessageReader* any_reader;

// ---------------------------------------------------------------------------
// Bench-only helpers. Each one references a 256-element function-pointer
// table for BigUser, costing ~10 KB. Off by default; bench builds add
// -DCW_BENCH=1 to include them.
// ---------------------------------------------------------------------------
#if CW_BENCH

// Walk every Text field and emit JSON: {"field0":"v0","field1":"v1",...}
// One wasm call -> one bulk JSON.parse on the JS side. V8 builds the entire
// 256-field object in its tightest hot path, beating per-field
// String.fromCharCode loops.
uint32_t cpp_big_user_emit_json() {
  if (!any_reader) return 0;
  auto root = any_reader->getRoot<BigUser>();

  using Getter = capnp::Text::Reader (BigUser::Reader::*)() const;
#define G2(N) &BigUser::Reader::getField##N
#define R28(B0, B1, B2, B3, B4, B5, B6, B7) G2(B0), G2(B1), G2(B2), G2(B3), G2(B4), G2(B5), G2(B6), G2(B7)
  static constexpr Getter getters[256] = {
    R28(0,1,2,3,4,5,6,7),       R28(8,9,10,11,12,13,14,15),
    R28(16,17,18,19,20,21,22,23), R28(24,25,26,27,28,29,30,31),
    R28(32,33,34,35,36,37,38,39), R28(40,41,42,43,44,45,46,47),
    R28(48,49,50,51,52,53,54,55), R28(56,57,58,59,60,61,62,63),
    R28(64,65,66,67,68,69,70,71), R28(72,73,74,75,76,77,78,79),
    R28(80,81,82,83,84,85,86,87), R28(88,89,90,91,92,93,94,95),
    R28(96,97,98,99,100,101,102,103), R28(104,105,106,107,108,109,110,111),
    R28(112,113,114,115,116,117,118,119), R28(120,121,122,123,124,125,126,127),
    R28(128,129,130,131,132,133,134,135), R28(136,137,138,139,140,141,142,143),
    R28(144,145,146,147,148,149,150,151), R28(152,153,154,155,156,157,158,159),
    R28(160,161,162,163,164,165,166,167), R28(168,169,170,171,172,173,174,175),
    R28(176,177,178,179,180,181,182,183), R28(184,185,186,187,188,189,190,191),
    R28(192,193,194,195,196,197,198,199), R28(200,201,202,203,204,205,206,207),
    R28(208,209,210,211,212,213,214,215), R28(216,217,218,219,220,221,222,223),
    R28(224,225,226,227,228,229,230,231), R28(232,233,234,235,236,237,238,239),
    R28(240,241,242,243,244,245,246,247), R28(248,249,250,251,252,253,254,255),
  };
#undef R28
#undef G2

  size_t pos = 0;
  cpp_out[pos++] = '{';
  for (uint32_t i = 0; i < 256; i++) {
    if (i > 0) cpp_out[pos++] = ',';
    int n = std::snprintf(reinterpret_cast<char*>(cpp_out + pos), SCRATCH_CAP - pos,
                          "\"field%u\":\"", i);
    pos += n;
    auto text = (root.*getters[i])();
    // Trust the bench fixture: fields are JSON-safe ASCII.
    std::memcpy(cpp_out + pos, text.cStr(), text.size());
    pos += text.size();
    cpp_out[pos++] = '"';
  }
  cpp_out[pos++] = '}';
  return static_cast<uint32_t>(pos);
}

// Walk every Text field of an open BigUser and pack the results into
// cpp_out as: [u32 len, bytes]*256. One wasm boundary crossing fetches all
// 256 fields, eliminating the 256-call overhead of per-field accessors.
uint32_t cpp_big_user_all_packed() {
  if (!any_reader) return 0;
  auto root = any_reader->getRoot<BigUser>();

  using Getter = capnp::Text::Reader (BigUser::Reader::*)() const;
#define G(N) &BigUser::Reader::getField##N
#define R8(B0, B1, B2, B3, B4, B5, B6, B7) G(B0), G(B1), G(B2), G(B3), G(B4), G(B5), G(B6), G(B7)
  static constexpr Getter getters[256] = {
    R8(0,1,2,3,4,5,6,7),       R8(8,9,10,11,12,13,14,15),
    R8(16,17,18,19,20,21,22,23), R8(24,25,26,27,28,29,30,31),
    R8(32,33,34,35,36,37,38,39), R8(40,41,42,43,44,45,46,47),
    R8(48,49,50,51,52,53,54,55), R8(56,57,58,59,60,61,62,63),
    R8(64,65,66,67,68,69,70,71), R8(72,73,74,75,76,77,78,79),
    R8(80,81,82,83,84,85,86,87), R8(88,89,90,91,92,93,94,95),
    R8(96,97,98,99,100,101,102,103), R8(104,105,106,107,108,109,110,111),
    R8(112,113,114,115,116,117,118,119), R8(120,121,122,123,124,125,126,127),
    R8(128,129,130,131,132,133,134,135), R8(136,137,138,139,140,141,142,143),
    R8(144,145,146,147,148,149,150,151), R8(152,153,154,155,156,157,158,159),
    R8(160,161,162,163,164,165,166,167), R8(168,169,170,171,172,173,174,175),
    R8(176,177,178,179,180,181,182,183), R8(184,185,186,187,188,189,190,191),
    R8(192,193,194,195,196,197,198,199), R8(200,201,202,203,204,205,206,207),
    R8(208,209,210,211,212,213,214,215), R8(216,217,218,219,220,221,222,223),
    R8(224,225,226,227,228,229,230,231), R8(232,233,234,235,236,237,238,239),
    R8(240,241,242,243,244,245,246,247), R8(248,249,250,251,252,253,254,255),
  };
#undef R8
#undef G

  size_t pos = 0;
  for (uint32_t i = 0; i < 256; i++) {
    auto text = (root.*getters[i])();
    if (pos + 4 + text.size() > SCRATCH_CAP) return 0;
    uint32_t tl = static_cast<uint32_t>(text.size());
    std::memcpy(cpp_out + pos, &tl, 4);
    pos += 4;
    std::memcpy(cpp_out + pos, text.cStr(), text.size());
    pos += text.size();
  }
  return static_cast<uint32_t>(pos);
}

// ---------------------------------------------------------------------------
// Bench helper: build a fully-populated BigUser test message in cpp_out.
// Used by bench/ to get real BigUser-shaped bytes without writing a full
// dynamic builder in JS. Each field gets value "v<i>-<padding>" so the
// payload is realistic-ish (~40 bytes per field, ~10KB total).
// ---------------------------------------------------------------------------
uint32_t cpp_make_big_user_bytes() {
  capnp::MallocMessageBuilder builder;
  auto root = builder.initRoot<BigUser>();

  using Setter = void (BigUser::Builder::*)(capnp::Text::Reader);
  // Generate all 256 setter pointers via repeated macro expansion that
  // concatenates the literal index in a single token.
#define S(N) &BigUser::Builder::setField##N
#define R8(B0, B1, B2, B3, B4, B5, B6, B7) S(B0), S(B1), S(B2), S(B3), S(B4), S(B5), S(B6), S(B7)
  static constexpr Setter setters[256] = {
    R8(0,1,2,3,4,5,6,7),       R8(8,9,10,11,12,13,14,15),
    R8(16,17,18,19,20,21,22,23), R8(24,25,26,27,28,29,30,31),
    R8(32,33,34,35,36,37,38,39), R8(40,41,42,43,44,45,46,47),
    R8(48,49,50,51,52,53,54,55), R8(56,57,58,59,60,61,62,63),
    R8(64,65,66,67,68,69,70,71), R8(72,73,74,75,76,77,78,79),
    R8(80,81,82,83,84,85,86,87), R8(88,89,90,91,92,93,94,95),
    R8(96,97,98,99,100,101,102,103), R8(104,105,106,107,108,109,110,111),
    R8(112,113,114,115,116,117,118,119), R8(120,121,122,123,124,125,126,127),
    R8(128,129,130,131,132,133,134,135), R8(136,137,138,139,140,141,142,143),
    R8(144,145,146,147,148,149,150,151), R8(152,153,154,155,156,157,158,159),
    R8(160,161,162,163,164,165,166,167), R8(168,169,170,171,172,173,174,175),
    R8(176,177,178,179,180,181,182,183), R8(184,185,186,187,188,189,190,191),
    R8(192,193,194,195,196,197,198,199), R8(200,201,202,203,204,205,206,207),
    R8(208,209,210,211,212,213,214,215), R8(216,217,218,219,220,221,222,223),
    R8(224,225,226,227,228,229,230,231), R8(232,233,234,235,236,237,238,239),
    R8(240,241,242,243,244,245,246,247), R8(248,249,250,251,252,253,254,255),
  };
#undef R8
#undef S

  char buf[64];
  for (uint32_t i = 0; i < 256; i++) {
    int n = std::snprintf(buf, sizeof(buf),
        "v%u-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", i);
    (root.*setters[i])(capnp::Text::Reader(buf, n));
  }

  auto words = capnp::messageToFlatArray(builder);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

#endif  // CW_BENCH

// ---------------------------------------------------------------------------
// Conformance: build a Primitives message with caller-supplied values via
// fixed offsets in cpp_in. Layout:
//   bytes  0..1   u8 + i8
//   bytes  2..3   i8 (already in)
//   bytes  4..7   u16 + i16
//   bytes  8..11  u32
//   bytes 12..15  i32
//   bytes 16..23  u64
//   bytes 24..31  i64
//   bytes 32..35  f32
//   bytes 36..43  f64
//   byte  44      flag0 (bit 0), flag1 (bit 1), flag2 (bit 2)
//   bytes 45..48  text_len
//   bytes 49..    text bytes followed by data_len + data bytes
//
// Returns serialized framed bytes in cpp_out.
uint32_t cpp_conformance_serialize(uint32_t input_len) {
  if (input_len < 49) return 0;
  capnp::MallocMessageBuilder builder;
  auto root = builder.initRoot<Primitives>();

  root.setU8 (cpp_in[0]);
  root.setI8 (static_cast<int8_t>(cpp_in[1]));
  uint16_t u16; std::memcpy(&u16, cpp_in + 4, 2); root.setU16(u16);
  int16_t  i16; std::memcpy(&i16, cpp_in + 6, 2); root.setI16(i16);
  uint32_t u32; std::memcpy(&u32, cpp_in + 8, 4); root.setU32(u32);
  int32_t  i32; std::memcpy(&i32, cpp_in + 12, 4); root.setI32(i32);
  uint64_t u64; std::memcpy(&u64, cpp_in + 16, 8); root.setU64(u64);
  int64_t  i64; std::memcpy(&i64, cpp_in + 24, 8); root.setI64(i64);
  float    f32; std::memcpy(&f32, cpp_in + 32, 4); root.setF32(f32);
  double   f64; std::memcpy(&f64, cpp_in + 36, 8); root.setF64(f64);

  uint8_t flags = cpp_in[44];
  root.setFlag0((flags & 1) != 0);
  root.setFlag1((flags & 2) != 0);
  root.setFlag2((flags & 4) != 0);

  uint32_t text_len; std::memcpy(&text_len, cpp_in + 45, 4);
  size_t pos = 49;
  if (pos + text_len > input_len) return 0;
  root.setText(capnp::Text::Reader(reinterpret_cast<const char*>(cpp_in + pos), text_len));
  pos += text_len;

  if (pos + 4 > input_len) return 0;
  uint32_t data_len; std::memcpy(&data_len, cpp_in + pos, 4); pos += 4;
  if (pos + data_len > input_len) return 0;
  root.setData(capnp::Data::Reader(cpp_in + pos, data_len));

  // emptyText / emptyData stay default (null).

  auto words = capnp::messageToFlatArray(builder);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

// ---------------------------------------------------------------------------
// Generic AnyStruct navigation. One wasm binary serves every user schema:
// codegen-emitted JS classes know each field's offset (computed at build time
// from the .capnp file) and call these primitives to read individual fields.
// No string lookups, no schema reflection at runtime.
// ---------------------------------------------------------------------------

alignas(8) static char any_reader_storage[1024];
capnp::FlatArrayMessageReader* any_reader = nullptr;

// Stack of struct readers so generated code can navigate into sub-structs
// without persisting opaque handles in JS.
//
// Wrapped in a union so the array doesn't trigger default-construction at
// module init. AnyStruct::Reader has a trivial default ctor, but the
// compiler still emits a 32-iteration init loop in _initialize for the
// static array; that's responsible for ~30k instructions, 75% of the
// slim wasm's code section. The union skips per-element init; the wasm
// spec already zero-initializes BSS, which matches what the default
// Reader ctor would have produced. Slots are accessed via `any_stack(i)`.
constexpr size_t ANY_STACK_DEPTH = 32;
union AnyStackSlot {
  AnyStackSlot() {}
  ~AnyStackSlot() {}
  capnp::AnyStruct::Reader r;
};
static AnyStackSlot any_stack_slots[ANY_STACK_DEPTH];
static inline capnp::AnyStruct::Reader& any_stack(int i) {
  return any_stack_slots[i].r;
}
static int32_t any_stack_top = -1;

uint32_t cpp_any_open_at(const uint8_t* bytes_ptr, uint32_t bytes_len) {
  if (any_reader) {
    any_reader->~FlatArrayMessageReader();
    any_reader = nullptr;
  }
  static_assert(sizeof(capnp::FlatArrayMessageReader) <= sizeof(any_reader_storage),
                "any_reader_storage too small");
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(bytes_ptr),
      bytes_len / sizeof(capnp::word));
  any_reader = new (any_reader_storage) capnp::FlatArrayMessageReader(words);
  any_stack_top = 0;
  any_stack(0) = any_reader->getRoot<capnp::AnyPointer>().getAs<capnp::AnyStruct>();
  // Return data section pointer so the JS Reader can read primitives
  // straight from wasm memory.
  return reinterpret_cast<uint32_t>(any_stack(0).getDataSection().begin());
}

uint32_t cpp_any_open(uint32_t bytes_len) {
  return cpp_any_open_at(cpp_in, bytes_len);
}

// Push the struct at pointer slot `ptr_idx` of the current top onto the stack.
// Returns 1 on success, 0 if the pointer is null or out of range.
uint32_t cpp_any_enter_struct(uint32_t ptr_idx) {
  if (any_stack_top < 0 || any_stack_top + 1 >= (int32_t)ANY_STACK_DEPTH) return 0;
  auto top = any_stack(any_stack_top);
  auto ptrs = top.getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto sub = ptrs[ptr_idx].getAs<capnp::AnyStruct>();
  any_stack_top++;
  any_stack(any_stack_top) = sub;
  return 1;
}

void cpp_any_leave_struct() {
  if (any_stack_top > 0) any_stack_top--;
}

// ---- List iteration -----------------------------------------------------
// For a List(Struct) wire pattern (the "1000 records in one message"
// shape), JS opens the message once via cpp_any_open, then descends via
// cpp_any_enter_list_at to position the reader on the i-th element. The
// element appears on the AnyStruct stack just like cpp_any_enter_struct,
// so all the typed Reader getters work unchanged.

static capnp::AnyList::Reader any_list_reader;
static bool any_list_reader_set = false;

// Open the pointer at `ptr_idx` of the current top struct as a List of
// AnyStructs. Returns the element count (0 if missing or wrong type).
uint32_t cpp_any_open_list(uint32_t ptr_idx) {
  if (any_stack_top < 0) return 0;
  auto ptrs = any_stack(any_stack_top).getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  any_list_reader = ptrs[ptr_idx].getAs<capnp::AnyList>();
  any_list_reader_set = true;
  return any_list_reader.size();
}

// Push the i-th list element (as AnyStruct) onto the stack so the typed
// Reader's getters address it. Returns 1 on success, 0 on out-of-range.
uint32_t cpp_any_enter_list_at(uint32_t i) {
  if (!any_list_reader_set) return 0;
  if (i >= any_list_reader.size()) return 0;
  if (any_stack_top + 1 >= (int32_t)ANY_STACK_DEPTH) return 0;
  any_stack_top++;
  any_stack(any_stack_top) = any_list_reader.as<capnp::List<capnp::AnyStruct>>()[i];
  return 1;
}

// Current list size (after cpp_any_open_list).
uint32_t cpp_any_list_size() {
  if (!any_list_reader_set) return 0;
  return any_list_reader.size();
}

// Primitive-list element access; read element i directly without pushing
// it on the stack (lists of primitives don't have struct shape). The
// templated helpers below work because the underlying List<T> stores
// elements at fixed offsets.
uint32_t cpp_any_list_get_uint32(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<uint32_t>>();
  if (i >= list.size()) return 0;
  return list[i];
}

uint32_t cpp_any_list_get_uint16(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<uint16_t>>();
  if (i >= list.size()) return 0;
  return list[i];
}

uint32_t cpp_any_list_get_uint8(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<uint8_t>>();
  if (i >= list.size()) return 0;
  return list[i];
}

uint64_t cpp_any_list_get_uint64(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<uint64_t>>();
  if (i >= list.size()) return 0;
  return list[i];
}

// Float reads via reinterpret-as-int so JS can recover the bit pattern.
uint32_t cpp_any_list_get_float32_bits(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<float>>();
  if (i >= list.size()) return 0;
  float f = list[i];
  uint32_t bits;
  std::memcpy(&bits, &f, 4);
  return bits;
}

uint64_t cpp_any_list_get_float64_bits(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<double>>();
  if (i >= list.size()) return 0;
  double d = list[i];
  uint64_t bits;
  std::memcpy(&bits, &d, 8);
  return bits;
}

uint32_t cpp_any_list_get_bool(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<bool>>();
  if (i >= list.size()) return 0;
  return list[i] ? 1 : 0;
}

// Get text element i; copies bytes to cpp_out, returns length.
uint32_t cpp_any_list_get_text(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<capnp::Text>>();
  if (i >= list.size()) return 0;
  auto t = list[i];
  if (t.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, t.cStr(), t.size());
  return static_cast<uint32_t>(t.size());
}

// Get data element i; copies bytes to cpp_out, returns length.
uint32_t cpp_any_list_get_data(uint32_t i) {
  if (!any_list_reader_set) return 0;
  auto list = any_list_reader.as<capnp::List<capnp::Data>>();
  if (i >= list.size()) return 0;
  auto d = list[i];
  if (d.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, d.begin(), d.size());
  return static_cast<uint32_t>(d.size());
}

// Read a Text from pointer slot `ptr_idx` of the current top struct.
// Copies bytes to cpp_out, returns count. 0 if missing / non-text.
uint32_t cpp_any_text_at(uint32_t ptr_idx) {
  if (any_stack_top < 0) return 0;
  auto top = any_stack(any_stack_top);
  auto ptrs = top.getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto text = ptrs[ptr_idx].getAs<capnp::Text>();
  if (text.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, text.cStr(), text.size());
  return static_cast<uint32_t>(text.size());
}

// Read a Data field (raw bytes) from pointer slot `ptr_idx`.
uint32_t cpp_any_data_at(uint32_t ptr_idx) {
  if (any_stack_top < 0) return 0;
  auto top = any_stack(any_stack_top);
  auto ptrs = top.getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto data = ptrs[ptr_idx].getAs<capnp::Data>();
  if (data.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, data.begin(), data.size());
  return static_cast<uint32_t>(data.size());
}

// Read scalar fields from the data section by byte offset. The default value
// is XOR'd with the on-wire bits, matching Cap'n Proto's encoding rule.
int64_t cpp_any_int64_at(uint32_t byte_offset, int64_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack(any_stack_top);
  auto data = top.getDataSection();
  if (byte_offset + 8 > data.size()) return default_val;
  int64_t v;
  std::memcpy(&v, data.begin() + byte_offset, 8);
  return v ^ default_val;
}

uint32_t cpp_any_uint32_at(uint32_t byte_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack(any_stack_top);
  auto data = top.getDataSection();
  if (byte_offset + 4 > data.size()) return default_val;
  uint32_t v;
  std::memcpy(&v, data.begin() + byte_offset, 4);
  return v ^ default_val;
}

uint32_t cpp_any_uint16_at(uint32_t byte_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack(any_stack_top);
  auto data = top.getDataSection();
  if (byte_offset + 2 > data.size()) return default_val;
  uint16_t v;
  std::memcpy(&v, data.begin() + byte_offset, 2);
  return static_cast<uint32_t>(v) ^ default_val;
}

uint32_t cpp_any_uint8_at(uint32_t byte_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack(any_stack_top);
  auto data = top.getDataSection();
  if (byte_offset >= data.size()) return default_val;
  uint8_t v = data[byte_offset];
  return static_cast<uint32_t>(v) ^ default_val;
}

uint32_t cpp_any_bool_at(uint32_t bit_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack(any_stack_top);
  auto data = top.getDataSection();
  uint32_t byte = bit_offset / 8;
  uint32_t bit = bit_offset & 7;
  if (byte >= data.size()) return default_val;
  uint32_t v = (data[byte] >> bit) & 1;
  return v ^ (default_val & 1);
}

// Batched read: caller supplies a flat list of field requests in cpp_scratch_aux,
// wasm packs results into cpp_out, ONE boundary crossing for N fields.
//
// Input layout (in cpp_scratch_aux):
//   u32 count
//   for each:  u8 kind, u32 offset
//
// kind values (must agree with the JS-side codegen):
//   0  text by pointer-slot index
//   1  uint8  at byte offset
//   2  uint16 at byte offset
//   3  uint32 at byte offset
//   4  int64  at byte offset (low 8 bytes of result)
//   5  bool   at bit offset
//   6  data by pointer-slot index
//
// Output layout (in cpp_out):
//   for each request:
//     u32 result_len      (0xFFFFFFFF if missing/wrong-kind)
//     bytes...            (text/data) OR
//     u32 value           (uint8/16/32/bool; value packed into the size field)
//     i64 value           (int64; packed into 8 bytes of payload)
//
// Returns total bytes written.
uint32_t cpp_any_batch_read(uint32_t input_len) {
  if (any_stack_top < 0) return 0;
  if (input_len < 4) return 0;
  uint32_t count;
  std::memcpy(&count, cpp_scratch_aux, 4);
  if (count == 0 || count > 1024) return 0;

  const size_t request_bytes = 1 + 4;  // u8 kind + u32 offset
  if (input_len < 4 + count * request_bytes) return 0;

  auto top = any_stack(any_stack_top);
  auto data = top.getDataSection();
  auto ptrs = top.getPointerSection();

  size_t out_pos = count * 4;  // reserve len header
  size_t in_pos = 4;
  for (uint32_t i = 0; i < count; i++) {
    uint8_t kind = cpp_scratch_aux[in_pos]; in_pos += 1;
    uint32_t off; std::memcpy(&off, cpp_scratch_aux + in_pos, 4); in_pos += 4;
    uint32_t* len_slot = reinterpret_cast<uint32_t*>(cpp_out + i * 4);

    switch (kind) {
      case 0: {  // text
        if (off >= ptrs.size()) { *len_slot = 0xFFFFFFFFu; break; }
        auto t = ptrs[off].getAs<capnp::Text>();
        if (out_pos + t.size() > SCRATCH_CAP) return 0;
        *len_slot = static_cast<uint32_t>(t.size());
        std::memcpy(cpp_out + out_pos, t.cStr(), t.size());
        out_pos += t.size();
        break;
      }
      case 6: {  // data
        if (off >= ptrs.size()) { *len_slot = 0xFFFFFFFFu; break; }
        auto d = ptrs[off].getAs<capnp::Data>();
        if (out_pos + d.size() > SCRATCH_CAP) return 0;
        *len_slot = static_cast<uint32_t>(d.size());
        std::memcpy(cpp_out + out_pos, d.begin(), d.size());
        out_pos += d.size();
        break;
      }
      case 1:    // uint8
      case 2:    // uint16
      case 3: {  // uint32
        const uint32_t sz = (kind == 1) ? 1 : (kind == 2 ? 2 : 4);
        if (off + sz > data.size()) { *len_slot = 0; break; }
        uint32_t v = 0;
        std::memcpy(&v, data.begin() + off, sz);
        *len_slot = v;
        break;
      }
      case 4: {  // int64
        if (off + 8 > data.size()) { *len_slot = 0; if (out_pos + 8 > SCRATCH_CAP) return 0; std::memset(cpp_out + out_pos, 0, 8); out_pos += 8; break; }
        if (out_pos + 8 > SCRATCH_CAP) return 0;
        std::memcpy(cpp_out + out_pos, data.begin() + off, 8);
        *len_slot = 8;
        out_pos += 8;
        break;
      }
      case 5: {  // bool: off is bit offset
        const uint32_t byte = off / 8;
        const uint32_t bit  = off & 7;
        if (byte >= data.size()) { *len_slot = 0; break; }
        *len_slot = (data[byte] >> bit) & 1;
        break;
      }
      default:
        *len_slot = 0xFFFFFFFFu;
    }
  }
  return static_cast<uint32_t>(out_pos);
}

// Project a List(Struct) in one wasm call. This is the list-shaped sibling
// of cpp_any_batch_read: caller supplies a field descriptor list in
// cpp_scratch_aux, C++ loops every row and writes a compact row tape to cpp_out.
//
// Input in cpp_scratch_aux:
//   u32 fieldCount
//   for each field: u8 kind, u32 offset
//
// Arguments:
//   ptr_idx: pointer slot on current AnyStruct holding List(Struct)
//   input_len: bytes used in cpp_scratch_aux
//
// Output in cpp_out:
//   u32 rowCount
//   u32 fieldCount
//   u32 cellHeader[rowCount * fieldCount]
//   payload bytes for text/data/int64/float64 cells
//
// Cell semantics match cpp_any_batch_read: text/data header is byte length,
// missing pointer is 0xFFFFFFFF, small scalar values are packed directly in
// the header, 64-bit / float64 payloads are 8 bytes.
uint32_t cpp_any_list_project(uint32_t ptr_idx, uint32_t input_len) {
  if (any_stack_top < 0) return 0;
  if (input_len < 4) return 0;

  uint32_t field_count;
  std::memcpy(&field_count, cpp_scratch_aux, 4);
  if (field_count == 0 || field_count > 256) return 0;

  const size_t request_bytes = 1 + 4;
  if (input_len < 4 + field_count * request_bytes) return 0;

  auto ptrs = any_stack(any_stack_top).getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto any_list = ptrs[ptr_idx].getAs<capnp::AnyList>();
  auto list = any_list.as<capnp::List<capnp::AnyStruct>>();
  const uint32_t row_count = list.size();

  const uint64_t cell_count64 = static_cast<uint64_t>(row_count) * field_count;
  if (cell_count64 > 1024u * 1024u) return 0;
  const uint32_t cell_count = static_cast<uint32_t>(cell_count64);

  size_t out_pos = 8 + static_cast<size_t>(cell_count) * 4;
  if (out_pos > SCRATCH_CAP) return 0;

  std::memcpy(cpp_out, &row_count, 4);
  std::memcpy(cpp_out + 4, &field_count, 4);
  uint32_t* headers = reinterpret_cast<uint32_t*>(cpp_out + 8);

  for (uint32_t row = 0; row < row_count; row++) {
    auto item = list[row];
    auto data = item.getDataSection();
    auto item_ptrs = item.getPointerSection();

    size_t in_pos = 4;
    for (uint32_t col = 0; col < field_count; col++) {
      uint8_t kind = cpp_scratch_aux[in_pos]; in_pos += 1;
      uint32_t off; std::memcpy(&off, cpp_scratch_aux + in_pos, 4); in_pos += 4;
      uint32_t& h = headers[row * field_count + col];

      switch (kind) {
        case 0: { // text pointer
          if (off >= item_ptrs.size()) { h = 0xFFFFFFFFu; break; }
          auto t = item_ptrs[off].getAs<capnp::Text>();
          if (out_pos + t.size() > SCRATCH_CAP) return 0;
          h = static_cast<uint32_t>(t.size());
          std::memcpy(cpp_out + out_pos, t.cStr(), t.size());
          out_pos += t.size();
          break;
        }
        case 6: { // data pointer
          if (off >= item_ptrs.size()) { h = 0xFFFFFFFFu; break; }
          auto d = item_ptrs[off].getAs<capnp::Data>();
          if (out_pos + d.size() > SCRATCH_CAP) return 0;
          h = static_cast<uint32_t>(d.size());
          std::memcpy(cpp_out + out_pos, d.begin(), d.size());
          out_pos += d.size();
          break;
        }
        case 1:
        case 2:
        case 3: {
          const uint32_t sz = (kind == 1) ? 1 : (kind == 2 ? 2 : 4);
          if (off + sz > data.size()) { h = 0; break; }
          uint32_t v = 0;
          std::memcpy(&v, data.begin() + off, sz);
          h = v;
          break;
        }
        case 4: { // int64 / uint64 / float64 payload
          if (out_pos + 8 > SCRATCH_CAP) return 0;
          if (off + 8 > data.size()) {
            h = 0;
            std::memset(cpp_out + out_pos, 0, 8);
          } else {
            h = 8;
            std::memcpy(cpp_out + out_pos, data.begin() + off, 8);
          }
          out_pos += 8;
          break;
        }
        case 5: { // bool bit offset
          const uint32_t byte = off / 8;
          const uint32_t bit = off & 7;
          if (byte >= data.size()) { h = 0; break; }
          h = (data[byte] >> bit) & 1;
          break;
        }
        default:
          h = 0xFFFFFFFFu;
      }
    }
  }

  return static_cast<uint32_t>(out_pos);
}

// ---------------------------------------------------------------------------
// Generic AnyStruct BUILDER; counterpart to the reader. Codegen-emitted
// XBuilder classes know each field's offset/type at build time; these
// primitives let them write into a shared message via integer-indexed calls.
//
// The builder lives in static placement-new storage with a pre-allocated
// first segment. Avoids the malloc/calloc/free cycle on every Builder
// init; the calloc-zeroing first segment was the dominant CPU cost in
// hot RPC loops (CPU profile showed ~70% of wasm time in calloc).
// MallocMessageBuilder's destructor zeroes a borrowed firstSegment for
// us, so re-initialization sees a fresh-zeroed buffer.

alignas(8) static capnp::word any_builder_first_seg[8192];   // 64 KB
alignas(8) static char any_builder_storage[sizeof(capnp::MallocMessageBuilder)];
static capnp::MallocMessageBuilder* any_builder = nullptr;
alignas(8) static char any_builder_root_storage[64];
static capnp::AnyStruct::Builder* any_builder_root = nullptr;

// Cursor stack for nested-struct building. cursor_stack[0] is the root;
// enter_struct pushes a nested AnyStruct::Builder onto the stack so all
// subsequent setters (via current_cursor()) write into the nested struct.
// exit_struct pops back. Max depth bounds the supported nesting.
constexpr int CURSOR_MAX_DEPTH = 8;
alignas(8) static char cursor_stack_storage[CURSOR_MAX_DEPTH][sizeof(capnp::AnyStruct::Builder)];
static capnp::AnyStruct::Builder* cursor_stack[CURSOR_MAX_DEPTH] = { nullptr };
static int cursor_depth = 0;

static inline capnp::AnyStruct::Builder* current_cursor() {
  return cursor_stack[cursor_depth];
}

uint32_t cpp_any_builder_init(uint32_t data_words, uint32_t ptr_words) {
  while (cursor_depth > 0) {
    cursor_stack[cursor_depth]->~Builder();
    cursor_stack[cursor_depth] = nullptr;
    cursor_depth--;
  }
  if (any_builder_root) {
    any_builder_root->~Builder();
    any_builder_root = nullptr;
    cursor_stack[0] = nullptr;
  }
  if (any_builder) {
    any_builder->~MallocMessageBuilder();
    any_builder = nullptr;
  }
  any_builder = new (any_builder_storage) capnp::MallocMessageBuilder(
      kj::arrayPtr(any_builder_first_seg,
                   sizeof(any_builder_first_seg) / sizeof(capnp::word)));
  auto root = any_builder->initRoot<capnp::AnyPointer>();
  auto anyStruct = root.initAsAnyStruct(data_words, ptr_words);
  static_assert(sizeof(capnp::AnyStruct::Builder) <= sizeof(any_builder_root_storage),
                "any_builder_root_storage too small");
  any_builder_root = new (any_builder_root_storage) capnp::AnyStruct::Builder(kj::mv(anyStruct));
  cursor_stack[0] = any_builder_root;
  cursor_depth = 0;
  return 1;
}

// Push a nested AnyStruct cursor onto the stack. All setters use the new
// top-of-stack until exit_struct is called.
uint32_t cpp_any_builder_enter_struct(uint32_t ptr_idx, uint32_t data_words, uint32_t ptr_words) {
  if (cursor_depth + 1 >= CURSOR_MAX_DEPTH) return 0;
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto nested = ptrs[ptr_idx].initAsAnyStruct(data_words, ptr_words);
  cursor_depth++;
  cursor_stack[cursor_depth] = new (cursor_stack_storage[cursor_depth])
      capnp::AnyStruct::Builder(kj::mv(nested));
  return 1;
}

uint32_t cpp_any_builder_exit_struct() {
  if (cursor_depth == 0) return 0;
  cursor_stack[cursor_depth]->~Builder();
  cursor_stack[cursor_depth] = nullptr;
  cursor_depth--;
  return 1;
}

// Expose the address (in linear memory) and size of the current
// any_builder_root's data section. JS can then write primitive fields
// DIRECTLY into wasm memory at known offsets; no per-setter wasm call.
// Pointer-section fields (text, data, structs) still need wasm because
// they require arena allocation, but the inline data is just bytes.
uint32_t cpp_any_builder_data_ptr() {
  auto cur = current_cursor();
  if (!cur) return 0;
  return reinterpret_cast<uint32_t>(cur->getDataSection().begin());
}

uint32_t cpp_any_builder_data_size() {
  auto cur = current_cursor();
  if (!cur) return 0;
  return static_cast<uint32_t>(cur->getDataSection().size());
}

void cpp_any_builder_set_uint8(uint32_t byte_off, uint32_t value) {
  auto cur = current_cursor();
  if (!cur) return;
  auto data = cur->getDataSection();
  if (byte_off < data.size()) data[byte_off] = static_cast<uint8_t>(value);
}

void cpp_any_builder_set_uint16(uint32_t byte_off, uint32_t value) {
  auto cur = current_cursor();
  if (!cur) return;
  auto data = cur->getDataSection();
  if (byte_off + 2 <= data.size()) {
    uint16_t v = static_cast<uint16_t>(value);
    std::memcpy(data.begin() + byte_off, &v, 2);
  }
}

void cpp_any_builder_set_uint32(uint32_t byte_off, uint32_t value) {
  auto cur = current_cursor();
  if (!cur) return;
  auto data = cur->getDataSection();
  if (byte_off + 4 <= data.size()) {
    std::memcpy(data.begin() + byte_off, &value, 4);
  }
}

void cpp_any_builder_set_int64_lo_hi(uint32_t byte_off, uint32_t lo, uint32_t hi) {
  auto cur = current_cursor();
  if (!cur) return;
  auto data = cur->getDataSection();
  if (byte_off + 8 <= data.size()) {
    std::memcpy(data.begin() + byte_off, &lo, 4);
    std::memcpy(data.begin() + byte_off + 4, &hi, 4);
  }
}

void cpp_any_builder_set_bool(uint32_t bit_off, uint32_t value) {
  auto cur = current_cursor();
  if (!cur) return;
  auto data = cur->getDataSection();
  uint32_t byte = bit_off / 8;
  uint32_t bit = bit_off & 7;
  if (byte >= data.size()) return;
  if (value) data[byte] |= static_cast<uint8_t>(1u << bit);
  else       data[byte] &= static_cast<uint8_t>(~(1u << bit));
}

uint32_t cpp_any_builder_set_text(uint32_t ptr_idx, uint32_t text_len) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  ptrs[ptr_idx].setAs<capnp::Text>(
      capnp::Text::Reader(reinterpret_cast<const char*>(cpp_in), text_len));
  return 1;
}

uint32_t cpp_any_builder_set_data(uint32_t ptr_idx, uint32_t data_len) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  ptrs[ptr_idx].setAs<capnp::Data>(capnp::Data::Reader(cpp_in, data_len));
  return 1;
}

// ---- Dynamic list-of-primitives builders -----------------------------------
#define LIST_PRIM(NAME, CTYPE) \
  uint32_t cpp_any_builder_init_list_##NAME(uint32_t ptr_idx, uint32_t count) { \
    auto cur = current_cursor(); \
    if (!cur) return 0; \
    auto ptrs = cur->getPointerSection(); \
    if (ptr_idx >= ptrs.size()) return 0; \
    ptrs[ptr_idx].initAs<capnp::List<CTYPE>>(count); \
    return 1; \
  } \
  void cpp_any_builder_set_list_##NAME(uint32_t ptr_idx, uint32_t i, CTYPE v) { \
    auto cur = current_cursor(); \
    if (!cur) return; \
    auto ptrs = cur->getPointerSection(); \
    if (ptr_idx >= ptrs.size()) return; \
    auto list = ptrs[ptr_idx].getAs<capnp::List<CTYPE>>(); \
    if (i >= list.size()) return; \
    list.set(i, v); \
  }

LIST_PRIM(uint8,   uint8_t)
LIST_PRIM(uint16,  uint16_t)
LIST_PRIM(uint32,  uint32_t)
LIST_PRIM(uint64,  uint64_t)
LIST_PRIM(int8,    int8_t)
LIST_PRIM(int16,   int16_t)
LIST_PRIM(int32,   int32_t)
LIST_PRIM(int64,   int64_t)
LIST_PRIM(float32, float)
LIST_PRIM(float64, double)
LIST_PRIM(bool,    bool)

#undef LIST_PRIM

uint32_t cpp_any_builder_init_list_text(uint32_t ptr_idx, uint32_t count) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  ptrs[ptr_idx].initAs<capnp::List<capnp::Text>>(count);
  return 1;
}
uint32_t cpp_any_builder_set_list_text(uint32_t ptr_idx, uint32_t i, uint32_t text_len) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto list = ptrs[ptr_idx].getAs<capnp::List<capnp::Text>>();
  if (i >= list.size()) return 0;
  list.set(i, capnp::Text::Reader(reinterpret_cast<const char*>(cpp_in), text_len));
  return 1;
}

uint32_t cpp_any_builder_init_list_data(uint32_t ptr_idx, uint32_t count) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  ptrs[ptr_idx].initAs<capnp::List<capnp::Data>>(count);
  return 1;
}
uint32_t cpp_any_builder_set_list_data(uint32_t ptr_idx, uint32_t i, uint32_t data_len) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto list = ptrs[ptr_idx].getAs<capnp::List<capnp::Data>>();
  if (i >= list.size()) return 0;
  list.set(i, capnp::Data::Reader(cpp_in, data_len));
  return 1;
}

// List of structs: init the list-of-AnyStruct + push element via cursor stack.
uint32_t cpp_any_builder_init_list_struct(
    uint32_t ptr_idx, uint32_t count, uint32_t data_words, uint32_t ptr_words) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  ptrs[ptr_idx].initAsListOfAnyStruct(
      static_cast<uint16_t>(data_words),
      static_cast<uint16_t>(ptr_words),
      count);
  return 1;
}

uint32_t cpp_any_builder_enter_list_element(uint32_t ptr_idx, uint32_t elem_idx) {
  if (cursor_depth + 1 >= CURSOR_MAX_DEPTH) return 0;
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto anyList = ptrs[ptr_idx].getAs<capnp::AnyList>();
  auto structList = anyList.as<capnp::List<capnp::AnyStruct>>();
  if (elem_idx >= structList.size()) return 0;
  cursor_depth++;
  cursor_stack[cursor_depth] = new (cursor_stack_storage[cursor_depth])
      capnp::AnyStruct::Builder(structList[elem_idx]);
  return 1;
}

// Set a pointer slot's struct from a fully-built capnp message in cpp_in.
uint32_t cpp_any_builder_set_struct_from_bytes(uint32_t ptr_idx, uint32_t bytes_len) {
  auto cur = current_cursor();
  if (!cur) return 0;
  auto ptrs = cur->getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  if (bytes_len > SCRATCH_CAP) return 0;
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      bytes_len / sizeof(capnp::word));
  capnp::FlatArrayMessageReader reader(words);
  ptrs[ptr_idx].setAs<capnp::AnyPointer>(reader.getRoot<capnp::AnyPointer>());
  return 1;
}

// Serialize the current builder's message to cpp_out as framed bytes.
uint32_t cpp_any_builder_finalize() {
  if (!any_builder) return 0;
  auto words = capnp::messageToFlatArray(*any_builder);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

// ---------------------------------------------------------------------------
// RPC layer: thin wrapper over the vendored rpc.capnp generated code so the
// JS-side RpcSession can build/parse the standard Cap'n Proto RPC protocol
// without re-implementing 110 reader/builder classes. Wire-compatible with
// any cxx/rust/go capnp server speaking rpc.capnp.
//
// State: a single MessageBuilder per "outgoing send". Decode operates on
// cpp_in bytes (parsed once, fields then queried). Params/results bytes
// are passed as raw blobs the JS layer encodes/decodes via the typed
// reader/builder generated for the application's own schemas.
// ---------------------------------------------------------------------------

// Pre-allocated first segment + placement-new storage for the RPC frame
// builder. Same reasoning as any_builder above: avoid the calloc/free
// cycle that dominated CPU profiles. RPC frames (Bootstrap, Call, Return,
// Finish, Release) are small; 4 KB is more than enough for a single
// segment in practice. Larger payloads carry their bytes in
// Call.params.content / Return.results.content via initWithCaveats and
// don't bloat this builder.
alignas(8) static capnp::word rpc_first_seg[512];   // 4 KB
alignas(8) static char rpc_builder_storage[sizeof(capnp::MallocMessageBuilder)];
static capnp::MallocMessageBuilder* rpc_builder = nullptr;
alignas(8) static char rpc_reader_storage[1024];
static capnp::FlatArrayMessageReader* rpc_reader = nullptr;

// Reset rpc_builder in place using the static first segment. Replaces
// the old `delete + new` pattern that hit calloc on every send.
static inline void resetRpcBuilder() {
  if (rpc_builder) rpc_builder->~MallocMessageBuilder();
  rpc_builder = new (rpc_builder_storage) capnp::MallocMessageBuilder(
      kj::arrayPtr(rpc_first_seg, sizeof(rpc_first_seg) / sizeof(capnp::word)));
}

// Message kind codes returned to JS; match capnp::rpc::Message::Which
// values 1-1, but exposed as a stable small-int enum for the JS layer to
// switch on.
enum CwRpcKind {
  CWR_UNKNOWN     = 0,
  CWR_BOOTSTRAP   = 1,
  CWR_CALL        = 2,
  CWR_RETURN      = 3,
  CWR_FINISH      = 4,
  CWR_RESOLVE     = 5,
  CWR_RELEASE     = 6,
  CWR_DISEMBARGO  = 7,
  CWR_ABORT       = 8,
};

// Write rpc_builder's segments directly to cpp_out as a transport-framed
// message: a 4-byte little-endian length prefix followed by the Cap'n
// Proto bytes (segment table + segments). Returns total bytes written
// (4 + payload). Skips messageToFlatArray's intermediate kj::Array<word>
// allocation entirely.
//
// Layout in cpp_out:
//   [0..4]      transport length prefix (u32 LE = payload size in bytes)
//   [4..4+T]    Cap'n Proto segment table, T bytes (padded to 8-byte align)
//   [4+T..]     segment data, concatenated
static uint32_t finalizeRpcBuilder() {
  auto segments = rpc_builder->getSegmentsForOutput();
  uint32_t segCount = segments.size();
  if (segCount == 0) return 0;

  uint32_t tableBytes = 4 * (1 + segCount);
  if (tableBytes % 8 != 0) tableBytes += 4;

  uint32_t totalCapn = tableBytes;
  for (uint32_t i = 0; i < segCount; i++) {
    totalCapn += static_cast<uint32_t>(segments[i].size() * sizeof(capnp::word));
  }
  if (4 + totalCapn > SCRATCH_CAP) return 0;

  // Length prefix.
  uint32_t lenLE = totalCapn;
  std::memcpy(cpp_out, &lenLE, 4);

  // Segment table at cpp_out + 4.
  uint32_t* table = reinterpret_cast<uint32_t*>(cpp_out + 4);
  table[0] = segCount - 1;
  for (uint32_t i = 0; i < segCount; i++) {
    table[i + 1] = static_cast<uint32_t>(segments[i].size());
  }
  if (4 * (1 + segCount) != tableBytes) {
    table[1 + segCount] = 0;
  }

  // Segments after the table.
  uint32_t pos = 4 + tableBytes;
  for (uint32_t i = 0; i < segCount; i++) {
    auto seg = segments[i];
    uint32_t segBytes = static_cast<uint32_t>(seg.size() * sizeof(capnp::word));
    std::memcpy(cpp_out + pos, seg.begin(), segBytes);
    pos += segBytes;
  }
  return pos;
}

// Build: bootstrap question. Returns framed bytes in cpp_out.
uint32_t cpp_rpc_build_bootstrap(uint32_t question_id) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto boot = msg.initBootstrap();
  boot.setQuestionId(question_id);
  return finalizeRpcBuilder();
}

// Build: a Call to a target. `target_kind` selects the MessageTarget union:
//   0 = importedCap (target_id is the import id)
//   1 = promisedAnswer (target_id is the question id this call pipes off of)
// `params_len` bytes are pre-staged in cpp_in as the serialized params struct
// (which the caller built via the application's typed Builder; we copy it
// in as the params section's raw payload).
uint32_t cpp_rpc_build_call(
    uint32_t question_id,
    uint8_t  target_kind,
    uint64_t target_id,
    uint64_t interface_id,
    uint16_t method_id,
    uint32_t params_len) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto call = msg.initCall();
  call.setQuestionId(question_id);
  if (target_kind == 0) {
    call.initTarget().setImportedCap(static_cast<uint32_t>(target_id));
  } else {
    auto pa = call.initTarget().initPromisedAnswer();
    pa.setQuestionId(static_cast<uint32_t>(target_id));
  }
  call.setInterfaceId(interface_id);
  call.setMethodId(method_id);
  // Params are themselves an AnyPointer struct. Re-parse the staged bytes as
  // a Cap'n Proto message and copy its root into the call's params field.
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      params_len / sizeof(capnp::word));
  capnp::FlatArrayMessageReader paramsReader(words);
  auto payload = call.initParams();
  payload.getContent().setAs<capnp::AnyPointer>(paramsReader.getRoot<capnp::AnyPointer>());
  return finalizeRpcBuilder();
}

// Build: a Return for a previously-received call.
//   kind = 0  results (results_len bytes pre-staged in cpp_in)
//   kind = 1  exception (exception type code in target_id, message in cpp_in)
//   kind = 2  canceled
uint32_t cpp_rpc_build_return(uint32_t answer_id, uint8_t kind, uint32_t results_len) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto ret = msg.initReturn();
  ret.setAnswerId(answer_id);
  if (kind == 0) {
    auto words = kj::ArrayPtr<const capnp::word>(
        reinterpret_cast<const capnp::word*>(cpp_in),
        results_len / sizeof(capnp::word));
    capnp::FlatArrayMessageReader resultsReader(words);
    auto payload = ret.initResults();
    payload.getContent().setAs<capnp::AnyPointer>(resultsReader.getRoot<capnp::AnyPointer>());
  } else if (kind == 1) {
    auto exc = ret.initException();
    exc.setReason(capnp::Text::Reader(reinterpret_cast<const char*>(cpp_in), results_len));
  } else {
    ret.setCanceled();
  }
  return finalizeRpcBuilder();
}

uint32_t cpp_rpc_build_finish(uint32_t question_id) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto fin = msg.initFinish();
  fin.setQuestionId(question_id);
  return finalizeRpcBuilder();
}

uint32_t cpp_rpc_build_release(uint32_t import_id, uint32_t refcount) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto rel = msg.initRelease();
  rel.setId(import_id);
  rel.setReferenceCount(refcount);
  return finalizeRpcBuilder();
}

// Decode incoming RPC message in cpp_in[0..len]. Returns the kind code.
// Combined decode + summary writer. Returns the message kind AND writes
// the kind-specific summary at cpp_out so JS reads everything it needs
// from one boundary crossing instead of two (decode + get_*_summary).
//
// Layouts written to cpp_out per kind:
//   CALL:    28 bytes (questionId, targetKind, targetId, interfaceId, methodId)
//   RETURN:  12 bytes (answerId, retKind, capCount)
//   FINISH:   4 bytes (questionId)
//   RELEASE:  8 bytes (id, refcount)
//   BOOTSTRAP:4 bytes (questionId)
//   RESOLVE: 12 bytes (promiseId, kind, capDescKind)
//   DISEMBARGO: 16 bytes (contextKind, embargoId, targetKind, targetId)
//   ABORT:    0 bytes (reason fetched separately via get_abort_reason)
//
// JS callers can drop the separate get_*_summary call.
int32_t cpp_rpc_decode(uint32_t bytes_len) {
  if (rpc_reader) {
    rpc_reader->~FlatArrayMessageReader();
    rpc_reader = nullptr;
  }
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      bytes_len / sizeof(capnp::word));
  rpc_reader = new (rpc_reader_storage) capnp::FlatArrayMessageReader(words);
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  uint32_t* w32 = reinterpret_cast<uint32_t*>(cpp_out);
  switch (msg.which()) {
    case capnp::rpc::Message::CALL: {
      auto call = msg.getCall();
      auto t = call.getTarget();
      uint32_t targetKind = 0; uint64_t targetId = 0;
      if (t.isImportedCap()) { targetKind = 0; targetId = t.getImportedCap(); }
      else if (t.isPromisedAnswer()) { targetKind = 1; targetId = t.getPromisedAnswer().getQuestionId(); }
      uint32_t questionId = call.getQuestionId();
      uint64_t interfaceId = call.getInterfaceId();
      uint32_t methodId = call.getMethodId();
      std::memcpy(cpp_out + 0,  &questionId, 4);
      std::memcpy(cpp_out + 4,  &targetKind, 4);
      std::memcpy(cpp_out + 8,  &targetId, 8);
      std::memcpy(cpp_out + 16, &interfaceId, 8);
      std::memcpy(cpp_out + 24, &methodId, 4);
      return CWR_CALL;
    }
    case capnp::rpc::Message::RETURN: {
      auto ret = msg.getReturn();
      uint32_t answerId = ret.getAnswerId();
      uint32_t retKind = 0;
      uint32_t capCount = 0;
      if (ret.isResults())   { retKind = 0; capCount = ret.getResults().getCapTable().size(); }
      else if (ret.isException()) retKind = 1;
      else if (ret.isCanceled())  retKind = 2;
      else                        retKind = 3;
      std::memcpy(cpp_out + 0, &answerId, 4);
      std::memcpy(cpp_out + 4, &retKind, 4);
      std::memcpy(cpp_out + 8, &capCount, 4);
      return CWR_RETURN;
    }
    case capnp::rpc::Message::FINISH: {
      uint32_t qid = msg.getFinish().getQuestionId();
      std::memcpy(cpp_out + 0, &qid, 4);
      return CWR_FINISH;
    }
    case capnp::rpc::Message::RELEASE: {
      auto rel = msg.getRelease();
      uint32_t id = rel.getId();
      uint32_t rc = rel.getReferenceCount();
      std::memcpy(cpp_out + 0, &id, 4);
      std::memcpy(cpp_out + 4, &rc, 4);
      return CWR_RELEASE;
    }
    case capnp::rpc::Message::BOOTSTRAP: {
      uint32_t qid = msg.getBootstrap().getQuestionId();
      std::memcpy(cpp_out + 0, &qid, 4);
      return CWR_BOOTSTRAP;
    }
    case capnp::rpc::Message::RESOLVE: {
      auto rr = msg.getResolve();
      w32[0] = static_cast<uint32_t>(rr.getPromiseId());
      if (rr.which() == capnp::rpc::Resolve::EXCEPTION) { w32[1] = 1; w32[2] = 0; }
      else {
        w32[1] = 0;
        auto cap = rr.getCap();
        switch (cap.which()) {
          case capnp::rpc::CapDescriptor::NONE:               w32[2] = 0; break;
          case capnp::rpc::CapDescriptor::SENDER_HOSTED:      w32[2] = 1; break;
          case capnp::rpc::CapDescriptor::SENDER_PROMISE:     w32[2] = 2; break;
          case capnp::rpc::CapDescriptor::RECEIVER_HOSTED:    w32[2] = 3; break;
          case capnp::rpc::CapDescriptor::RECEIVER_ANSWER:    w32[2] = 4; break;
          case capnp::rpc::CapDescriptor::THIRD_PARTY_HOSTED: w32[2] = 5; break;
        }
      }
      return CWR_RESOLVE;
    }
    case capnp::rpc::Message::DISEMBARGO: {
      auto d = msg.getDisembargo();
      auto ctx = d.getContext();
      switch (ctx.which()) {
        case capnp::rpc::Disembargo::Context::SENDER_LOOPBACK:   w32[0] = 0; w32[1] = ctx.getSenderLoopback(); break;
        case capnp::rpc::Disembargo::Context::RECEIVER_LOOPBACK: w32[0] = 1; w32[1] = ctx.getReceiverLoopback(); break;
        case capnp::rpc::Disembargo::Context::ACCEPT:            w32[0] = 2; w32[1] = 0; break;
        default:                                                  w32[0] = 0xff; w32[1] = 0; break;
      }
      auto target = d.getTarget();
      if (target.which() == capnp::rpc::MessageTarget::IMPORTED_CAP) {
        w32[2] = 0; w32[3] = target.getImportedCap();
      } else {
        w32[2] = 1; w32[3] = target.getPromisedAnswer().getQuestionId();
      }
      return CWR_DISEMBARGO;
    }
    case capnp::rpc::Message::ABORT: return CWR_ABORT;
    default: return CWR_UNKNOWN;
  }
}

// Bootstrap accessors
uint32_t cpp_rpc_get_bootstrap_question_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getBootstrap().getQuestionId();
}

// ---- Abort / Resolve / Disembargo accessors --------------------------------
//
// Abort carries an Exception. We surface the textual reason; sessions
// receiving an Abort terminate immediately. Returns the byte length of the
// reason text written to cpp_out, or 0 if not an Abort or no reason.
uint32_t cpp_rpc_get_abort_reason() {
  if (!rpc_reader) return 0;
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  if (msg.which() != capnp::rpc::Message::ABORT) return 0;
  auto reason = msg.getAbort().getReason();
  if (reason.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, reason.cStr(), reason.size());
  return static_cast<uint32_t>(reason.size());
}

// Resolve summary: one boundary call returns all the metadata for a Resolve
// frame. Layout (12 bytes) at cpp_out:
//   [0..4]  promiseId   u32 LE
//   [4..8]  kind        u32 LE  (0=cap, 1=exception)
//   [8..12] capDescKind u32 LE  (0=none, 1=senderHosted, 2=senderPromise,
//                                3=receiverHosted, 4=receiverAnswer,
//                                5=thirdPartyHosted)
// Returns 1 on success, 0 if not a Resolve.
uint32_t cpp_rpc_get_resolve_summary() {
  if (!rpc_reader) return 0;
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  if (msg.which() != capnp::rpc::Message::RESOLVE) return 0;
  auto rr = msg.getResolve();
  uint32_t* w = reinterpret_cast<uint32_t*>(cpp_out);
  w[0] = static_cast<uint32_t>(rr.getPromiseId());
  if (rr.which() == capnp::rpc::Resolve::EXCEPTION) {
    w[1] = 1;
    w[2] = 0;
  } else {
    w[1] = 0;
    auto cap = rr.getCap();
    switch (cap.which()) {
      case capnp::rpc::CapDescriptor::NONE:               w[2] = 0; break;
      case capnp::rpc::CapDescriptor::SENDER_HOSTED:      w[2] = 1; break;
      case capnp::rpc::CapDescriptor::SENDER_PROMISE:     w[2] = 2; break;
      case capnp::rpc::CapDescriptor::RECEIVER_HOSTED:    w[2] = 3; break;
      case capnp::rpc::CapDescriptor::RECEIVER_ANSWER:    w[2] = 4; break;
      case capnp::rpc::CapDescriptor::THIRD_PARTY_HOSTED: w[2] = 5; break;
    }
  }
  return 1;
}

uint32_t cpp_rpc_get_resolve_cap_id() {
  if (!rpc_reader) return 0;
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  if (msg.which() != capnp::rpc::Message::RESOLVE) return 0;
  auto rr = msg.getResolve();
  if (rr.which() != capnp::rpc::Resolve::CAP) return 0;
  auto cap = rr.getCap();
  switch (cap.which()) {
    case capnp::rpc::CapDescriptor::SENDER_HOSTED:   return cap.getSenderHosted();
    case capnp::rpc::CapDescriptor::SENDER_PROMISE:  return cap.getSenderPromise();
    case capnp::rpc::CapDescriptor::RECEIVER_HOSTED: return cap.getReceiverHosted();
    default: return 0;
  }
}

uint32_t cpp_rpc_get_resolve_exception() {
  if (!rpc_reader) return 0;
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  if (msg.which() != capnp::rpc::Message::RESOLVE) return 0;
  auto rr = msg.getResolve();
  if (rr.which() != capnp::rpc::Resolve::EXCEPTION) return 0;
  auto reason = rr.getException().getReason();
  if (reason.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, reason.cStr(), reason.size());
  return static_cast<uint32_t>(reason.size());
}

// Disembargo summary: 16 bytes at cpp_out; context kind, embargo id, target
// kind, target id.
uint32_t cpp_rpc_get_disembargo_summary() {
  if (!rpc_reader) return 0;
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  if (msg.which() != capnp::rpc::Message::DISEMBARGO) return 0;
  auto d = msg.getDisembargo();
  uint32_t* w = reinterpret_cast<uint32_t*>(cpp_out);
  auto ctx = d.getContext();
  switch (ctx.which()) {
    case capnp::rpc::Disembargo::Context::SENDER_LOOPBACK:
      w[0] = 0; w[1] = ctx.getSenderLoopback(); break;
    case capnp::rpc::Disembargo::Context::RECEIVER_LOOPBACK:
      w[0] = 1; w[1] = ctx.getReceiverLoopback(); break;
    case capnp::rpc::Disembargo::Context::ACCEPT:
      w[0] = 2; w[1] = 0; break;
    default:
      w[0] = 0xff; w[1] = 0; break;
  }
  auto target = d.getTarget();
  switch (target.which()) {
    case capnp::rpc::MessageTarget::IMPORTED_CAP:
      w[2] = 0; w[3] = target.getImportedCap(); break;
    case capnp::rpc::MessageTarget::PROMISED_ANSWER:
      w[2] = 1; w[3] = target.getPromisedAnswer().getQuestionId(); break;
  }
  return 1;
}

// Build a Disembargo with a receiverLoopback context; used to echo back a
// senderLoopback from a peer.
uint32_t cpp_rpc_build_disembargo_receiver_loopback(
    uint32_t target_kind, uint32_t target_id, uint32_t embargo_id) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto d = msg.initDisembargo();
  if (target_kind == 0) {
    d.initTarget().setImportedCap(target_id);
  } else {
    d.initTarget().initPromisedAnswer().setQuestionId(target_id);
  }
  d.initContext().setReceiverLoopback(embargo_id);
  return finalizeRpcBuilder();
}

// Build a Resolve(promiseId, cap=senderHosted(capId)). Test-only.
uint32_t cpp_rpc_build_resolve_cap(uint32_t promise_id, uint32_t cap_id) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto rr = msg.initResolve();
  rr.setPromiseId(promise_id);
  rr.initCap().setSenderHosted(cap_id);
  return finalizeRpcBuilder();
}

// Build a Resolve(promiseId, exception). Test-only.
uint32_t cpp_rpc_build_resolve_exception(
    uint32_t promise_id, uint32_t reason_offset, uint32_t reason_len) {
  if (reason_offset + reason_len > SCRATCH_CAP) return 0;
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto rr = msg.initResolve();
  rr.setPromiseId(promise_id);
  kj::StringPtr reason(reinterpret_cast<const char*>(cpp_in + reason_offset), reason_len);
  auto ex = rr.initException();
  ex.setReason(reason);
  ex.setType(capnp::rpc::Exception::Type::FAILED);
  return finalizeRpcBuilder();
}

// Build a Disembargo with senderLoopback context. Test-only.
uint32_t cpp_rpc_build_disembargo_sender_loopback(
    uint32_t target_kind, uint32_t target_id, uint32_t embargo_id) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto d = msg.initDisembargo();
  if (target_kind == 0) {
    d.initTarget().setImportedCap(target_id);
  } else {
    d.initTarget().initPromisedAnswer().setQuestionId(target_id);
  }
  d.initContext().setSenderLoopback(embargo_id);
  return finalizeRpcBuilder();
}

// Build an Abort frame with the given reason. Test-only.
uint32_t cpp_rpc_build_abort(uint32_t reason_offset, uint32_t reason_len) {
  if (reason_offset + reason_len > SCRATCH_CAP) return 0;
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto ab = msg.initAbort();
  kj::StringPtr reason(reinterpret_cast<const char*>(cpp_in + reason_offset), reason_len);
  ab.setReason(reason);
  ab.setType(capnp::rpc::Exception::Type::FAILED);
  return finalizeRpcBuilder();
}

// Batched call-summary read: one wasm call returns all the per-Call
// accessors a typical inbound dispatch needs (questionId, interfaceId,
// methodId, targetKind, targetId). Saves N-1 boundary crossings on the
// hot inbound path. JS reads the packed result from cpp_out:
//   [0..4]    questionId       (u32 LE)
//   [4..8]    targetKind       (u32 LE; 0=importedCap, 1=promisedAnswer)
//   [8..16]   targetId         (u64 LE)
//   [16..24]  interfaceId      (u64 LE)
//   [24..28]  methodId         (u32 LE; really u16 but written as u32)
// Returns 1 on success, 0 if rpc_reader is null or the message isn't a Call.
uint32_t cpp_rpc_get_call_summary() {
  if (!rpc_reader) return 0;
  auto msg = rpc_reader->getRoot<capnp::rpc::Message>();
  if (!msg.isCall()) return 0;
  auto call = msg.getCall();
  uint32_t questionId  = call.getQuestionId();
  uint64_t interfaceId = call.getInterfaceId();
  uint32_t methodId    = call.getMethodId();
  uint32_t targetKind  = 0;
  uint64_t targetId    = 0;
  auto t = call.getTarget();
  if (t.isImportedCap()) {
    targetKind = 0;
    targetId = t.getImportedCap();
  } else if (t.isPromisedAnswer()) {
    targetKind = 1;
    targetId = t.getPromisedAnswer().getQuestionId();
  }
  std::memcpy(cpp_out + 0,  &questionId, 4);
  std::memcpy(cpp_out + 4,  &targetKind, 4);
  std::memcpy(cpp_out + 8,  &targetId,   8);
  std::memcpy(cpp_out + 16, &interfaceId, 8);
  std::memcpy(cpp_out + 24, &methodId,   4);
  return 1;
}

// Call accessors
uint32_t cpp_rpc_get_call_question_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getCall().getQuestionId();
}

uint64_t cpp_rpc_get_call_interface_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getCall().getInterfaceId();
}

uint32_t cpp_rpc_get_call_method_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getCall().getMethodId();
}

// Returns 0 for importedCap, 1 for promisedAnswer.
uint32_t cpp_rpc_get_call_target_kind() {
  if (!rpc_reader) return 0;
  auto t = rpc_reader->getRoot<capnp::rpc::Message>().getCall().getTarget();
  switch (t.which()) {
    case capnp::rpc::MessageTarget::IMPORTED_CAP:    return 0;
    case capnp::rpc::MessageTarget::PROMISED_ANSWER: return 1;
  }
  return 0;
}

uint32_t cpp_rpc_get_call_target_id() {
  if (!rpc_reader) return 0;
  auto t = rpc_reader->getRoot<capnp::rpc::Message>().getCall().getTarget();
  if (t.isImportedCap()) return t.getImportedCap();
  if (t.isPromisedAnswer()) return t.getPromisedAnswer().getQuestionId();
  return 0;
}

// Copy the call's params payload (as framed bytes) into cpp_out so JS can
// re-parse with the application-level typed reader.
uint32_t cpp_rpc_get_call_params() {
  if (!rpc_reader) return 0;
  auto params = rpc_reader->getRoot<capnp::rpc::Message>().getCall().getParams();
  capnp::MallocMessageBuilder tmp;
  tmp.initRoot<capnp::AnyPointer>().set(params.getContent());
  auto words = capnp::messageToFlatArray(tmp);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

// Return accessors
uint32_t cpp_rpc_get_return_answer_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getReturn().getAnswerId();
}

// 0 = results, 1 = exception, 2 = canceled, 3 = other
uint32_t cpp_rpc_get_return_kind() {
  if (!rpc_reader) return 3;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (ret.isResults())   return 0;
  if (ret.isException()) return 1;
  if (ret.isCanceled())  return 2;
  return 3;
}

// Pack the three Return accessors JS reads on every Return into one
// boundary call. Layout in cpp_out:
//   [0..4]   answerId
//   [4..8]   retKind  (0=results, 1=exception, 2=canceled, 3=other)
//   [8..12]  capCount (0 if retKind != results)
// Returns 1 on success, 0 if no rpc_reader is live.
uint32_t cpp_rpc_get_return_summary() {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  uint32_t answerId = ret.getAnswerId();
  uint32_t retKind  = 3;
  uint32_t capCount = 0;
  if (ret.isResults()) {
    retKind = 0;
    capCount = ret.getResults().getCapTable().size();
  } else if (ret.isException()) {
    retKind = 1;
  } else if (ret.isCanceled()) {
    retKind = 2;
  }
  std::memcpy(cpp_out + 0, &answerId, 4);
  std::memcpy(cpp_out + 4, &retKind,  4);
  std::memcpy(cpp_out + 8, &capCount, 4);
  return 1;
}

uint32_t cpp_rpc_get_return_results() {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (!ret.isResults()) return 0;
  capnp::MallocMessageBuilder tmp;
  tmp.initRoot<capnp::AnyPointer>().set(ret.getResults().getContent());
  auto words = capnp::messageToFlatArray(tmp);
  auto bytes = words.asBytes();
  if (bytes.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, bytes.begin(), bytes.size());
  return static_cast<uint32_t>(bytes.size());
}

uint32_t cpp_rpc_get_return_exception() {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (!ret.isException()) return 0;
  auto reason = ret.getException().getReason();
  if (reason.size() > SCRATCH_CAP) return 0;
  std::memcpy(cpp_out, reason.cStr(), reason.size());
  return static_cast<uint32_t>(reason.size());
}

uint32_t cpp_rpc_get_finish_question_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getFinish().getQuestionId();
}

// Release accessors. The peer is dropping `referenceCount` references to
// the cap at export id `id`. JS uses this to remove entries from its local
// cap table once refcount reaches zero.
uint32_t cpp_rpc_get_release_id() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getRelease().getId();
}

uint32_t cpp_rpc_get_release_refcount() {
  if (!rpc_reader) return 0;
  return rpc_reader->getRoot<capnp::rpc::Message>().getRelease().getReferenceCount();
}

// ---- Capability passing -------------------------------------------------
//
// The RPC layer in JS keeps the local-cap and import tables; the C++ side
// just encodes/decodes the wire bits of Payload.capTable. We support only
// senderHosted descriptors here; the most common case; which lets a peer
// say "this cap in my reply lives in my local export table at id N." When
// a richer descriptor variant arrives (promise/answer/thirdParty), the JS
// layer can fall back to ignoring it.

// Build a Return whose Payload.capTable carries `cap_count` senderHosted
// descriptors. The export ids are pre-staged in cpp_in as a packed array
// of uint32_t (little-endian). The Payload's content is left null  - 
// callers that want both struct content and caps would need a richer
// builder that's not in this minimal MVP.
uint32_t cpp_rpc_build_return_with_caps(
    uint32_t answer_id,
    uint32_t cap_count) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto ret = msg.initReturn();
  ret.setAnswerId(answer_id);
  auto payload = ret.initResults();
  auto caps = payload.initCapTable(cap_count);
  for (uint32_t i = 0; i < cap_count; i++) {
    uint32_t exportId;
    std::memcpy(&exportId, cpp_in + i * 4, 4);
    caps[i].setSenderHosted(exportId);
  }
  // Content stays as default null AnyPointer; client knows from cap_count
  // > 0 to look at the capTable.
  return finalizeRpcBuilder();
}

// Read the capTable on a Return; number of descriptors and per-index
// kind/id. Only senderHosted (kind=1) carries an export id; other kinds
// are surfaced so JS can ignore them and report the unsupported variant.
uint32_t cpp_rpc_get_return_cap_count() {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (!ret.isResults()) return 0;
  return ret.getResults().getCapTable().size();
}

// 0 = none, 1 = senderHosted, 2 = senderPromise,
// 3 = receiverHosted, 4 = receiverAnswer, 5 = thirdPartyHosted.
uint32_t cpp_rpc_get_return_cap_kind(uint32_t i) {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (!ret.isResults()) return 0;
  auto caps = ret.getResults().getCapTable();
  if (i >= caps.size()) return 0;
  switch (caps[i].which()) {
    case capnp::rpc::CapDescriptor::NONE:               return 0;
    case capnp::rpc::CapDescriptor::SENDER_HOSTED:      return 1;
    case capnp::rpc::CapDescriptor::SENDER_PROMISE:     return 2;
    case capnp::rpc::CapDescriptor::RECEIVER_HOSTED:    return 3;
    case capnp::rpc::CapDescriptor::RECEIVER_ANSWER:    return 4;
    case capnp::rpc::CapDescriptor::THIRD_PARTY_HOSTED: return 5;
  }
  return 0;
}

// For senderHosted/senderPromise this returns the peer's export id; for
// receiverHosted, the import id. Other kinds return 0.
uint32_t cpp_rpc_get_return_cap_id(uint32_t i) {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (!ret.isResults()) return 0;
  auto caps = ret.getResults().getCapTable();
  if (i >= caps.size()) return 0;
  auto desc = caps[i];
  if (desc.isSenderHosted())   return desc.getSenderHosted();
  if (desc.isSenderPromise())  return desc.getSenderPromise();
  if (desc.isReceiverHosted()) return desc.getReceiverHosted();
  return 0;
}

// ---- Zero-copy build/read paths -----------------------------------------
//
// The earlier cpp_rpc_build_call / cpp_rpc_get_call_params pair deep-copies
// the application's params bytes into / out of the RPC MessageBuilder via
// setAs<AnyPointer>. That destroys Cap'n Proto's zero-copy guarantee for
// the RPC wrap.
//
// These zero-copy entry points let the application's Builder write its
// params directly into Call.params.content's arena (and the application's
// Reader read directly out of inbound Call.params.content's arena). The
// only memory the params data ever lives in is the rpc_builder/rpc_reader
// itself; no intermediate buffer, no copy.

// Begin a Call: initialize rpc_builder with the Call header AND point
// any_builder_root at Call.params.content as an AnyStruct of the requested
// shape. The application's Builder JS code then calls cpp_any_builder_set_*
// as usual; those writes land directly in the rpc_builder's arena.
uint32_t cpp_rpc_begin_call(
    uint32_t question_id,
    uint8_t  target_kind,
    uint64_t target_id,
    uint64_t interface_id,
    uint16_t method_id,
    uint32_t data_words,
    uint32_t ptr_words) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto call = msg.initCall();
  call.setQuestionId(question_id);
  if (target_kind == 0) {
    call.initTarget().setImportedCap(static_cast<uint32_t>(target_id));
  } else {
    auto pa = call.initTarget().initPromisedAnswer();
    pa.setQuestionId(static_cast<uint32_t>(target_id));
  }
  call.setInterfaceId(interface_id);
  call.setMethodId(method_id);
  auto payload = call.initParams();
  // Tear down any prior any_builder_root + nested cursors before re-rooting.
  while (cursor_depth > 0) {
    cursor_stack[cursor_depth]->~Builder();
    cursor_stack[cursor_depth] = nullptr;
    cursor_depth--;
  }
  if (any_builder_root) { any_builder_root->~Builder(); any_builder_root = nullptr; cursor_stack[0] = nullptr; }
  if (any_builder)      { delete any_builder; any_builder = nullptr; }
  auto contentAnyStruct = payload.getContent().initAsAnyStruct(data_words, ptr_words);
  static_assert(sizeof(capnp::AnyStruct::Builder) <= sizeof(any_builder_root_storage),
                "any_builder_root_storage too small");
  any_builder_root = new (any_builder_root_storage) capnp::AnyStruct::Builder(kj::mv(contentAnyStruct));
  cursor_stack[0] = any_builder_root;
  cursor_depth = 0;
  // Return the data section pointer instead of a 0/1 success; the JS
  // Builder needs it on every call, and combining the lookup with the
  // begin_call op saves a wasm boundary crossing per outbound Call.
  return reinterpret_cast<uint32_t>(any_builder_root->getDataSection().begin());
}

// Begin a Return with results: set up rpc_builder + Return header, point
// any_builder_root at Results.content. Mirror of cpp_rpc_begin_call.
uint32_t cpp_rpc_begin_return(
    uint32_t answer_id,
    uint32_t data_words,
    uint32_t ptr_words) {
  resetRpcBuilder();
  auto msg = rpc_builder->initRoot<capnp::rpc::Message>();
  auto ret = msg.initReturn();
  ret.setAnswerId(answer_id);
  auto payload = ret.initResults();
  while (cursor_depth > 0) {
    cursor_stack[cursor_depth]->~Builder();
    cursor_stack[cursor_depth] = nullptr;
    cursor_depth--;
  }
  if (any_builder_root) { any_builder_root->~Builder(); any_builder_root = nullptr; cursor_stack[0] = nullptr; }
  if (any_builder)      { delete any_builder; any_builder = nullptr; }
  auto contentAnyStruct = payload.getContent().initAsAnyStruct(data_words, ptr_words);
  any_builder_root = new (any_builder_root_storage) capnp::AnyStruct::Builder(kj::mv(contentAnyStruct));
  cursor_stack[0] = any_builder_root;
  cursor_depth = 0;
  // Return data section pointer for the same reason as begin_call above:
  // saves a wasm boundary crossing per outbound Return.
  return reinterpret_cast<uint32_t>(any_builder_root->getDataSection().begin());
}

// All cpp_rpc_build_* and cpp_rpc_begin_*/finalize variants emit
// transport-framed bytes (length prefix + Cap'n Proto) at cpp_out via
// finalizeRpcBuilder. This single export wraps it so the JS-side
// callBuilder.send() path can flatten the in-progress rpc_builder.
uint32_t cpp_rpc_finalize() {
  if (!rpc_builder) return 0;
  return finalizeRpcBuilder();
}

// Open the inbound Call's params.content as an AnyStruct on the reader
// stack so the application's typed Reader can pull fields directly out
// of the rpc_reader's memory; no intermediate flat-array materialization.
uint32_t cpp_rpc_open_call_params() {
  if (!rpc_reader) return 0;
  auto params = rpc_reader->getRoot<capnp::rpc::Message>().getCall().getParams();
  any_stack(0) = params.getContent().getAs<capnp::AnyStruct>();
  any_stack_top = 0;
  // Return the data section address so the JS Reader can read primitives
  // straight from wasm memory; no per-field cpp_any_*_at boundary call.
  return reinterpret_cast<uint32_t>(any_stack(0).getDataSection().begin());
}

// Open the inbound Return's results.content as an AnyStruct on the reader
// stack. Used on the client side after a Call's promise resolves.
uint32_t cpp_rpc_open_return_results() {
  if (!rpc_reader) return 0;
  auto ret = rpc_reader->getRoot<capnp::rpc::Message>().getReturn();
  if (!ret.isResults()) return 0;
  any_stack(0) = ret.getResults().getContent().getAs<capnp::AnyStruct>();
  any_stack_top = 0;
  return reinterpret_cast<uint32_t>(any_stack(0).getDataSection().begin());
}

// ---------------------------------------------------------------------------

uint32_t cpp_deserialize_to_tape(uint32_t bytes_len) {
  // The framed message starts with stream-framing header. We use
  // FlatArrayMessageReader since cpp_in is a contiguous buffer.
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      bytes_len / sizeof(capnp::word));
  capnp::FlatArrayMessageReader reader(words);
  auto msg = reader.getRoot<Message>();

  TapeWriter w{cpp_out, cpp_out + SCRATCH_CAP};
  switch (msg.which()) {
    case Message::PUSH: w.u8(0); decodeExpression(msg.getPush(), w); break;
    case Message::PULL: w.u8(1); w.i64(msg.getPull()); break;
    case Message::RESOLVE: {
      auto rr = msg.getResolve();
      w.u8(2); w.i64(rr.getId());
      decodeExpression(rr.getExpr(), w);
      break;
    }
    case Message::REJECT: {
      auto rr = msg.getReject();
      w.u8(3); w.i64(rr.getId());
      decodeExpression(rr.getExpr(), w);
      break;
    }
    case Message::RELEASE: {
      auto rel = msg.getRelease();
      w.u8(4); w.i64(rel.getId()); w.u32(rel.getRefcount());
      break;
    }
    case Message::STREAM: w.u8(5); decodeExpression(msg.getStream(), w); break;
    case Message::ABORT: w.u8(6); decodeExpression(msg.getAbort(), w); break;
    case Message::PIPE: w.u8(7); break;
  }
  return static_cast<uint32_t>(w.p - cpp_out);
}

} // extern "C"
