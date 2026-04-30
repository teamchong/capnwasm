// C-ABI wrapper exposing real capnproto C++ serialize/deserialize to JS.
// Linked statically with capnp + kj source via `zig cc`, no emscripten.

#include "schema.capnp.h"
#include <capnp/serialize.h>
#include <capnp/message.h>
#include <kj/array.h>
#include <kj/io.h>
#include <cstring>
#include <cstdint>

// Note: __cxa_allocate_exception and __cxa_throw are provided by linking
// zig's libcxxabi cxa_exception.cpp directly into the build (see build.sh).

extern "C" {

// Scratch regions in linear memory shared with JS.
constexpr size_t SCRATCH_CAP = 256 * 1024;
alignas(8) static uint8_t cpp_in[SCRATCH_CAP];
alignas(8) static uint8_t cpp_out[SCRATCH_CAP];

uint8_t* cpp_in_ptr() { return cpp_in; }
uint8_t* cpp_out_ptr() { return cpp_out; }
uint32_t cpp_in_capacity() { return SCRATCH_CAP; }
uint32_t cpp_out_capacity() { return SCRATCH_CAP; }

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
