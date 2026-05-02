// Realistic workloads: where do we matter vs capnweb?
//
// Tiny-payload single-call latency (the previous bench) is invisible behind
// any real network. The interesting questions:
//
//   1. Burst throughput: client fires N calls back-to-back, awaits all.
//      Auto-batching coalesces the N sends into ONE transport.send.
//   2. Sparse field access: client receives a 256-field metadata struct,
//      reads 5 fields. Cap'n Proto skips the rest; capnweb has to JSON.parse
//      everything.
//   3. Binary blob delivery: client sends/receives 64 KB of binary data.
//      Cap'n Proto stores raw bytes; capnweb must base64-encode (1.33x
//      bandwidth + parse cost).
//   4. Wire bytes: total bytes per message. Bandwidth matters on real WANs.
//
// Each is a distinct dimension that DOES translate to user-visible behavior.

import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession as CapnwasmSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import {
  PrimitivesBuilder,
  PrimitivesReader,
} from "../js/conformance_schema.gen.mjs";

const capnweb = await import("../../capnweb/dist/index.js");

// ---------- Workload 1: Burst throughput ----------------------------------

function capnwebTransportPair() {
  const make = () => ({
    _q: [], _w: [],
    send(msg) {
      const peer = this.peer;
      if (peer._w.length) peer._w.shift().resolve(msg);
      else peer._q.push(msg);
      return Promise.resolve();
    },
    receive() {
      if (this._q.length) return Promise.resolve(this._q.shift());
      return new Promise((res, rej) => this._w.push({ resolve: res, reject: rej }));
    },
    abort() { for (const w of this._w) w.reject(new Error("abort")); },
  });
  const a = make(); const b = make();
  a.peer = b; b.peer = a;
  return { a, b };
}

class CapnwebEcho extends capnweb.RpcTarget {
  echo(p) { return p; }
}

async function setupCapnweb() {
  const { a, b } = capnwebTransportPair();
  new capnweb.RpcSession(b, new CapnwebEcho());
  const client = new capnweb.RpcSession(a);
  return client.getRemoteMain();
}

const IFC = 0xc0ffeec0ffeec0ffn;

async function setupCapnwasm() {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    const u8 = p.u8;
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.u8 = u8;
  });
  new CapnwasmSession(cppB, b, registry, { bootstrap: {} });
  const client = new CapnwasmSession(cppA, a);
  return { client, root: client.bootstrap() };
}

const cwbRoot = await setupCapnweb();
const { root: ourRoot } = await setupCapnwasm();

console.log("\n══ Workload 1: Burst throughput (fire N calls, await all) ══\n");
console.log("  N    | capnweb total | capnwasm total | per-call cwb / us | per-call ours / us");
console.log("  ─────|───────────────|────────────────|───────────────────|──────────────────");

for (const N of [1, 10, 100, 1000]) {
  // Warm
  for (let w = 0; w < 5; w++) {
    await Promise.all(Array.from({ length: N }, () => cwbRoot.echo({ u8: 1 })));
    await Promise.all(Array.from({ length: N }, () => {
      const r = ourRoot.callBuilder(IFC, 0, PrimitivesBuilder);
      r.params.u8 = 1;
      return r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
    }));
  }

  const ITERS = N >= 1000 ? 20 : N >= 100 ? 100 : 200;
  let cwbMs = 0, oursMs = 0;
  for (let i = 0; i < ITERS; i++) {
    const t0 = process.hrtime.bigint();
    await Promise.all(Array.from({ length: N }, () => cwbRoot.echo({ u8: 1 })));
    cwbMs += Number(process.hrtime.bigint() - t0) / 1e6;
    const t1 = process.hrtime.bigint();
    await Promise.all(Array.from({ length: N }, () => {
      const r = ourRoot.callBuilder(IFC, 0, PrimitivesBuilder);
      r.params.u8 = 1;
      return r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
    }));
    oursMs += Number(process.hrtime.bigint() - t1) / 1e6;
  }
  const cwbAvg = cwbMs / ITERS;
  const oursAvg = oursMs / ITERS;
  console.log(
    `  ${N.toString().padStart(4)} | ${cwbAvg.toFixed(2).padStart(11)}ms | ${oursAvg.toFixed(2).padStart(12)}ms | ${(cwbAvg * 1000 / N).toFixed(2).padStart(15)} | ${(oursAvg * 1000 / N).toFixed(2).padStart(15)}`,
  );
}

// ---------- Workload 2: Wire bytes ---------------------------------------

console.log("\n══ Workload 2: Bytes-on-wire per call ══\n");
console.log("  payload                       capnweb (JSON)  capnwasm (binary)  ratio");
console.log("  ──────────────────────────────────────────────────────────────────────");

function recordCwbBytes() {
  let cwbBytes = 0;
  const make = () => ({
    _q: [], _w: [],
    send(msg) {
      cwbBytes += msg.length;
      const peer = this.peer;
      if (peer._w.length) peer._w.shift().resolve(msg);
      else peer._q.push(msg);
      return Promise.resolve();
    },
    receive() {
      if (this._q.length) return Promise.resolve(this._q.shift());
      return new Promise((res, rej) => this._w.push({ resolve: res, reject: rej }));
    },
    abort() {},
  });
  const a = make(); const b = make();
  a.peer = b; b.peer = a;
  return { a, b, getCwbBytes: () => cwbBytes };
}

async function cwbCallSize(arg) {
  const { a, b, getCwbBytes } = recordCwbBytes();
  new capnweb.RpcSession(b, new CapnwebEcho());
  const client = new capnweb.RpcSession(a);
  const r = client.getRemoteMain();
  await r.echo(arg);
  return getCwbBytes();
}

async function ourCallSize(text, binary) {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  let bytes = 0;
  const realSend = a.send.bind(a);
  a.send = (b) => { bytes += b.length; realSend(b); };
  const reg = new InterfaceRegistry();
  reg.register(IFC, 0, (target, ctx) => {
    ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder);
  });
  new CapnwasmSession(cppB, b, reg, { bootstrap: {} });
  const c = new CapnwasmSession(cppA, a);
  const root = c.bootstrap();
  const r = root.callBuilder(IFC, 0, PrimitivesBuilder);
  if (text !== undefined) r.params.text = text;
  if (binary !== undefined) r.params.data = binary;
  await r.send({ resultsReader: PrimitivesReader, extract: () => null }).promise;
  return bytes;
}

const cases = [
  { name: "no payload (just method)",   cwb: {},                    text: undefined, binary: undefined },
  { name: "16B text",                    cwb: { text: "x".repeat(16) },     text: "x".repeat(16) },
  { name: "256B text",                   cwb: { text: "x".repeat(256) },    text: "x".repeat(256) },
  { name: "4KB text",                    cwb: { text: "x".repeat(4096) },   text: "x".repeat(4096) },
  { name: "64KB binary blob",            cwb: { bin: Array.from(new Uint8Array(64 * 1024).map((_, i) => i & 0xff)) },
                                          binary: new Uint8Array(64 * 1024).map((_, i) => i & 0xff) },
];

for (const c of cases) {
  const cwbBytes = await cwbCallSize(c.cwb);
  const ourBytes = await ourCallSize(c.text, c.binary);
  const ratio = (cwbBytes / ourBytes).toFixed(2);
  const winner = cwbBytes > ourBytes ? "✓ capnwasm smaller" : "  capnweb smaller";
  console.log(
    `  ${c.name.padEnd(28)} ${cwbBytes.toString().padStart(8)}B   ${ourBytes.toString().padStart(8)}B    ${ratio.padStart(5)}x  ${winner}`,
  );
}

// ---------- Workload 3: Sparse field access ------------------------------
// Server returns a 32-field metadata struct. Client only needs 3 fields.
// JSON has to materialize all 32 fields (parse the whole JSON tree).
// Cap'n Proto's wire layout lets the client read just the 3 it needs.

console.log("\n══ Workload 3: Sparse field access (32-field metadata, read 3) ══\n");

class CapnwebMeta extends capnweb.RpcTarget {
  getMeta() {
    const o = {};
    for (let i = 0; i < 32; i++) o["field" + i] = "value" + i + "_" + "x".repeat(40);
    return o;
  }
}
const { a: ma, b: mb } = capnwebTransportPair();
new capnweb.RpcSession(mb, new CapnwebMeta());
const cwbMeta = (new capnweb.RpcSession(ma)).getRemoteMain();

// Our side: use the WideUserData schema (32 string fields).
const { WideUserDataBuilder, WideUserDataReader } = await import("../js/typed_schema.gen.mjs");
const META_IFC = 0xdeadbeefcafef00dn;
const cppC = await loadWasm();
const cppD = await loadWasm();
const { a: oa, b: ob } = createMemoryTransportPair();
const metaReg = new InterfaceRegistry();
metaReg.register(META_IFC, 0, (target, ctx) => {
  const reply = ctx.beginResults(WideUserDataBuilder);
  for (let i = 0; i < 32; i++) {
    reply["field" + i] = "value" + i + "_" + "x".repeat(40);
  }
});
new CapnwasmSession(cppD, ob, metaReg, { bootstrap: {} });
const ourMetaSess = new CapnwasmSession(cppC, oa);
const ourMeta = ourMetaSess.bootstrap();

const N = 1000;
// Warm
for (let i = 0; i < 50; i++) {
  const m = await cwbMeta.getMeta();
  const _ = m.field0 + m.field5 + m.field10;
}
for (let i = 0; i < 50; i++) {
  const r = ourMeta.callBuilder(META_IFC, 0, WideUserDataBuilder);
  await r.send({
    resultsReader: WideUserDataReader,
    extract: (rdr) => rdr.field0 + rdr.field5 + rdr.field10,
  }).promise;
}

let cwbMs = 0;
let oursMs = 0;
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  const m = await cwbMeta.getMeta();
  // Materialize 3 fields (capnweb already parsed all 32 above).
  const a = m.field0 + m.field5 + m.field10;
  cwbMs += Number(process.hrtime.bigint() - t0) / 1e6;
  if (a.length === 0) break;
}
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  const r = ourMeta.callBuilder(META_IFC, 0, WideUserDataBuilder);
  await r.send({
    resultsReader: WideUserDataReader,
    extract: (rdr) => rdr.field0 + rdr.field5 + rdr.field10,
  }).promise;
  oursMs += Number(process.hrtime.bigint() - t0) / 1e6;
}
console.log(`  capnweb (parses all 32 fields): ${(cwbMs * 1000 / N).toFixed(2).padStart(8)}μs/call`);
console.log(`  capnwasm (reads 3, skips 29):   ${(oursMs * 1000 / N).toFixed(2).padStart(8)}μs/call`);
console.log(`  speedup:                       ${(cwbMs / oursMs).toFixed(2)}x`);

console.log("");
process.exit(0);
