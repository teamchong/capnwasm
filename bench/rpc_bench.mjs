// Apples-to-apples Node bench: capnwasm RpcSession vs capnweb RpcSession.
// Both running in-process through a paired transport, identical workloads,
// same N. Reports round-trip µs/call.
//
// Capnweb is JSON-based (text transport). Capnwasm is binary (Uint8Array
// transport). Each pair uses a paired in-memory transport tailored to its
// message type — that's intrinsic to each library, not a bench artifact.

import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession as CapnwasmSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import { PrimitivesBuilder, PrimitivesReader } from "../js/conformance_schema.gen.mjs";

const capnweb = await import("../../capnweb/dist/index.js");

// ---- Capnweb-style in-process string-transport pair --------------------
function capnwebTransportPair() {
  const make = () => {
    const queue = [];
    const waiters = [];
    return {
      _queue: queue,
      _waiters: waiters,
      send(msg) {
        // Push to peer's queue.
        const peer = this.peer;
        if (peer._waiters.length) peer._waiters.shift().resolve(msg);
        else peer._queue.push(msg);
        return Promise.resolve();
      },
      receive() {
        if (queue.length) return Promise.resolve(queue.shift());
        return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      },
      abort() {
        for (const w of waiters) w.reject(new Error("aborted"));
      },
    };
  };
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

// ---- Workload: capnweb side --------------------------------------------
class CapnwebEcho extends capnweb.RpcTarget {
  echo(p) { return p; }            // params: object
  echoText(s) { return "ack:" + s; }
  add(a, b) { return a + b; }
  getChild() { return new CapnwebEcho(); }
}

async function setupCapnweb() {
  const { a, b } = capnwebTransportPair();
  // Server side
  new capnweb.RpcSession(b, new CapnwebEcho());
  // Client side
  const client = new capnweb.RpcSession(a);
  return { client, remote: client.getRemoteMain() };
}

// ---- Workload: capnwasm side -------------------------------------------
const IFC_ECHO    = 0xc0c0c0c0c0c0c0c0n;
const M_ECHO_U8   = 0;
const M_ECHO_TEXT = 1;
const M_GET_CHILD = 2;

async function setupCapnwasm() {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  const registry = new InterfaceRegistry();
  // Sync handlers — the new fast path skips the await microtask for these.
  registry.register(IFC_ECHO, M_ECHO_U8, (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    const u8 = p.u8;
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.u8 = u8;
  });
  registry.register(IFC_ECHO, M_ECHO_TEXT, (target, ctx) => {
    const p = ctx.openParams(PrimitivesReader);
    const t = p.text;
    const reply = ctx.beginResults(PrimitivesBuilder);
    reply.text = "ack:" + t;
  });
  registry.register(IFC_ECHO, M_GET_CHILD, () => ({
    caps: [{ kind: "child" }],
  }));
  new CapnwasmSession(cppB, b, registry, { bootstrap: { kind: "root" } });
  const client = new CapnwasmSession(cppA, a);
  return { client, remote: client.bootstrap() };
}

// ---- Time helpers -------------------------------------------------------
async function timed(label, fn, iters) {
  // Warm
  for (let i = 0; i < 100; i++) await fn(i);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) await fn(i);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, usPerCall: (ms * 1000) / iters, totalMs: ms };
}

function printRow(name, cwb, ours) {
  const speedup = cwb.usPerCall / ours.usPerCall;
  const arrow = speedup >= 1 ? "↑" : "↓";
  console.log(
    `  ${name.padEnd(36)} ${cwb.usPerCall.toFixed(2).padStart(8)}μs   ${ours.usPerCall.toFixed(2).padStart(8)}μs   ${arrow} ${speedup.toFixed(2)}x`,
  );
}

// ---- Run ----------------------------------------------------------------
const N = 2000;

const { remote: cwbRoot } = await setupCapnweb();
const { remote: ourRoot } = await setupCapnwasm();

console.log(`\nN=${N} iterations per case\n`);
console.log(`  ${"workload".padEnd(36)}  capnweb (JSON)    capnwasm (binary)   speedup`);
console.log(`  ${"─".repeat(36)}  ${"─".repeat(15)}  ${"─".repeat(17)}  ${"─".repeat(8)}`);

// Tiny: u8 echo
{
  const cwb = await timed("u8 echo (cap.echo({u8:42}))", async () => {
    await cwbRoot.echo({ u8: 42 });
  }, N);
  const ours = await timed("u8 echo (callBuilder + extract)", async () => {
    const r = ourRoot.callBuilder(IFC_ECHO, M_ECHO_U8, PrimitivesBuilder);
    r.params.u8 = 42;
    await r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
  }, N);
  printRow("tiny: u8 echo", cwb, ours);
}

// Small text echo (16 bytes)
{
  const text16 = "x".repeat(16);
  const cwb = await timed("text echo 16B", async () => {
    await cwbRoot.echoText(text16);
  }, N);
  const ours = await timed("text echo 16B", async () => {
    const r = ourRoot.callBuilder(IFC_ECHO, M_ECHO_TEXT, PrimitivesBuilder);
    r.params.text = text16;
    await r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.text }).promise;
  }, N);
  printRow("small: 16B text echo", cwb, ours);
}

// Medium text echo (256 bytes)
{
  const text256 = "x".repeat(256);
  const cwb = await timed("text echo 256B", async () => {
    await cwbRoot.echoText(text256);
  }, N);
  const ours = await timed("text echo 256B", async () => {
    const r = ourRoot.callBuilder(IFC_ECHO, M_ECHO_TEXT, PrimitivesBuilder);
    r.params.text = text256;
    await r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.text }).promise;
  }, N);
  printRow("medium: 256B text echo", cwb, ours);
}

// Large text echo (4 KB)
{
  const text4k = "x".repeat(4096);
  const cwb = await timed("text echo 4K", async () => {
    await cwbRoot.echoText(text4k);
  }, N / 4);
  const ours = await timed("text echo 4K", async () => {
    const r = ourRoot.callBuilder(IFC_ECHO, M_ECHO_TEXT, PrimitivesBuilder);
    r.params.text = text4k;
    await r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.text }).promise;
  }, N / 4);
  printRow("large: 4KB text echo", cwb, ours);
}

// XL text echo (64 KB) — only modest N to avoid taking minutes
{
  const text64k = "x".repeat(64 * 1024);
  const cwb = await timed("text echo 64K", async () => {
    await cwbRoot.echoText(text64k);
  }, 200);
  const ours = await timed("text echo 64K", async () => {
    const r = ourRoot.callBuilder(IFC_ECHO, M_ECHO_TEXT, PrimitivesBuilder);
    r.params.text = text64k;
    await r.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.text }).promise;
  }, 200);
  printRow("xl: 64KB text echo", cwb, ours);
}

// Cap passing: getChild then call on returned cap (single round-trip dependency)
{
  const cwb = await timed("getChild then echo", async () => {
    const child = cwbRoot.getChild();
    await child.echo({ u8: 1 });
  }, N);
  const ours = await timed("getChild then echo", async () => {
    const r1 = ourRoot.callBuilder(IFC_ECHO, M_GET_CHILD, PrimitivesBuilder).send();
    const r2 = r1.cap.callBuilder(IFC_ECHO, M_ECHO_U8, PrimitivesBuilder);
    r2.params.u8 = 1;
    await r2.send({ resultsReader: PrimitivesReader, extract: rdr => rdr.u8 }).promise;
  }, N);
  printRow("cap-passing: getChild + echo", cwb, ours);
}

console.log("");
process.exit(0);
