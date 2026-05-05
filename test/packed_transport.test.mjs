// Packed encoding option for the HTTP-batch transport: client and server
// agree to ship every RPC frame in Cap'n Proto packed form. The transport
// uses the `application/x-capnwasm-batch+packed` Content-Type so the server
// can auto-detect.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { InterfaceRegistry } from "../js/rpc.mjs";
import { connectHttpBatch, createHttpBatchHandler } from "../js/http_batch.mjs";

const EMPTY = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY.slice();

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

test("http batch packed: bootstrap + call round-trips through packed wire", async () => {
  const IFC = 0xabc01234abc01234n;
  const registry = new InterfaceRegistry();
  registry.register(IFC, 0, async (_target, ctx) => ctx.paramsBytes());
  const cppServer = await loadWasm();
  const cppClient = await loadWasm();

  const handler = createHttpBatchHandler(cppServer, registry, { bootstrap: { kind: "echo" } });
  let lastReqCt = null;
  let lastResCt = null;
  const observingHandler = async (req) => {
    lastReqCt = req.headers.get("Content-Type");
    const res = await handler(req);
    lastResCt = res.headers.get("Content-Type");
    return res;
  };

  const client = connectHttpBatch(cppClient, "http://test.local/rpc", {
    fetch: pairedFetch(observingHandler),
    registry,
    packed: true,
  });

  const cap = client.bootstrap();
  const { promise } = cap.call(IFC, 0, emptyMessage());
  const { bytes } = await promise;
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 16);
  assert.equal(lastReqCt, "application/x-capnwasm-batch+packed");
  assert.equal(lastResCt, "application/x-capnwasm-batch+packed");

  client.close();
});

test("http batch packed: server auto-detects packed via Content-Type", async () => {
  const IFC = 0xfff01234fff01234n;
  const registry = new InterfaceRegistry();
  let calls = 0;
  registry.register(IFC, 0, async () => { calls++; return null; });
  const cppServer = await loadWasm();
  const cppClient = await loadWasm();

  // Server is shared. The client decides packed vs framed.
  const handler = createHttpBatchHandler(cppServer, registry, { bootstrap: {} });
  const client = connectHttpBatch(cppClient, "http://test.local/rpc", {
    fetch: pairedFetch(handler),
    registry,
    packed: true,
  });
  const cap = client.bootstrap();
  await cap.call(IFC, 0, emptyMessage()).promise;
  assert.equal(calls, 1);
  client.close();
});

test("http batch packed: refuses opt without cpp instance", async () => {
  const { httpBatchTransport } = await import("../js/http_batch.mjs");
  assert.throws(
    () => httpBatchTransport("http://test.local/rpc", { packed: true }),
    /opts\.packed requires opts\.cpp/,
  );
});
