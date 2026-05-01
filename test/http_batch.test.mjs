// HTTP batch transport: round-trip via an in-process fetch shim that wires
// the client transport's POST directly into the server handler. Same wasm
// instance used for both peers via separate loads (matches rpc.test.mjs).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { RpcSession, InterfaceRegistry } from "../js/rpc.mjs";
import {
  httpBatchTransport,
  connectHttpBatch,
  createHttpBatchHandler,
} from "../js/http_batch.mjs";

const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY.slice();

// In-process "fetch" that delegates to a Worker-shaped handler. Lets the
// tests run without spinning up an HTTP server.
function pairedFetch(handler) {
  return async function fetch(_url, init) {
    const req = new Request("http://test.local/rpc", {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
    });
    return handler(req);
  };
}

async function setup({ bootstrap, registry } = {}) {
  const cppServer = await loadWasm();
  const cppClient = await loadWasm();
  const handler = createHttpBatchHandler(cppServer, registry, { bootstrap });
  const client = connectHttpBatch(cppClient, "http://test.local/rpc", {
    fetch: pairedFetch(handler),
    registry,
  });
  return { client };
}

test("http batch: bootstrap + call round-trips", async () => {
  const IFC = 0xabcdef0123456789n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async (target, ctx) => ctx.paramsBytes());
  const serverImpl = { kind: "echo" };
  const { client } = await setup({ bootstrap: serverImpl, registry });

  const cap = client.bootstrap();
  const { promise } = cap.call(IFC, 0, emptyMessage());
  const { bytes } = await promise;
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 16);

  client.close();
});

test("http batch: multiple calls in same tick coalesce into one POST", async () => {
  const IFC = 0xeeee2222eeee2222n;
  const registry = new InterfaceRegistry();
  let handlerInvocations = 0;
  registry.register(IFC, 0, async () => { handlerInvocations++; return null; });

  let postCount = 0;
  const cppServer = await loadWasm();
  const cppClient = await loadWasm();
  const baseHandler = createHttpBatchHandler(cppServer, registry, { bootstrap: {} });
  const handler = async (req) => { postCount++; return baseHandler(req); };
  const client = connectHttpBatch(cppClient, "http://test.local/rpc", {
    fetch: pairedFetch(handler),
    registry,
  });

  const cap = client.bootstrap();
  const promises = [
    cap.call(IFC, 0, emptyMessage()).promise,
    cap.call(IFC, 0, emptyMessage()).promise,
    cap.call(IFC, 0, emptyMessage()).promise,
  ];
  await Promise.all(promises);
  assert.equal(handlerInvocations, 3, "all three handlers ran on the server");
  assert.equal(postCount, 1, "client coalesced the burst into a single HTTP POST");

  client.close();
});

test("http batch: server-side exception surfaces as a rejected promise", async () => {
  const IFC = 0x1111111111111111n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async () => { throw new Error("boom"); });
  const { client } = await setup({ bootstrap: {}, registry });

  const { promise } = client.bootstrap().call(IFC, 0, emptyMessage());
  await assert.rejects(promise, /boom/);
  client.close();
});

test("http batch: handler that awaits async work still returns full response", async () => {
  const IFC = 0x4242424242424242n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async (target, ctx) => {
    // Simulate an upstream fetch — the response should not flush until
    // this completes.
    await new Promise(r => setTimeout(r, 25));
    return ctx.paramsBytes();
  });
  const { client } = await setup({ bootstrap: {}, registry });

  const start = Date.now();
  const { promise } = client.bootstrap().call(IFC, 0, emptyMessage());
  await promise;
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 25, `expected to wait for async handler, took ${elapsed}ms`);

  client.close();
});

test("http batch: bootstrap can be derived per-request from the Request", async () => {
  const IFC = 0xdadadadadadadadan;
  const registry = new InterfaceRegistry();
  let seenAuth = null;
  registry.register(IFC, 0, async (target) => {
    seenAuth = target.auth;
    return null;
  });
  const cppServer = await loadWasm();
  const cppClient = await loadWasm();
  const handler = createHttpBatchHandler(cppServer, registry, {
    bootstrap: (req) => ({ auth: req.headers.get("X-Auth-Token") ?? "anon" }),
  });
  const client = connectHttpBatch(cppClient, "http://test.local/rpc", {
    fetch: pairedFetch(handler),
    registry,
    headers: { "X-Auth-Token": "tok-from-client" },
  });

  await client.bootstrap().call(IFC, 0, emptyMessage()).promise;
  assert.equal(seenAuth, "tok-from-client");
  client.close();
});

test("http batch: handler rejects non-POST", async () => {
  const cpp = await loadWasm();
  const handler = createHttpBatchHandler(cpp, new InterfaceRegistry(), { bootstrap: {} });
  const res = await handler(new Request("http://test.local/rpc", { method: "GET" }));
  assert.equal(res.status, 405);
});

test("http batch: handler rejects wrong content-type", async () => {
  const cpp = await loadWasm();
  const handler = createHttpBatchHandler(cpp, new InterfaceRegistry(), { bootstrap: {} });
  const res = await handler(new Request("http://test.local/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }));
  assert.equal(res.status, 415);
});

test("http batch: transport.close() prevents further posts", async () => {
  const cpp = await loadWasm();
  let postCount = 0;
  const handler = createHttpBatchHandler(cpp, new InterfaceRegistry(), { bootstrap: {} });
  const transport = httpBatchTransport("http://test.local/rpc", {
    fetch: async (url, init) => { postCount++; return handler(new Request(url, init)); },
  });
  let closed = false;
  transport.onClose(() => { closed = true; });
  transport.close();
  // After close, send() must be a no-op.
  transport.send(new Uint8Array([1, 2, 3]));
  await new Promise(r => queueMicrotask(r));
  assert.equal(postCount, 0, "no POST after close");
  assert.equal(closed, true, "onClose fires");
});
