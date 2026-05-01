// Tests for reconnectingTransport — auto-reconnect with exponential backoff,
// onReconnect callbacks, pending calls reject on drop, caller can resume after.
//
// We don't have a fake WebSocket; instead we drive reconnectingTransport with
// a memory-pair factory. Each "open" creates a fresh pair and a server-side
// session; "close" tears the pair down so the client loop sees the drop.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  RpcCap,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import { reconnectingTransport } from "../js/reconnect.mjs";

// Cap'n Proto frame holding a null AnyPointer — empty params/results.
const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

const TEST_IFC = 0x0123456789abcdefn;
const TEST_METHOD = 1;

function makeRegistry(handler) {
  const r = new InterfaceRegistry();
  r.register(TEST_IFC, TEST_METHOD, handler);
  return r;
}

function makeBootstrap() {
  return { kind: "bootstrap", id: Math.random() };
}

// Drives a reconnecting client. Each call to the factory builds a new memory
// pair and stands up a server-side session paired with it. The factory exposes
// a `dropCurrent()` lever so the test can simulate a peer drop.
async function setupReconnecting({ initialBackoff = 5 } = {}) {
  const cppA = await loadWasm();
  let serverSession = null;
  let serverEnd = null;
  const callsByVersion = [];

  const factory = async () => {
    const cppB = await loadWasm();
    const { a, b } = createMemoryTransportPair();
    const version = callsByVersion.length;
    callsByVersion.push(0);
    const registry = makeRegistry(async () => {
      callsByVersion[version] += 1;
      return { paramsBytes: emptyMessage(), capExports: [] };
    });
    serverSession = new RpcSession(cppB, b, registry, { bootstrap: makeBootstrap() });
    serverEnd = b;
    return a;
  };

  const dropCurrent = () => {
    // Closing the server end fires the client end's onClose, which drives
    // the client's session close, which fires our reconnect-loop's notifier.
    serverSession?.close();
    serverEnd?.close();
  };

  const conn = reconnectingTransport(cppA, factory, { initialBackoff });
  await conn.ready;
  return { conn, dropCurrent, callsByVersion };
}

test("reconnect: initial open fires ready", async () => {
  const { conn } = await setupReconnecting();
  assert.ok(conn.session, "session is exposed after ready");
  conn.close();
});

test("reconnect: onReconnect fires on first open and on each reconnect", async () => {
  const { conn, dropCurrent } = await setupReconnecting();
  const calls = [];
  conn.onReconnect((session, attempt) => {
    calls.push({ attempt, hasSession: !!session });
  });

  // Already-connected: synthesize a drop, wait for the loop to reopen.
  await new Promise(r => setTimeout(r, 10));
  dropCurrent();
  await new Promise(r => setTimeout(r, 50));
  // And again
  dropCurrent();
  await new Promise(r => setTimeout(r, 50));

  assert.ok(calls.length >= 2, `expected at least 2 reconnect callbacks, got ${calls.length}`);
  for (const c of calls) {
    assert.equal(c.hasSession, true);
    assert.ok(c.attempt >= 2);   // first onReconnect fires on attempt 2 since registered post-ready
  }
  conn.close();
});

test("reconnect: pending calls reject when transport drops", async () => {
  const { conn, dropCurrent } = await setupReconnecting();
  const session = conn.session;
  const cap = session.bootstrap();

  // Start a call, then drop the server before it can return.
  const callPromise = cap.call(TEST_IFC, TEST_METHOD, emptyMessage(), []).promise;
  dropCurrent();

  await assert.rejects(callPromise, "in-flight call rejects on drop");
  conn.close();
});

test("reconnect: caller can make new calls on the reconnected session", async () => {
  const { conn, dropCurrent } = await setupReconnecting();
  // First call on the original session.
  const r1 = await conn.session.bootstrap().call(TEST_IFC, TEST_METHOD, emptyMessage(), []).promise;
  assert.ok(r1, "first call returns");

  dropCurrent();
  // Wait for reconnect to land.
  await new Promise(r => setTimeout(r, 30));
  let waited = 0;
  while (!conn.session && waited < 500) {
    await new Promise(r => setTimeout(r, 10));
    waited += 10;
  }
  assert.ok(conn.session, "reconnected within 500ms");

  const r2 = await conn.session.bootstrap().call(TEST_IFC, TEST_METHOD, emptyMessage(), []).promise;
  assert.ok(r2, "second call on reconnected session returns");
  conn.close();
});

test("reconnect: close() stops the loop", async () => {
  const { conn, dropCurrent } = await setupReconnecting();
  conn.close();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(conn.session, null, "no session after close");
  // Even if we now drop and wait, no new session appears.
  dropCurrent();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(conn.session, null, "loop did not restart after close()");
});

test("reconnect: shouldReconnect=false stops on first drop", async () => {
  const cppA = await loadWasm();
  let serverSession = null;
  let serverEnd = null;
  const factory = async () => {
    const cppB = await loadWasm();
    const { a, b } = createMemoryTransportPair();
    serverSession = new RpcSession(cppB, b, undefined, { bootstrap: makeBootstrap() });
    serverEnd = b;
    return a;
  };
  let allowReconnect = true;
  const conn = reconnectingTransport(cppA, factory, {
    initialBackoff: 5,
    shouldReconnect: () => allowReconnect,
  });
  await conn.ready;

  allowReconnect = false;
  serverSession.close();
  serverEnd.close();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(conn.session, null, "loop respected shouldReconnect=false");
});
