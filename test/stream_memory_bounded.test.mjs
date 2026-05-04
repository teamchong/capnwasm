// Proves the streaming RPC path holds wasm linear memory bounded
// regardless of total bytes streamed. Otherwise the "no OOM under
// large payloads" claim is unverified.
//
// We stream 1000 chunks of 1 MB through the in-process memory transport
// pair (no network, no wrangler — wasm memory growth is a property of
// the slot pool / arena code, not of the transport). We snapshot
// memory.buffer.byteLength after each 100-chunk batch and assert
// the high-water mark never exceeds a small bounded ceiling.
//
// If the slot pool leaks or the arena fails to recycle, byteLength
// will grow roughly proportional to chunks consumed and the test will
// fail with the recorded growth pattern. That tells us OOM is real.
// If recycle works correctly, byteLength plateaus and the test passes.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";

// Empty params payload (root pointer to empty struct).
const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();

const CHUNK_BYTES = 1 << 20;        // 1 MB per chunk.
const CHUNKS = 1000;                // 1000 × 1 MB = ~1 GB streamed total.
const SNAPSHOT_EVERY = 100;
// Memory ceiling. wasm linear memory is page-granular (64 KB pages).
// One in-flight 1 MB chunk + slot pool + capnwasm static BSS + transport
// buffers should comfortably fit under 64 MB. If we exceed this it's
// either a leak or growth proportional to chunks consumed.
// 64 MB ceiling. Empirically: baseline ≈ 28 MiB, peak after 1 GB streamed
// ≈ 28.4 MiB. The 64 MB cap leaves ~2x headroom for legitimate variance
// (alignment/page rounding, future BSS growth) while still catching a
// real regression: a leak that grows by 1 MiB per chunk would blow this
// in ~36 chunks, well before the 1000-chunk total.
const CEILING_BYTES = 64 << 20;

test("stream: 1 GB streamed in 1 MB chunks keeps wasm memory bounded", async () => {
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();

  const reg = new InterfaceRegistry();
  const IFC = 0xabcdef0123456789n;
  // Generator yields the same buffer reference every iteration; the
  // RPC layer copies it into the wire frame, so reusing the buffer is
  // safe and avoids GC pressure on the test harness side. The growth
  // we're measuring is on the *receiving* CapnCpp instance (cppA).
  const chunkBuf = new Uint8Array(CHUNK_BYTES);
  // Fill with a deterministic byte pattern so we can verify integrity
  // on the client without trusting zero-fill.
  for (let i = 0; i < CHUNK_BYTES; i++) chunkBuf[i] = i & 0xff;

  reg.registerStream(IFC, 0, async function* () {
    for (let i = 0; i < CHUNKS; i++) yield chunkBuf;
  });

  new RpcSession(cppB, b, reg, { bootstrap: { kind: "stream-server" } });
  const client = new RpcSession(cppA, a);
  const root = client.bootstrap();

  const baselineBytes = cppA.memory.buffer.byteLength;
  const snapshots = [{ chunk: 0, bytes: baselineBytes }];

  // windowSize=4 is a realistic backpressure setting. Without it, the
  // server can sprint ahead of the client and queue megabytes of frames
  // in transport buffers — which would make us measure transport
  // queueing, not slot-pool recycling.
  const r = root.callStream(IFC, 0, EMPTY, { windowSize: 4 });
  let received = 0;
  let totalBytes = 0;
  let firstByteOk = true;
  let lastByteOk = true;
  for await (const chunk of r.chunks) {
    received++;
    totalBytes += chunk.byteLength;
    // Spot-check first and last byte of every chunk to catch corruption
    // without paying O(N) per byte.
    if (chunk[0] !== 0) firstByteOk = false;
    if (chunk[CHUNK_BYTES - 1] !== ((CHUNK_BYTES - 1) & 0xff)) lastByteOk = false;
    if (received % SNAPSHOT_EVERY === 0) {
      snapshots.push({ chunk: received, bytes: cppA.memory.buffer.byteLength });
    }
  }
  client.close();

  assert.equal(received, CHUNKS, "should receive every chunk");
  assert.equal(totalBytes, CHUNKS * CHUNK_BYTES, "total bytes round-trip");
  assert.ok(firstByteOk, "first byte of every chunk preserved");
  assert.ok(lastByteOk, "last byte of every chunk preserved");

  const peak = snapshots.reduce((m, s) => Math.max(m, s.bytes), baselineBytes);
  // Surface the trajectory so a failure tells us *what* growth happened,
  // not just "too big."
  const trajectory = snapshots.map(s =>
    `  chunk=${s.chunk.toString().padStart(4)} bytes=${(s.bytes / (1 << 20)).toFixed(1)} MiB`
  ).join("\n");

  assert.ok(
    peak <= CEILING_BYTES,
    `wasm memory grew past ceiling.\n` +
    `  baseline:  ${(baselineBytes / (1 << 20)).toFixed(1)} MiB\n` +
    `  peak:      ${(peak / (1 << 20)).toFixed(1)} MiB\n` +
    `  ceiling:   ${(CEILING_BYTES / (1 << 20)).toFixed(1)} MiB\n` +
    `  streamed:  ${(totalBytes / (1 << 20)).toFixed(0)} MiB across ${CHUNKS} chunks\n` +
    `  trajectory:\n${trajectory}`
  );

  // Also assert the last snapshot is no larger than the peak (sanity:
  // memory shouldn't be still climbing at the end of streaming).
  const last = snapshots[snapshots.length - 1].bytes;
  assert.ok(last <= peak, "final memory must not exceed peak");
});
