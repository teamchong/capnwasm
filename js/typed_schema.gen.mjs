// Generated from typed_schema.capnp by capnwasm-gen — do not edit by hand.

const SHARED_TEXT_DECODER = new TextDecoder();
function decodeAscii(bytes) {
  let asciiOk = true;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { asciiOk = false; break; }
  if (asciiOk) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  return SHARED_TEXT_DECODER.decode(bytes);
}

export class WideUserDataReader {
  constructor(cpp) { this._cpp = cpp; }

  get field0() {
    const len = this._cpp._exports.cpp_any_text_at(0);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field1() {
    const len = this._cpp._exports.cpp_any_text_at(1);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field2() {
    const len = this._cpp._exports.cpp_any_text_at(2);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field3() {
    const len = this._cpp._exports.cpp_any_text_at(3);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field4() {
    const len = this._cpp._exports.cpp_any_text_at(4);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field5() {
    const len = this._cpp._exports.cpp_any_text_at(5);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field6() {
    const len = this._cpp._exports.cpp_any_text_at(6);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field7() {
    const len = this._cpp._exports.cpp_any_text_at(7);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field8() {
    const len = this._cpp._exports.cpp_any_text_at(8);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field9() {
    const len = this._cpp._exports.cpp_any_text_at(9);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field10() {
    const len = this._cpp._exports.cpp_any_text_at(10);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field11() {
    const len = this._cpp._exports.cpp_any_text_at(11);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field12() {
    const len = this._cpp._exports.cpp_any_text_at(12);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field13() {
    const len = this._cpp._exports.cpp_any_text_at(13);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field14() {
    const len = this._cpp._exports.cpp_any_text_at(14);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field15() {
    const len = this._cpp._exports.cpp_any_text_at(15);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field16() {
    const len = this._cpp._exports.cpp_any_text_at(16);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field17() {
    const len = this._cpp._exports.cpp_any_text_at(17);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field18() {
    const len = this._cpp._exports.cpp_any_text_at(18);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field19() {
    const len = this._cpp._exports.cpp_any_text_at(19);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field20() {
    const len = this._cpp._exports.cpp_any_text_at(20);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field21() {
    const len = this._cpp._exports.cpp_any_text_at(21);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field22() {
    const len = this._cpp._exports.cpp_any_text_at(22);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field23() {
    const len = this._cpp._exports.cpp_any_text_at(23);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field24() {
    const len = this._cpp._exports.cpp_any_text_at(24);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field25() {
    const len = this._cpp._exports.cpp_any_text_at(25);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field26() {
    const len = this._cpp._exports.cpp_any_text_at(26);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field27() {
    const len = this._cpp._exports.cpp_any_text_at(27);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field28() {
    const len = this._cpp._exports.cpp_any_text_at(28);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field29() {
    const len = this._cpp._exports.cpp_any_text_at(29);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field30() {
    const len = this._cpp._exports.cpp_any_text_at(30);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field31() {
    const len = this._cpp._exports.cpp_any_text_at(31);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a WideUserDataReader.
 */
export function openWideUserData(cpp, bytes) {
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  if (cpp._exports.cpp_any_open(bytes.length) !== 1) throw new Error("cpp_any_open failed");
  return new WideUserDataReader(cpp);
}
