// JS-side tape codec. Converts capnweb-shape JS values into the byte tape
// consumed by cpp/wrapper.cpp, and back. The tape format is the contract
// between JS and the C++ wasm. Keep both in sync.

const MSG_PUSH = 0;
const MSG_PULL = 1;
const MSG_RESOLVE = 2;
const MSG_REJECT = 3;
const MSG_RELEASE = 4;
const MSG_STREAM = 5;
const MSG_ABORT = 6;
const MSG_PIPE = 7;

const E_NULL = 0x00;
const E_TRUE = 0x01;
const E_FALSE = 0x02;
const E_INT = 0x03;
const E_FLOAT = 0x04;
const E_TEXT = 0x05;
const E_DATA = 0x06;
const E_DATE = 0x07;
const E_BIGINT = 0x08;
const E_UNDEFINED = 0x09;
const E_ARRAY = 0x10;
const E_OBJECT = 0x11;
const E_IMPORT = 0x20;
const E_EXPORT = 0x21;
const E_PIPELINE = 0x22;
const E_ERROR = 0x23;

const SHARED_ENCODER = new TextEncoder();
const SHARED_DECODER = new TextDecoder();

export class TapeWriter {
  constructor(buffer) {
    this.bytes = buffer;
    this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.pos = 0;
  }

  writeU8(v) { this.bytes[this.pos++] = v; }
  writeU32(v) { this.dv.setUint32(this.pos, v, true); this.pos += 4; }

  writeI64(v) {
    if (typeof v === "bigint") {
      this.dv.setBigInt64(this.pos, v, true);
      this.pos += 8;
      return;
    }
    let lo, hi;
    if (v >= 0) {
      lo = (v >>> 0);
      hi = ((v / 4294967296) >>> 0);
    } else {
      const abs = -v;
      const aLo = (abs >>> 0);
      const aHi = ((abs / 4294967296) >>> 0);
      lo = (~aLo + 1) >>> 0;
      hi = (~aHi + (lo === 0 ? 1 : 0)) >>> 0;
    }
    this.dv.setUint32(this.pos, lo, true);
    this.dv.setUint32(this.pos + 4, hi, true);
    this.pos += 8;
  }

  writeF64(v) { this.dv.setFloat64(this.pos, v, true); this.pos += 8; }
  writeBytes(b) { this.bytes.set(b, this.pos); this.pos += b.length; }

  writeText(s) {
    const lenPos = this.pos;
    this.pos += 4;
    const startPos = this.pos;
    const sLen = s.length;
    let asciiOk = true;
    for (let i = 0; i < sLen; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80) { asciiOk = false; break; }
      this.bytes[startPos + i] = c;
    }
    if (asciiOk) {
      this.pos = startPos + sLen;
      this.dv.setUint32(lenPos, sLen, true);
      return;
    }
    const result = SHARED_ENCODER.encodeInto(s, this.bytes.subarray(startPos));
    this.pos = startPos + result.written;
    this.dv.setUint32(lenPos, result.written, true);
  }

  writeMessage(msg) {
    if (!Array.isArray(msg)) throw new TypeError("message must be an array");
    const tag = msg[0];
    switch (tag) {
      case "push":    this.writeU8(MSG_PUSH); this.writeExpr(msg[1]); break;
      case "pull":    this.writeU8(MSG_PULL); this.writeI64(msg[1]); break;
      case "resolve": this.writeU8(MSG_RESOLVE); this.writeI64(msg[1]); this.writeExpr(msg[2]); break;
      case "reject":  this.writeU8(MSG_REJECT); this.writeI64(msg[1]); this.writeExpr(msg[2]); break;
      case "release": this.writeU8(MSG_RELEASE); this.writeI64(msg[1]); this.writeU32(msg[2] >>> 0); break;
      case "stream":  this.writeU8(MSG_STREAM); this.writeExpr(msg[1]); break;
      case "abort":   this.writeU8(MSG_ABORT); this.writeExpr(msg[1]); break;
      case "pipe":    this.writeU8(MSG_PIPE); break;
      default: throw new TypeError(`unknown message tag: ${tag}`);
    }
  }

  writeExpr(v) {
    if (v === null) { this.writeU8(E_NULL); return; }
    if (v === undefined) { this.writeU8(E_UNDEFINED); return; }
    switch (typeof v) {
      case "boolean":
        this.writeU8(v ? E_TRUE : E_FALSE);
        return;
      case "number":
        if (Number.isInteger(v) && v >= -9007199254740992 && v <= 9007199254740992) {
          this.writeU8(E_INT); this.writeI64(v);
        } else {
          this.writeU8(E_FLOAT); this.writeF64(v);
        }
        return;
      case "bigint":
        this.writeU8(E_BIGINT); this.writeText(v.toString());
        return;
      case "string":
        this.writeU8(E_TEXT); this.writeText(v);
        return;
    }
    if (v instanceof Uint8Array) {
      this.writeU8(E_DATA); this.writeU32(v.length); this.writeBytes(v); return;
    }
    if (v instanceof Date) {
      this.writeU8(E_DATE); this.writeF64(v.getTime()); return;
    }
    if (Array.isArray(v)) {
      if (v.length === 1 && Array.isArray(v[0])) {
        const inner = v[0];
        this.writeU8(E_ARRAY);
        this.writeU32(inner.length);
        for (const el of inner) this.writeExpr(el);
        return;
      }
      const head = v[0];
      switch (head) {
        case "undefined": this.writeU8(E_UNDEFINED); return;
        case "inf": this.writeU8(E_FLOAT); this.writeF64(Infinity); return;
        case "-inf": this.writeU8(E_FLOAT); this.writeF64(-Infinity); return;
        case "nan": this.writeU8(E_FLOAT); this.writeF64(NaN); return;
        case "bytes":
          this.writeU8(E_DATA);
          {
            let arr;
            if (Uint8Array.fromBase64) {
              arr = Uint8Array.fromBase64(v[1]);
            } else {
              const bin = atob(v[1]);
              arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            }
            this.writeU32(arr.length);
            this.writeBytes(arr);
          }
          return;
        case "bigint":
          this.writeU8(E_BIGINT); this.writeText(v[1]); return;
        case "date":
          this.writeU8(E_DATE); this.writeF64(v[1]); return;
        case "import":
          this.writeU8(E_IMPORT); this.writeI64(v[1]); return;
        case "export":
          this.writeU8(E_EXPORT); this.writeI64(v[1]); return;
        case "pipeline":
          this.writeU8(E_PIPELINE);
          this.writeExpr(v[1]);
          this.writeU32(v[2].length);
          for (const seg of v[2]) this.writeText(seg);
          if (v.length > 3) {
            this.writeU8(1);
            this.writeExpr(v[3]);
          } else {
            this.writeU8(0);
          }
          return;
        case "error":
          this.writeU8(E_ERROR);
          this.writeText(v[1] ?? "Error");
          this.writeText(v[2] ?? "");
          return;
        default:
          throw new TypeError(`unknown tagged expression: ${head}`);
      }
    }
    if (typeof v === "object") {
      const keys = Object.keys(v);
      this.writeU8(E_OBJECT);
      this.writeU32(keys.length);
      for (const k of keys) {
        this.writeText(k);
        this.writeExpr(v[k]);
      }
      return;
    }
    throw new TypeError(`unsupported expression value of type ${typeof v}`);
  }
}

export class TapeReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  readU8() { return this.bytes[this.pos++]; }
  readU32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }

  readI64() {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getInt32(this.pos + 4, true);
    this.pos += 8;
    if (hi >= -0x200000 && hi <= 0x1FFFFF) {
      return hi * 4294967296 + lo;
    }
    return Number(this.dv.getBigInt64(this.pos - 8, true));
  }

  readF64() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  readBytes(n) { const v = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return v; }

  readText() {
    const len = this.readU32();
    if (len < 64) {
      const start = this.pos;
      let asciiOk = true;
      for (let i = 0; i < len; i++) {
        if (this.bytes[start + i] >= 0x80) { asciiOk = false; break; }
      }
      if (asciiOk) {
        let s = "";
        for (let i = 0; i < len; i++) s += String.fromCharCode(this.bytes[start + i]);
        this.pos += len;
        return s;
      }
    }
    const s = SHARED_DECODER.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  readMessage() {
    const tag = this.readU8();
    switch (tag) {
      case MSG_PUSH:    return ["push", this.readExpr()];
      case MSG_PULL:    return ["pull", this.readI64()];
      case MSG_RESOLVE: return ["resolve", this.readI64(), this.readExpr()];
      case MSG_REJECT:  return ["reject", this.readI64(), this.readExpr()];
      case MSG_RELEASE: return ["release", this.readI64(), this.readU32()];
      case MSG_STREAM:  return ["stream", this.readExpr()];
      case MSG_ABORT:   return ["abort", this.readExpr()];
      case MSG_PIPE:    return ["pipe"];
      default: throw new Error(`unknown message tag: ${tag}`);
    }
  }

  readExpr() {
    const tag = this.readU8();
    switch (tag) {
      case E_NULL: return null;
      case E_UNDEFINED: return ["undefined"];
      case E_TRUE: return true;
      case E_FALSE: return false;
      case E_INT: return this.readI64();
      case E_FLOAT: {
        const f = this.readF64();
        if (f === Infinity) return ["inf"];
        if (f === -Infinity) return ["-inf"];
        if (Number.isNaN(f)) return ["nan"];
        return f;
      }
      case E_TEXT: return this.readText();
      case E_DATA: {
        const len = this.readU32();
        const bytes = this.readBytes(len);
        if (bytes.toBase64) return ["bytes", bytes.toBase64()];
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return ["bytes", btoa(bin)];
      }
      case E_DATE: return ["date", this.readF64()];
      case E_BIGINT: return ["bigint", this.readText()];
      case E_ARRAY: {
        const count = this.readU32();
        const inner = new Array(count);
        for (let i = 0; i < count; i++) inner[i] = this.readExpr();
        return [inner];
      }
      case E_OBJECT: {
        const count = this.readU32();
        const obj = {};
        for (let i = 0; i < count; i++) {
          const name = this.readText();
          obj[name] = this.readExpr();
        }
        return obj;
      }
      case E_IMPORT: return ["import", this.readI64()];
      case E_EXPORT: return ["export", this.readI64()];
      case E_PIPELINE: {
        const source = this.readExpr();
        const pathCount = this.readU32();
        const path = new Array(pathCount);
        for (let i = 0; i < pathCount; i++) path[i] = this.readText();
        const hasArgs = this.readU8();
        if (hasArgs) return ["pipeline", source, path, this.readExpr()];
        return ["pipeline", source, path];
      }
      case E_ERROR: {
        const type = this.readText();
        const message = this.readText();
        return ["error", type, message];
      }
      default: throw new Error(`unknown expression tag: 0x${tag.toString(16)}`);
    }
  }
}
