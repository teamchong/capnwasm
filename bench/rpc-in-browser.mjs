// Browser RPC bench: runs the SAME workloads as bench/rpc_bench.mjs but
// inside Chromium. Confirms (a) the RPC layer works in a real browser via
// the inlined wasm bundle and (b) lets us measure capnwasm-RpcSession vs
// capnweb-RpcSession in V8 directly, where capnweb is at home.

import { load as loadWasm } from "/dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "/js/rpc.mjs";
import {
  PrimitivesBuilder,
  PrimitivesReader,
} from "/js/conformance_schema.gen.mjs";
import * as capnweb from "/capnweb-vendor/index.js";

const status = document.getElementById("status");
const results = document.getElementById("results");
const log = (line) => { results.textContent += line + "\n"; };
const setStatus = (msg) => { status.textContent = msg; console.log("[bench]", msg); };

// ---- Capnweb in-process transport pair (string-based) ------------------
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
  echoU8(o) { return { u8: o.u8 }; }
  echoText(s) { return "ack:" + s; }
  getChild() { return new CapnwebEcho(); }
}

function setupCapnweb() {
  const { a, b } = capnwebTransportPair();
  new capnweb.RpcSession(b, new CapnwebEcho());
  const client = new capnweb.RpcSession(a);
  return client.getRemoteMain();
}

// ---- Capnwasm RPC setup -----------------------------------------------
const IFC = 0xc0ffeec0ffeec0ffn;
const M_ECHO_U8 = 0;
const M_ECHO_TEXT = 1;
const M_GET_CHILD = 2;

async function setupCapnwasm() {
  setStatus(`Loading wasm…`);
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const reg = new InterfaceRegistry();
  reg.register(IFC, M_ECHO_U8, (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    const u8 = p.u8;
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.u8 = u8;
  });
  reg.register(IFC, M_ECHO_TEXT, (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    const t = p.text;
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.text = "ack:" + t;
  });
  reg.register(IFC, M_GET_CHILD, () => ({ caps: [{ kind: "child" }] }));
  new RpcSession(cppB, b, reg, { bootstrap: { kind: "root" } });
  const client = new RpcSession(cppA, a);
  return client.bootstrap();
}

// ---- Timing helpers ----------------------------------------------------
async function timed(fn, iters) {
  for (let i = 0; i < 50; i++) await fn(i);
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn(i);
  return ((performance.now() - t0) * 1000) / iters; // µs/call
}

async function timedBurst(fn, count, iters) {
  for (let i = 0; i < 5; i++) {
    await Promise.all(Array.from({ length: count }, fn));
  }
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) {
    await Promise.all(Array.from({ length: count }, fn));
  }
  return ((performance.now() - t0) * 1000) / (iters * count); // µs/call
}

// ---- Run ---------------------------------------------------------------
async function run() {
  const cwbRoot = setupCapnweb();
  const ourRoot = await setupCapnwasm();

  const N = 1000;

  log(`In-browser RPC bench (Chromium V8). N=${N} per workload.\n`);
  log(`workload                            capnweb (JSON)   capnwasm (binary)`);
  log(`──────────────────────────────────  ───────────────  ─────────────────`);

  {
    const cwb = await timed(() => cwbRoot.echoU8({ u8: 42 }), N);
    const our = await timed(() => {
      const r = ourRoot.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
      r.params.u8 = 42;
      return r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
    }, N);
    log(`u8 echo (single call)               ${fmt(cwb)}   ${fmt(our)}`);
  }

  {
    const t256 = "x".repeat(256);
    const cwb = await timed(() => cwbRoot.echoText(t256), N);
    const our = await timed(() => {
      const r = ourRoot.callBuilder(IFC, M_ECHO_TEXT, PrimitivesBuilder);
      r.params.text = t256;
      return r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.text }).promise;
    }, N);
    log(`text echo 256B (single call)        ${fmt(cwb)}   ${fmt(our)}`);
  }

  {
    const COUNT = 100, ITERS = 100;
    const cwb = await timedBurst(() => cwbRoot.echoU8({ u8: 1 }), COUNT, ITERS);
    const our = await timedBurst(() => {
      const r = ourRoot.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
      r.params.u8 = 1;
      return r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
    }, COUNT, ITERS);
    log(`burst 100 calls/iter (per-call)     ${fmt(cwb)}   ${fmt(our)}`);
  }

  {
    const cwb = await timed(async () => {
      const child = cwbRoot.getChild();
      return child.echoU8({ u8: 9 });
    }, N);
    const our = await timed(() => {
      const r1 = ourRoot.callBuilder(IFC, M_GET_CHILD, PrimitivesBuilder).send();
      const r2 = r1.cap.callBuilder(IFC, M_ECHO_U8, PrimitivesBuilder);
      r2.params.u8 = 9;
      return r2.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
    }, N);
    log(`cap-passing: getChild + echo        ${fmt(cwb)}   ${fmt(our)}`);
  }

  // Wire-byte comparison (counts characters / bytes per round-trip frame).
  log("");
  log(`wire bytes per round-trip:`);
  await wireBytes("u8 echo",     () => ({ u8: 42 }), 0, false);
  await wireBytes("text 256B",   () => ({ text: "x".repeat(256) }), 256, false);
  await wireBytes("text 4KB",    () => ({ text: "x".repeat(4096) }), 4096, false);
  await wireBytes("64KB binary", () => ({ data: Array.from({length: 64*1024}, (_,i) => i & 0xff) }),
                                         0, true);

  setStatus("done");
  window.__rpcBenchResults = results.textContent;
}

function fmt(us) { return `${us.toFixed(2).padStart(8)}μs`; }

async function wireBytes(name, cwbArgFn, textLen, asBinary) {
  // cwb side
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
  const ca = make(); const cb = make();
  ca.peer = cb; cb.peer = ca;
  new capnweb.RpcSession(cb, new CapnwebEcho());
  const cwbRoot = (new capnweb.RpcSession(ca)).getRemoteMain();
  const arg = cwbArgFn();
  if (asBinary) await cwbRoot.echoText(arg.data);
  else await cwbRoot.echoU8 ? await cwbRoot.echoU8(arg) : await cwbRoot.echoText(arg.text || "");

  // our side
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  let ourBytes = 0;
  const realSend = a.send.bind(a);
  a.send = (bytes) => { ourBytes += bytes.length; realSend(bytes); };
  const reg = new InterfaceRegistry();
  reg.register(IFC, 0, (target, ctx) => {
    ctx.openParams(PrimitivesReader);
    ctx.beginResults(PrimitivesBuilder);
  });
  new RpcSession(cppB, b, reg, { bootstrap: {} });
  const c = new RpcSession(cppA, a);
  const cap = c.bootstrap();
  const r = cap.callBuilder(IFC, 0, PrimitivesBuilder);
  if (textLen > 0 && !asBinary) r.params.text = "x".repeat(textLen);
  if (asBinary) r.params.data = new Uint8Array(64 * 1024).map((_, i) => i & 0xff);
  await r.send({ resultsReader: PrimitivesReader, extract: () => null }).promise;

  const ratio = (cwbBytes / ourBytes).toFixed(2);
  log(`  ${name.padEnd(15)}  cwb=${cwbBytes.toString().padStart(7)}B  ours=${ourBytes.toString().padStart(7)}B  ratio=${ratio.padStart(6)}x`);
}

run().catch((e) => {
  setStatus("ERROR: " + e.message);
  console.error(e);
  log("ERROR: " + e.stack);
  window.__rpcBenchResults = results.textContent;
});
