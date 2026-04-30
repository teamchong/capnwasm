// C-ABI wrapper exposing real capnproto C++ serialize/deserialize to JS.
// Linked statically with capnp + kj source via `zig cc`, no emscripten.

#include "schema.capnp.h"
#include "typed_schema.capnp.h"
#include "big_schema.capnp.h"
#include <capnp/serialize.h>
#include <capnp/message.h>
#include <capnp/any.h>
#include <kj/array.h>
#include <kj/io.h>
#include <cstring>
#include <cstdint>
#include <cstdio>
#include <new>

// Note: __cxa_allocate_exception and __cxa_throw are provided by linking
// zig's libcxxabi cxa_exception.cpp directly into the build (see build.sh).

extern "C" {

// Scratch regions in linear memory shared with JS.
constexpr size_t SCRATCH_CAP = 256 * 1024;
alignas(8) static uint8_t cpp_in[SCRATCH_CAP];
alignas(8) static uint8_t cpp_out[SCRATCH_CAP];

// Separate input region for lazy-mode side-channel calls (e.g. fieldsText
// name list). Decoupled so lazy mode's input doesn't clobber cpp_in, which
// the lazy reader points at after cpp_lazy_open.
constexpr size_t LAZY_AUX_CAP = 8 * 1024;
alignas(8) static uint8_t cpp_lazy_aux[LAZY_AUX_CAP];

uint8_t* cpp_in_ptr() { return cpp_in; }
uint8_t* cpp_out_ptr() { return cpp_out; }
uint32_t cpp_in_capacity() { return SCRATCH_CAP; }
uint32_t cpp_out_capacity() { return SCRATCH_CAP; }
uint8_t* cpp_lazy_aux_ptr() { return cpp_lazy_aux; }
uint32_t cpp_lazy_aux_capacity() { return LAZY_AUX_CAP; }

uint32_t cpp_abi_version() { return 1; }

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
// for — skip materializing the whole tree, fetch only what's read.
// ---------------------------------------------------------------------------

// Heap-allocated reader so its lifetime spans many cpp_lazy_* calls.
// Cleared on each cpp_lazy_open. Uses MallocMessageBuilder's allocator
// indirectly via FlatArrayMessageReader (which is a value-type).
alignas(8) static char lazy_reader_storage[1024];
static capnp::FlatArrayMessageReader* lazy_reader = nullptr;

uint32_t cpp_lazy_open(uint32_t bytes_len) {
  if (lazy_reader) {
    lazy_reader->~FlatArrayMessageReader();
    lazy_reader = nullptr;
  }
  static_assert(sizeof(capnp::FlatArrayMessageReader) <= sizeof(lazy_reader_storage),
                "lazy_reader_storage too small");
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      bytes_len / sizeof(capnp::word));
  lazy_reader = new (lazy_reader_storage) capnp::FlatArrayMessageReader(words);
  return 1;
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
// Input layout in cpp_in (after lazy_open already consumed it — the JS side
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
// deploy — fields by integer offset, not string lookup.
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

// Forward decl — the AnyStruct section below owns the storage.
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
// Generic AnyStruct navigation. One wasm binary serves every user schema:
// codegen-emitted JS classes know each field's offset (computed at build time
// from the .capnp file) and call these primitives to read individual fields.
// No string lookups, no schema reflection at runtime.
// ---------------------------------------------------------------------------

alignas(8) static char any_reader_storage[1024];
capnp::FlatArrayMessageReader* any_reader = nullptr;

// Stack of struct readers so generated code can navigate into sub-structs
// without persisting opaque handles in JS.
constexpr size_t ANY_STACK_DEPTH = 32;
static capnp::AnyStruct::Reader any_stack[ANY_STACK_DEPTH];
static int32_t any_stack_top = -1;

uint32_t cpp_any_open(uint32_t bytes_len) {
  if (any_reader) {
    any_reader->~FlatArrayMessageReader();
    any_reader = nullptr;
  }
  static_assert(sizeof(capnp::FlatArrayMessageReader) <= sizeof(any_reader_storage),
                "any_reader_storage too small");
  auto words = kj::ArrayPtr<const capnp::word>(
      reinterpret_cast<const capnp::word*>(cpp_in),
      bytes_len / sizeof(capnp::word));
  any_reader = new (any_reader_storage) capnp::FlatArrayMessageReader(words);
  any_stack_top = 0;
  any_stack[0] = any_reader->getRoot<capnp::AnyPointer>().getAs<capnp::AnyStruct>();
  return 1;
}

// Push the struct at pointer slot `ptr_idx` of the current top onto the stack.
// Returns 1 on success, 0 if the pointer is null or out of range.
uint32_t cpp_any_enter_struct(uint32_t ptr_idx) {
  if (any_stack_top < 0 || any_stack_top + 1 >= (int32_t)ANY_STACK_DEPTH) return 0;
  auto top = any_stack[any_stack_top];
  auto ptrs = top.getPointerSection();
  if (ptr_idx >= ptrs.size()) return 0;
  auto sub = ptrs[ptr_idx].getAs<capnp::AnyStruct>();
  any_stack_top++;
  any_stack[any_stack_top] = sub;
  return 1;
}

void cpp_any_leave_struct() {
  if (any_stack_top > 0) any_stack_top--;
}

// Read a Text from pointer slot `ptr_idx` of the current top struct.
// Copies bytes to cpp_out, returns count. 0 if missing / non-text.
uint32_t cpp_any_text_at(uint32_t ptr_idx) {
  if (any_stack_top < 0) return 0;
  auto top = any_stack[any_stack_top];
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
  auto top = any_stack[any_stack_top];
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
  auto top = any_stack[any_stack_top];
  auto data = top.getDataSection();
  if (byte_offset + 8 > data.size()) return default_val;
  int64_t v;
  std::memcpy(&v, data.begin() + byte_offset, 8);
  return v ^ default_val;
}

uint32_t cpp_any_uint32_at(uint32_t byte_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack[any_stack_top];
  auto data = top.getDataSection();
  if (byte_offset + 4 > data.size()) return default_val;
  uint32_t v;
  std::memcpy(&v, data.begin() + byte_offset, 4);
  return v ^ default_val;
}

uint32_t cpp_any_uint16_at(uint32_t byte_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack[any_stack_top];
  auto data = top.getDataSection();
  if (byte_offset + 2 > data.size()) return default_val;
  uint16_t v;
  std::memcpy(&v, data.begin() + byte_offset, 2);
  return static_cast<uint32_t>(v) ^ default_val;
}

uint32_t cpp_any_uint8_at(uint32_t byte_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack[any_stack_top];
  auto data = top.getDataSection();
  if (byte_offset >= data.size()) return default_val;
  uint8_t v = data[byte_offset];
  return static_cast<uint32_t>(v) ^ default_val;
}

uint32_t cpp_any_bool_at(uint32_t bit_offset, uint32_t default_val) {
  if (any_stack_top < 0) return default_val;
  auto top = any_stack[any_stack_top];
  auto data = top.getDataSection();
  uint32_t byte = bit_offset / 8;
  uint32_t bit = bit_offset & 7;
  if (byte >= data.size()) return default_val;
  uint32_t v = (data[byte] >> bit) & 1;
  return v ^ (default_val & 1);
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
