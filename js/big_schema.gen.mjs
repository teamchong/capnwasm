// Generated from big_schema.capnp by capnwasm-gen — do not edit by hand.

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

const _F32_VIEW_BUF = new ArrayBuffer(4);
const _F32_VIEW_U32 = new Uint32Array(_F32_VIEW_BUF);
const _F32_VIEW_F32 = new Float32Array(_F32_VIEW_BUF);
const _F64_VIEW_BUF = new ArrayBuffer(8);
const _F64_VIEW_U32 = new Uint32Array(_F64_VIEW_BUF);
const _F64_VIEW_F64 = new Float64Array(_F64_VIEW_BUF);

// Per-(class, field-list) cache of pre-encoded request bytes. Compiling the
// request is a tight loop but it's still wasted work in a hot pick loop.
// We key on a frozen Uint8Array of the descriptor bytes so identical field
// sets (the common case in batch processing) hit the cache.
const _PICK_REQ_CACHE = new WeakMap();  // fields -> Map<namesKey, Uint8Array>

function _getPickRequest(fields, names) {
  let perFields = _PICK_REQ_CACHE.get(fields);
  if (!perFields) { perFields = new Map(); _PICK_REQ_CACHE.set(fields, perFields); }
  const key = names.join("\0");
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

function _capnwasmPick(cpp, fields, names) {
  // Cached request prep — same names hit the WeakMap and skip the encode loop.
  const req = _getPickRequest(fields, names);
  const u8 = cpp._u8;
  const aux = cpp._exports.cpp_lazy_aux_ptr();
  u8.set(req, aux);
  const descs = new Array(names.length);
  for (let i = 0; i < names.length; i++) descs[i] = fields[names[i]];
  const written = cpp._exports.cpp_any_batch_read(req.length);
  if (!written) return Object.fromEntries(names.map((n) => [n, undefined]));
  const out = cpp._outPtr;
  const u8After = cpp._u8;
  const dv2 = new DataView(u8After.buffer, out);
  let readPos = names.length * 4;
  const result = {};
  for (let i = 0; i < names.length; i++) {
    const lenOrVal = dv2.getUint32(i * 4, true);
    const d = descs[i];
    switch (d.type) {
      case "text": {
        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }
        if (lenOrVal === 0) { result[names[i]] = ""; break; }
        result[names[i]] = decodeAscii(u8After.subarray(out + readPos, out + readPos + lenOrVal));
        readPos += lenOrVal;
        break;
      }
      case "data": {
        if (lenOrVal === 0xFFFFFFFF) { result[names[i]] = undefined; break; }
        result[names[i]] = u8After.slice(out + readPos, out + readPos + lenOrVal);
        readPos += lenOrVal;
        break;
      }
      case "bool":   result[names[i]] = lenOrVal === 1; break;
      case "uint8":  result[names[i]] = lenOrVal; break;
      case "int8":   result[names[i]] = (lenOrVal << 24) >> 24; break;
      case "uint16": result[names[i]] = lenOrVal; break;
      case "int16":  result[names[i]] = (lenOrVal << 16) >> 16; break;
      case "uint32": result[names[i]] = lenOrVal >>> 0; break;
      case "int32":  result[names[i]] = lenOrVal | 0; break;
      case "float32": _F32_VIEW_U32[0] = lenOrVal >>> 0; result[names[i]] = _F32_VIEW_F32[0]; break;
      case "uint64":
      case "int64": {
        const lo = dv2.getUint32(out - dv2.byteOffset + readPos, true);
        const hi = dv2.getInt32 (out - dv2.byteOffset + readPos + 4, true);
        result[names[i]] = (hi >= -0x200000 && hi <= 0x1FFFFF) ? hi * 4294967296 + lo : dv2.getBigInt64(out - dv2.byteOffset + readPos, true);
        readPos += 8;
        break;
      }
      case "float64": {
        _F64_VIEW_U32[0] = dv2.getUint32(out - dv2.byteOffset + readPos, true);
        _F64_VIEW_U32[1] = dv2.getUint32(out - dv2.byteOffset + readPos + 4, true);
        result[names[i]] = _F64_VIEW_F64[0];
        readPos += 8;
        break;
      }
      default: result[names[i]] = undefined;
    }
  }
  return result;
}

export class BigUserReader {
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
  get field32() {
    const len = this._cpp._exports.cpp_any_text_at(32);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field33() {
    const len = this._cpp._exports.cpp_any_text_at(33);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field34() {
    const len = this._cpp._exports.cpp_any_text_at(34);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field35() {
    const len = this._cpp._exports.cpp_any_text_at(35);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field36() {
    const len = this._cpp._exports.cpp_any_text_at(36);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field37() {
    const len = this._cpp._exports.cpp_any_text_at(37);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field38() {
    const len = this._cpp._exports.cpp_any_text_at(38);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field39() {
    const len = this._cpp._exports.cpp_any_text_at(39);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field40() {
    const len = this._cpp._exports.cpp_any_text_at(40);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field41() {
    const len = this._cpp._exports.cpp_any_text_at(41);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field42() {
    const len = this._cpp._exports.cpp_any_text_at(42);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field43() {
    const len = this._cpp._exports.cpp_any_text_at(43);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field44() {
    const len = this._cpp._exports.cpp_any_text_at(44);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field45() {
    const len = this._cpp._exports.cpp_any_text_at(45);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field46() {
    const len = this._cpp._exports.cpp_any_text_at(46);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field47() {
    const len = this._cpp._exports.cpp_any_text_at(47);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field48() {
    const len = this._cpp._exports.cpp_any_text_at(48);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field49() {
    const len = this._cpp._exports.cpp_any_text_at(49);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field50() {
    const len = this._cpp._exports.cpp_any_text_at(50);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field51() {
    const len = this._cpp._exports.cpp_any_text_at(51);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field52() {
    const len = this._cpp._exports.cpp_any_text_at(52);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field53() {
    const len = this._cpp._exports.cpp_any_text_at(53);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field54() {
    const len = this._cpp._exports.cpp_any_text_at(54);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field55() {
    const len = this._cpp._exports.cpp_any_text_at(55);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field56() {
    const len = this._cpp._exports.cpp_any_text_at(56);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field57() {
    const len = this._cpp._exports.cpp_any_text_at(57);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field58() {
    const len = this._cpp._exports.cpp_any_text_at(58);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field59() {
    const len = this._cpp._exports.cpp_any_text_at(59);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field60() {
    const len = this._cpp._exports.cpp_any_text_at(60);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field61() {
    const len = this._cpp._exports.cpp_any_text_at(61);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field62() {
    const len = this._cpp._exports.cpp_any_text_at(62);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field63() {
    const len = this._cpp._exports.cpp_any_text_at(63);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field64() {
    const len = this._cpp._exports.cpp_any_text_at(64);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field65() {
    const len = this._cpp._exports.cpp_any_text_at(65);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field66() {
    const len = this._cpp._exports.cpp_any_text_at(66);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field67() {
    const len = this._cpp._exports.cpp_any_text_at(67);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field68() {
    const len = this._cpp._exports.cpp_any_text_at(68);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field69() {
    const len = this._cpp._exports.cpp_any_text_at(69);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field70() {
    const len = this._cpp._exports.cpp_any_text_at(70);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field71() {
    const len = this._cpp._exports.cpp_any_text_at(71);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field72() {
    const len = this._cpp._exports.cpp_any_text_at(72);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field73() {
    const len = this._cpp._exports.cpp_any_text_at(73);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field74() {
    const len = this._cpp._exports.cpp_any_text_at(74);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field75() {
    const len = this._cpp._exports.cpp_any_text_at(75);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field76() {
    const len = this._cpp._exports.cpp_any_text_at(76);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field77() {
    const len = this._cpp._exports.cpp_any_text_at(77);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field78() {
    const len = this._cpp._exports.cpp_any_text_at(78);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field79() {
    const len = this._cpp._exports.cpp_any_text_at(79);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field80() {
    const len = this._cpp._exports.cpp_any_text_at(80);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field81() {
    const len = this._cpp._exports.cpp_any_text_at(81);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field82() {
    const len = this._cpp._exports.cpp_any_text_at(82);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field83() {
    const len = this._cpp._exports.cpp_any_text_at(83);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field84() {
    const len = this._cpp._exports.cpp_any_text_at(84);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field85() {
    const len = this._cpp._exports.cpp_any_text_at(85);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field86() {
    const len = this._cpp._exports.cpp_any_text_at(86);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field87() {
    const len = this._cpp._exports.cpp_any_text_at(87);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field88() {
    const len = this._cpp._exports.cpp_any_text_at(88);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field89() {
    const len = this._cpp._exports.cpp_any_text_at(89);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field90() {
    const len = this._cpp._exports.cpp_any_text_at(90);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field91() {
    const len = this._cpp._exports.cpp_any_text_at(91);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field92() {
    const len = this._cpp._exports.cpp_any_text_at(92);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field93() {
    const len = this._cpp._exports.cpp_any_text_at(93);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field94() {
    const len = this._cpp._exports.cpp_any_text_at(94);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field95() {
    const len = this._cpp._exports.cpp_any_text_at(95);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field96() {
    const len = this._cpp._exports.cpp_any_text_at(96);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field97() {
    const len = this._cpp._exports.cpp_any_text_at(97);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field98() {
    const len = this._cpp._exports.cpp_any_text_at(98);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field99() {
    const len = this._cpp._exports.cpp_any_text_at(99);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field100() {
    const len = this._cpp._exports.cpp_any_text_at(100);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field101() {
    const len = this._cpp._exports.cpp_any_text_at(101);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field102() {
    const len = this._cpp._exports.cpp_any_text_at(102);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field103() {
    const len = this._cpp._exports.cpp_any_text_at(103);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field104() {
    const len = this._cpp._exports.cpp_any_text_at(104);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field105() {
    const len = this._cpp._exports.cpp_any_text_at(105);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field106() {
    const len = this._cpp._exports.cpp_any_text_at(106);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field107() {
    const len = this._cpp._exports.cpp_any_text_at(107);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field108() {
    const len = this._cpp._exports.cpp_any_text_at(108);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field109() {
    const len = this._cpp._exports.cpp_any_text_at(109);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field110() {
    const len = this._cpp._exports.cpp_any_text_at(110);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field111() {
    const len = this._cpp._exports.cpp_any_text_at(111);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field112() {
    const len = this._cpp._exports.cpp_any_text_at(112);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field113() {
    const len = this._cpp._exports.cpp_any_text_at(113);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field114() {
    const len = this._cpp._exports.cpp_any_text_at(114);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field115() {
    const len = this._cpp._exports.cpp_any_text_at(115);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field116() {
    const len = this._cpp._exports.cpp_any_text_at(116);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field117() {
    const len = this._cpp._exports.cpp_any_text_at(117);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field118() {
    const len = this._cpp._exports.cpp_any_text_at(118);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field119() {
    const len = this._cpp._exports.cpp_any_text_at(119);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field120() {
    const len = this._cpp._exports.cpp_any_text_at(120);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field121() {
    const len = this._cpp._exports.cpp_any_text_at(121);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field122() {
    const len = this._cpp._exports.cpp_any_text_at(122);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field123() {
    const len = this._cpp._exports.cpp_any_text_at(123);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field124() {
    const len = this._cpp._exports.cpp_any_text_at(124);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field125() {
    const len = this._cpp._exports.cpp_any_text_at(125);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field126() {
    const len = this._cpp._exports.cpp_any_text_at(126);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field127() {
    const len = this._cpp._exports.cpp_any_text_at(127);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field128() {
    const len = this._cpp._exports.cpp_any_text_at(128);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field129() {
    const len = this._cpp._exports.cpp_any_text_at(129);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field130() {
    const len = this._cpp._exports.cpp_any_text_at(130);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field131() {
    const len = this._cpp._exports.cpp_any_text_at(131);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field132() {
    const len = this._cpp._exports.cpp_any_text_at(132);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field133() {
    const len = this._cpp._exports.cpp_any_text_at(133);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field134() {
    const len = this._cpp._exports.cpp_any_text_at(134);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field135() {
    const len = this._cpp._exports.cpp_any_text_at(135);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field136() {
    const len = this._cpp._exports.cpp_any_text_at(136);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field137() {
    const len = this._cpp._exports.cpp_any_text_at(137);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field138() {
    const len = this._cpp._exports.cpp_any_text_at(138);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field139() {
    const len = this._cpp._exports.cpp_any_text_at(139);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field140() {
    const len = this._cpp._exports.cpp_any_text_at(140);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field141() {
    const len = this._cpp._exports.cpp_any_text_at(141);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field142() {
    const len = this._cpp._exports.cpp_any_text_at(142);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field143() {
    const len = this._cpp._exports.cpp_any_text_at(143);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field144() {
    const len = this._cpp._exports.cpp_any_text_at(144);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field145() {
    const len = this._cpp._exports.cpp_any_text_at(145);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field146() {
    const len = this._cpp._exports.cpp_any_text_at(146);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field147() {
    const len = this._cpp._exports.cpp_any_text_at(147);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field148() {
    const len = this._cpp._exports.cpp_any_text_at(148);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field149() {
    const len = this._cpp._exports.cpp_any_text_at(149);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field150() {
    const len = this._cpp._exports.cpp_any_text_at(150);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field151() {
    const len = this._cpp._exports.cpp_any_text_at(151);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field152() {
    const len = this._cpp._exports.cpp_any_text_at(152);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field153() {
    const len = this._cpp._exports.cpp_any_text_at(153);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field154() {
    const len = this._cpp._exports.cpp_any_text_at(154);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field155() {
    const len = this._cpp._exports.cpp_any_text_at(155);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field156() {
    const len = this._cpp._exports.cpp_any_text_at(156);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field157() {
    const len = this._cpp._exports.cpp_any_text_at(157);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field158() {
    const len = this._cpp._exports.cpp_any_text_at(158);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field159() {
    const len = this._cpp._exports.cpp_any_text_at(159);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field160() {
    const len = this._cpp._exports.cpp_any_text_at(160);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field161() {
    const len = this._cpp._exports.cpp_any_text_at(161);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field162() {
    const len = this._cpp._exports.cpp_any_text_at(162);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field163() {
    const len = this._cpp._exports.cpp_any_text_at(163);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field164() {
    const len = this._cpp._exports.cpp_any_text_at(164);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field165() {
    const len = this._cpp._exports.cpp_any_text_at(165);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field166() {
    const len = this._cpp._exports.cpp_any_text_at(166);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field167() {
    const len = this._cpp._exports.cpp_any_text_at(167);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field168() {
    const len = this._cpp._exports.cpp_any_text_at(168);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field169() {
    const len = this._cpp._exports.cpp_any_text_at(169);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field170() {
    const len = this._cpp._exports.cpp_any_text_at(170);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field171() {
    const len = this._cpp._exports.cpp_any_text_at(171);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field172() {
    const len = this._cpp._exports.cpp_any_text_at(172);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field173() {
    const len = this._cpp._exports.cpp_any_text_at(173);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field174() {
    const len = this._cpp._exports.cpp_any_text_at(174);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field175() {
    const len = this._cpp._exports.cpp_any_text_at(175);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field176() {
    const len = this._cpp._exports.cpp_any_text_at(176);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field177() {
    const len = this._cpp._exports.cpp_any_text_at(177);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field178() {
    const len = this._cpp._exports.cpp_any_text_at(178);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field179() {
    const len = this._cpp._exports.cpp_any_text_at(179);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field180() {
    const len = this._cpp._exports.cpp_any_text_at(180);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field181() {
    const len = this._cpp._exports.cpp_any_text_at(181);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field182() {
    const len = this._cpp._exports.cpp_any_text_at(182);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field183() {
    const len = this._cpp._exports.cpp_any_text_at(183);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field184() {
    const len = this._cpp._exports.cpp_any_text_at(184);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field185() {
    const len = this._cpp._exports.cpp_any_text_at(185);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field186() {
    const len = this._cpp._exports.cpp_any_text_at(186);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field187() {
    const len = this._cpp._exports.cpp_any_text_at(187);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field188() {
    const len = this._cpp._exports.cpp_any_text_at(188);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field189() {
    const len = this._cpp._exports.cpp_any_text_at(189);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field190() {
    const len = this._cpp._exports.cpp_any_text_at(190);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field191() {
    const len = this._cpp._exports.cpp_any_text_at(191);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field192() {
    const len = this._cpp._exports.cpp_any_text_at(192);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field193() {
    const len = this._cpp._exports.cpp_any_text_at(193);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field194() {
    const len = this._cpp._exports.cpp_any_text_at(194);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field195() {
    const len = this._cpp._exports.cpp_any_text_at(195);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field196() {
    const len = this._cpp._exports.cpp_any_text_at(196);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field197() {
    const len = this._cpp._exports.cpp_any_text_at(197);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field198() {
    const len = this._cpp._exports.cpp_any_text_at(198);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field199() {
    const len = this._cpp._exports.cpp_any_text_at(199);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field200() {
    const len = this._cpp._exports.cpp_any_text_at(200);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field201() {
    const len = this._cpp._exports.cpp_any_text_at(201);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field202() {
    const len = this._cpp._exports.cpp_any_text_at(202);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field203() {
    const len = this._cpp._exports.cpp_any_text_at(203);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field204() {
    const len = this._cpp._exports.cpp_any_text_at(204);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field205() {
    const len = this._cpp._exports.cpp_any_text_at(205);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field206() {
    const len = this._cpp._exports.cpp_any_text_at(206);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field207() {
    const len = this._cpp._exports.cpp_any_text_at(207);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field208() {
    const len = this._cpp._exports.cpp_any_text_at(208);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field209() {
    const len = this._cpp._exports.cpp_any_text_at(209);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field210() {
    const len = this._cpp._exports.cpp_any_text_at(210);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field211() {
    const len = this._cpp._exports.cpp_any_text_at(211);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field212() {
    const len = this._cpp._exports.cpp_any_text_at(212);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field213() {
    const len = this._cpp._exports.cpp_any_text_at(213);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field214() {
    const len = this._cpp._exports.cpp_any_text_at(214);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field215() {
    const len = this._cpp._exports.cpp_any_text_at(215);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field216() {
    const len = this._cpp._exports.cpp_any_text_at(216);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field217() {
    const len = this._cpp._exports.cpp_any_text_at(217);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field218() {
    const len = this._cpp._exports.cpp_any_text_at(218);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field219() {
    const len = this._cpp._exports.cpp_any_text_at(219);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field220() {
    const len = this._cpp._exports.cpp_any_text_at(220);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field221() {
    const len = this._cpp._exports.cpp_any_text_at(221);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field222() {
    const len = this._cpp._exports.cpp_any_text_at(222);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field223() {
    const len = this._cpp._exports.cpp_any_text_at(223);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field224() {
    const len = this._cpp._exports.cpp_any_text_at(224);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field225() {
    const len = this._cpp._exports.cpp_any_text_at(225);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field226() {
    const len = this._cpp._exports.cpp_any_text_at(226);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field227() {
    const len = this._cpp._exports.cpp_any_text_at(227);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field228() {
    const len = this._cpp._exports.cpp_any_text_at(228);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field229() {
    const len = this._cpp._exports.cpp_any_text_at(229);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field230() {
    const len = this._cpp._exports.cpp_any_text_at(230);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field231() {
    const len = this._cpp._exports.cpp_any_text_at(231);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field232() {
    const len = this._cpp._exports.cpp_any_text_at(232);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field233() {
    const len = this._cpp._exports.cpp_any_text_at(233);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field234() {
    const len = this._cpp._exports.cpp_any_text_at(234);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field235() {
    const len = this._cpp._exports.cpp_any_text_at(235);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field236() {
    const len = this._cpp._exports.cpp_any_text_at(236);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field237() {
    const len = this._cpp._exports.cpp_any_text_at(237);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field238() {
    const len = this._cpp._exports.cpp_any_text_at(238);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field239() {
    const len = this._cpp._exports.cpp_any_text_at(239);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field240() {
    const len = this._cpp._exports.cpp_any_text_at(240);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field241() {
    const len = this._cpp._exports.cpp_any_text_at(241);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field242() {
    const len = this._cpp._exports.cpp_any_text_at(242);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field243() {
    const len = this._cpp._exports.cpp_any_text_at(243);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field244() {
    const len = this._cpp._exports.cpp_any_text_at(244);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field245() {
    const len = this._cpp._exports.cpp_any_text_at(245);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field246() {
    const len = this._cpp._exports.cpp_any_text_at(246);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field247() {
    const len = this._cpp._exports.cpp_any_text_at(247);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field248() {
    const len = this._cpp._exports.cpp_any_text_at(248);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field249() {
    const len = this._cpp._exports.cpp_any_text_at(249);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field250() {
    const len = this._cpp._exports.cpp_any_text_at(250);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field251() {
    const len = this._cpp._exports.cpp_any_text_at(251);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field252() {
    const len = this._cpp._exports.cpp_any_text_at(252);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field253() {
    const len = this._cpp._exports.cpp_any_text_at(253);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field254() {
    const len = this._cpp._exports.cpp_any_text_at(254);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }
  get field255() {
    const len = this._cpp._exports.cpp_any_text_at(255);
    if (len === 0) return "";
    const u8 = this._cpp._u8;
    const out = this._cpp._outPtr;
    return decodeAscii(u8.subarray(out, out + len));
  }

  static _FIELDS = {
    field0: {"kind":0,"off":0,"type":"text"},
    field1: {"kind":0,"off":1,"type":"text"},
    field2: {"kind":0,"off":2,"type":"text"},
    field3: {"kind":0,"off":3,"type":"text"},
    field4: {"kind":0,"off":4,"type":"text"},
    field5: {"kind":0,"off":5,"type":"text"},
    field6: {"kind":0,"off":6,"type":"text"},
    field7: {"kind":0,"off":7,"type":"text"},
    field8: {"kind":0,"off":8,"type":"text"},
    field9: {"kind":0,"off":9,"type":"text"},
    field10: {"kind":0,"off":10,"type":"text"},
    field11: {"kind":0,"off":11,"type":"text"},
    field12: {"kind":0,"off":12,"type":"text"},
    field13: {"kind":0,"off":13,"type":"text"},
    field14: {"kind":0,"off":14,"type":"text"},
    field15: {"kind":0,"off":15,"type":"text"},
    field16: {"kind":0,"off":16,"type":"text"},
    field17: {"kind":0,"off":17,"type":"text"},
    field18: {"kind":0,"off":18,"type":"text"},
    field19: {"kind":0,"off":19,"type":"text"},
    field20: {"kind":0,"off":20,"type":"text"},
    field21: {"kind":0,"off":21,"type":"text"},
    field22: {"kind":0,"off":22,"type":"text"},
    field23: {"kind":0,"off":23,"type":"text"},
    field24: {"kind":0,"off":24,"type":"text"},
    field25: {"kind":0,"off":25,"type":"text"},
    field26: {"kind":0,"off":26,"type":"text"},
    field27: {"kind":0,"off":27,"type":"text"},
    field28: {"kind":0,"off":28,"type":"text"},
    field29: {"kind":0,"off":29,"type":"text"},
    field30: {"kind":0,"off":30,"type":"text"},
    field31: {"kind":0,"off":31,"type":"text"},
    field32: {"kind":0,"off":32,"type":"text"},
    field33: {"kind":0,"off":33,"type":"text"},
    field34: {"kind":0,"off":34,"type":"text"},
    field35: {"kind":0,"off":35,"type":"text"},
    field36: {"kind":0,"off":36,"type":"text"},
    field37: {"kind":0,"off":37,"type":"text"},
    field38: {"kind":0,"off":38,"type":"text"},
    field39: {"kind":0,"off":39,"type":"text"},
    field40: {"kind":0,"off":40,"type":"text"},
    field41: {"kind":0,"off":41,"type":"text"},
    field42: {"kind":0,"off":42,"type":"text"},
    field43: {"kind":0,"off":43,"type":"text"},
    field44: {"kind":0,"off":44,"type":"text"},
    field45: {"kind":0,"off":45,"type":"text"},
    field46: {"kind":0,"off":46,"type":"text"},
    field47: {"kind":0,"off":47,"type":"text"},
    field48: {"kind":0,"off":48,"type":"text"},
    field49: {"kind":0,"off":49,"type":"text"},
    field50: {"kind":0,"off":50,"type":"text"},
    field51: {"kind":0,"off":51,"type":"text"},
    field52: {"kind":0,"off":52,"type":"text"},
    field53: {"kind":0,"off":53,"type":"text"},
    field54: {"kind":0,"off":54,"type":"text"},
    field55: {"kind":0,"off":55,"type":"text"},
    field56: {"kind":0,"off":56,"type":"text"},
    field57: {"kind":0,"off":57,"type":"text"},
    field58: {"kind":0,"off":58,"type":"text"},
    field59: {"kind":0,"off":59,"type":"text"},
    field60: {"kind":0,"off":60,"type":"text"},
    field61: {"kind":0,"off":61,"type":"text"},
    field62: {"kind":0,"off":62,"type":"text"},
    field63: {"kind":0,"off":63,"type":"text"},
    field64: {"kind":0,"off":64,"type":"text"},
    field65: {"kind":0,"off":65,"type":"text"},
    field66: {"kind":0,"off":66,"type":"text"},
    field67: {"kind":0,"off":67,"type":"text"},
    field68: {"kind":0,"off":68,"type":"text"},
    field69: {"kind":0,"off":69,"type":"text"},
    field70: {"kind":0,"off":70,"type":"text"},
    field71: {"kind":0,"off":71,"type":"text"},
    field72: {"kind":0,"off":72,"type":"text"},
    field73: {"kind":0,"off":73,"type":"text"},
    field74: {"kind":0,"off":74,"type":"text"},
    field75: {"kind":0,"off":75,"type":"text"},
    field76: {"kind":0,"off":76,"type":"text"},
    field77: {"kind":0,"off":77,"type":"text"},
    field78: {"kind":0,"off":78,"type":"text"},
    field79: {"kind":0,"off":79,"type":"text"},
    field80: {"kind":0,"off":80,"type":"text"},
    field81: {"kind":0,"off":81,"type":"text"},
    field82: {"kind":0,"off":82,"type":"text"},
    field83: {"kind":0,"off":83,"type":"text"},
    field84: {"kind":0,"off":84,"type":"text"},
    field85: {"kind":0,"off":85,"type":"text"},
    field86: {"kind":0,"off":86,"type":"text"},
    field87: {"kind":0,"off":87,"type":"text"},
    field88: {"kind":0,"off":88,"type":"text"},
    field89: {"kind":0,"off":89,"type":"text"},
    field90: {"kind":0,"off":90,"type":"text"},
    field91: {"kind":0,"off":91,"type":"text"},
    field92: {"kind":0,"off":92,"type":"text"},
    field93: {"kind":0,"off":93,"type":"text"},
    field94: {"kind":0,"off":94,"type":"text"},
    field95: {"kind":0,"off":95,"type":"text"},
    field96: {"kind":0,"off":96,"type":"text"},
    field97: {"kind":0,"off":97,"type":"text"},
    field98: {"kind":0,"off":98,"type":"text"},
    field99: {"kind":0,"off":99,"type":"text"},
    field100: {"kind":0,"off":100,"type":"text"},
    field101: {"kind":0,"off":101,"type":"text"},
    field102: {"kind":0,"off":102,"type":"text"},
    field103: {"kind":0,"off":103,"type":"text"},
    field104: {"kind":0,"off":104,"type":"text"},
    field105: {"kind":0,"off":105,"type":"text"},
    field106: {"kind":0,"off":106,"type":"text"},
    field107: {"kind":0,"off":107,"type":"text"},
    field108: {"kind":0,"off":108,"type":"text"},
    field109: {"kind":0,"off":109,"type":"text"},
    field110: {"kind":0,"off":110,"type":"text"},
    field111: {"kind":0,"off":111,"type":"text"},
    field112: {"kind":0,"off":112,"type":"text"},
    field113: {"kind":0,"off":113,"type":"text"},
    field114: {"kind":0,"off":114,"type":"text"},
    field115: {"kind":0,"off":115,"type":"text"},
    field116: {"kind":0,"off":116,"type":"text"},
    field117: {"kind":0,"off":117,"type":"text"},
    field118: {"kind":0,"off":118,"type":"text"},
    field119: {"kind":0,"off":119,"type":"text"},
    field120: {"kind":0,"off":120,"type":"text"},
    field121: {"kind":0,"off":121,"type":"text"},
    field122: {"kind":0,"off":122,"type":"text"},
    field123: {"kind":0,"off":123,"type":"text"},
    field124: {"kind":0,"off":124,"type":"text"},
    field125: {"kind":0,"off":125,"type":"text"},
    field126: {"kind":0,"off":126,"type":"text"},
    field127: {"kind":0,"off":127,"type":"text"},
    field128: {"kind":0,"off":128,"type":"text"},
    field129: {"kind":0,"off":129,"type":"text"},
    field130: {"kind":0,"off":130,"type":"text"},
    field131: {"kind":0,"off":131,"type":"text"},
    field132: {"kind":0,"off":132,"type":"text"},
    field133: {"kind":0,"off":133,"type":"text"},
    field134: {"kind":0,"off":134,"type":"text"},
    field135: {"kind":0,"off":135,"type":"text"},
    field136: {"kind":0,"off":136,"type":"text"},
    field137: {"kind":0,"off":137,"type":"text"},
    field138: {"kind":0,"off":138,"type":"text"},
    field139: {"kind":0,"off":139,"type":"text"},
    field140: {"kind":0,"off":140,"type":"text"},
    field141: {"kind":0,"off":141,"type":"text"},
    field142: {"kind":0,"off":142,"type":"text"},
    field143: {"kind":0,"off":143,"type":"text"},
    field144: {"kind":0,"off":144,"type":"text"},
    field145: {"kind":0,"off":145,"type":"text"},
    field146: {"kind":0,"off":146,"type":"text"},
    field147: {"kind":0,"off":147,"type":"text"},
    field148: {"kind":0,"off":148,"type":"text"},
    field149: {"kind":0,"off":149,"type":"text"},
    field150: {"kind":0,"off":150,"type":"text"},
    field151: {"kind":0,"off":151,"type":"text"},
    field152: {"kind":0,"off":152,"type":"text"},
    field153: {"kind":0,"off":153,"type":"text"},
    field154: {"kind":0,"off":154,"type":"text"},
    field155: {"kind":0,"off":155,"type":"text"},
    field156: {"kind":0,"off":156,"type":"text"},
    field157: {"kind":0,"off":157,"type":"text"},
    field158: {"kind":0,"off":158,"type":"text"},
    field159: {"kind":0,"off":159,"type":"text"},
    field160: {"kind":0,"off":160,"type":"text"},
    field161: {"kind":0,"off":161,"type":"text"},
    field162: {"kind":0,"off":162,"type":"text"},
    field163: {"kind":0,"off":163,"type":"text"},
    field164: {"kind":0,"off":164,"type":"text"},
    field165: {"kind":0,"off":165,"type":"text"},
    field166: {"kind":0,"off":166,"type":"text"},
    field167: {"kind":0,"off":167,"type":"text"},
    field168: {"kind":0,"off":168,"type":"text"},
    field169: {"kind":0,"off":169,"type":"text"},
    field170: {"kind":0,"off":170,"type":"text"},
    field171: {"kind":0,"off":171,"type":"text"},
    field172: {"kind":0,"off":172,"type":"text"},
    field173: {"kind":0,"off":173,"type":"text"},
    field174: {"kind":0,"off":174,"type":"text"},
    field175: {"kind":0,"off":175,"type":"text"},
    field176: {"kind":0,"off":176,"type":"text"},
    field177: {"kind":0,"off":177,"type":"text"},
    field178: {"kind":0,"off":178,"type":"text"},
    field179: {"kind":0,"off":179,"type":"text"},
    field180: {"kind":0,"off":180,"type":"text"},
    field181: {"kind":0,"off":181,"type":"text"},
    field182: {"kind":0,"off":182,"type":"text"},
    field183: {"kind":0,"off":183,"type":"text"},
    field184: {"kind":0,"off":184,"type":"text"},
    field185: {"kind":0,"off":185,"type":"text"},
    field186: {"kind":0,"off":186,"type":"text"},
    field187: {"kind":0,"off":187,"type":"text"},
    field188: {"kind":0,"off":188,"type":"text"},
    field189: {"kind":0,"off":189,"type":"text"},
    field190: {"kind":0,"off":190,"type":"text"},
    field191: {"kind":0,"off":191,"type":"text"},
    field192: {"kind":0,"off":192,"type":"text"},
    field193: {"kind":0,"off":193,"type":"text"},
    field194: {"kind":0,"off":194,"type":"text"},
    field195: {"kind":0,"off":195,"type":"text"},
    field196: {"kind":0,"off":196,"type":"text"},
    field197: {"kind":0,"off":197,"type":"text"},
    field198: {"kind":0,"off":198,"type":"text"},
    field199: {"kind":0,"off":199,"type":"text"},
    field200: {"kind":0,"off":200,"type":"text"},
    field201: {"kind":0,"off":201,"type":"text"},
    field202: {"kind":0,"off":202,"type":"text"},
    field203: {"kind":0,"off":203,"type":"text"},
    field204: {"kind":0,"off":204,"type":"text"},
    field205: {"kind":0,"off":205,"type":"text"},
    field206: {"kind":0,"off":206,"type":"text"},
    field207: {"kind":0,"off":207,"type":"text"},
    field208: {"kind":0,"off":208,"type":"text"},
    field209: {"kind":0,"off":209,"type":"text"},
    field210: {"kind":0,"off":210,"type":"text"},
    field211: {"kind":0,"off":211,"type":"text"},
    field212: {"kind":0,"off":212,"type":"text"},
    field213: {"kind":0,"off":213,"type":"text"},
    field214: {"kind":0,"off":214,"type":"text"},
    field215: {"kind":0,"off":215,"type":"text"},
    field216: {"kind":0,"off":216,"type":"text"},
    field217: {"kind":0,"off":217,"type":"text"},
    field218: {"kind":0,"off":218,"type":"text"},
    field219: {"kind":0,"off":219,"type":"text"},
    field220: {"kind":0,"off":220,"type":"text"},
    field221: {"kind":0,"off":221,"type":"text"},
    field222: {"kind":0,"off":222,"type":"text"},
    field223: {"kind":0,"off":223,"type":"text"},
    field224: {"kind":0,"off":224,"type":"text"},
    field225: {"kind":0,"off":225,"type":"text"},
    field226: {"kind":0,"off":226,"type":"text"},
    field227: {"kind":0,"off":227,"type":"text"},
    field228: {"kind":0,"off":228,"type":"text"},
    field229: {"kind":0,"off":229,"type":"text"},
    field230: {"kind":0,"off":230,"type":"text"},
    field231: {"kind":0,"off":231,"type":"text"},
    field232: {"kind":0,"off":232,"type":"text"},
    field233: {"kind":0,"off":233,"type":"text"},
    field234: {"kind":0,"off":234,"type":"text"},
    field235: {"kind":0,"off":235,"type":"text"},
    field236: {"kind":0,"off":236,"type":"text"},
    field237: {"kind":0,"off":237,"type":"text"},
    field238: {"kind":0,"off":238,"type":"text"},
    field239: {"kind":0,"off":239,"type":"text"},
    field240: {"kind":0,"off":240,"type":"text"},
    field241: {"kind":0,"off":241,"type":"text"},
    field242: {"kind":0,"off":242,"type":"text"},
    field243: {"kind":0,"off":243,"type":"text"},
    field244: {"kind":0,"off":244,"type":"text"},
    field245: {"kind":0,"off":245,"type":"text"},
    field246: {"kind":0,"off":246,"type":"text"},
    field247: {"kind":0,"off":247,"type":"text"},
    field248: {"kind":0,"off":248,"type":"text"},
    field249: {"kind":0,"off":249,"type":"text"},
    field250: {"kind":0,"off":250,"type":"text"},
    field251: {"kind":0,"off":251,"type":"text"},
    field252: {"kind":0,"off":252,"type":"text"},
    field253: {"kind":0,"off":253,"type":"text"},
    field254: {"kind":0,"off":254,"type":"text"},
    field255: {"kind":0,"off":255,"type":"text"},
  };

  pick(names) {
    return BigUserReader._pickImpl(this._cpp, names);
  }

  static _pickImpl(cpp, names) {
    return _capnwasmPick(cpp, BigUserReader._FIELDS, names);
  }

  toObject() {
    return BigUserReader._pickImpl(this._cpp, Object.keys(BigUserReader._FIELDS));
  }
}

/**
 * Open framed Cap'n Proto bytes for typed access. Returns a BigUserReader.
 */
export function openBigUser(cpp, bytes) {
  if (bytes.length > cpp._exports.cpp_in_capacity()) throw new Error("input larger than scratch buffer");
  cpp._u8.set(bytes, cpp._exports.cpp_in_ptr());
  if (cpp._exports.cpp_any_open(bytes.length) !== 1) throw new Error("cpp_any_open failed");
  return new BigUserReader(cpp);
}
