// RouterRegistry: gateway session routes inbound calls by interface ID
// to backend RpcCaps living on outbound sessions.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import { RouterRegistry } from "../js/router.mjs";

const EMPTY_MESSAGE = (() => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 1, true);
  return out;
})();
const emptyMessage = () => EMPTY_MESSAGE.slice();

const IFC_A = 0xaaaaaaaaaaaaaaaan;
const IFC_B = 0xbbbbbbbbbbbbbbbbn;
const IFC_C = 0xccccccccccccccccn;
const IFC_UNKNOWN = 0xdeaddeaddeaddeadn;
const METHOD = 1;

// Backend: a session that registers `ifc.METHOD` to bump `counter[0]` and
// reply with an empty Cap'n Proto message. The shared counter lets the test
// verify which backend handled the call.
async function makeBackend(counter, ifc, { stream = false } = {}) {
  const cpp = await loadWasm();
  const registry = new InterfaceRegistry();
  if (stream) {
    registry.registerStream(ifc, METHOD, async function* () {
      counter[0] += 1;
      yield emptyMessage();
      yield emptyMessage();
    });
  } else {
    registry.register(ifc, METHOD, async () => {
      counter[0] += 1;
      return emptyMessage();
    });
  }
  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cpp, b, registry, { bootstrap: {} });
  return { cpp, server, transport: a };
}

test("router: routes by interface ID to the right backend", async () => {
  const aHits = [0], bHits = [0];
  const back1 = await makeBackend(aHits, IFC_A);
  const back2 = await makeBackend(bHits, IFC_B);

  // Each session on the gateway needs its own cpp instance — sessions share
  // cpp_in/cpp_out scratch buffers via the wasm linear memory, so two sessions
  // on the same instance corrupt each other under concurrent forwarding.
  const cppGwToB1 = await loadWasm();
  const cppGwToB2 = await loadWasm();
  const cppGwToClient = await loadWasm();
  const gwToB1 = new RpcSession(cppGwToB1, back1.transport);
  const gwToB2 = new RpcSession(cppGwToB2, back2.transport);

  const router = new RouterRegistry()
    .route(IFC_A, gwToB1.bootstrap())
    .route(IFC_B, gwToB2.bootstrap());

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppGwToClient, b, router, { bootstrap: {} });

  const cppClient = await loadWasm();
  const client = new RpcSession(cppClient, a);
  const cap = client.bootstrap();

  await cap.call(IFC_A, METHOD, emptyMessage(), []).promise;
  await cap.call(IFC_A, METHOD, emptyMessage(), []).promise;
  await cap.call(IFC_B, METHOD, emptyMessage(), []).promise;

  assert.equal(aHits[0], 2, "backend A handled 2 calls");
  assert.equal(bHits[0], 1, "backend B handled 1 call");
});

test("router: fallback handles unrouted interface", async () => {
  const fallHits = [0];
  const fall = await makeBackend(fallHits, IFC_UNKNOWN);

  const cppGwToFall = await loadWasm();
  const cppGwToClient = await loadWasm();
  const gwToFall = new RpcSession(cppGwToFall, fall.transport);

  const router = new RouterRegistry().routeFallback(gwToFall.bootstrap());

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppGwToClient, b, router, { bootstrap: {} });

  const cppClient = await loadWasm();
  const client = new RpcSession(cppClient, a);
  const cap = client.bootstrap();

  await cap.call(IFC_UNKNOWN, METHOD, emptyMessage(), []).promise;
  assert.equal(fallHits[0], 1, "fallback handled the call");
});

test("router: unrouted + no fallback → unknown method", async () => {
  const router = new RouterRegistry();
  const cppGateway = await loadWasm();
  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppGateway, b, router, { bootstrap: {} });

  const cppClient = await loadWasm();
  const client = new RpcSession(cppClient, a);
  const cap = client.bootstrap();

  await assert.rejects(
    cap.call(IFC_C, METHOD, emptyMessage(), []).promise,
    /unknown method/,
  );
});

test("router: rejects route() with no cap", () => {
  const router = new RouterRegistry();
  assert.throws(() => router.route(IFC_A, null), /cap is required/);
  assert.throws(() => router.routeFallback(null), /cap is required/);
});

test("router: forwards stream chunks", async () => {
  const hits = [0];
  const back = await makeBackend(hits, IFC_A, { stream: true });

  const cppGwToBack = await loadWasm();
  const cppGwToClient = await loadWasm();
  const gwToBack = new RpcSession(cppGwToBack, back.transport);
  const router = new RouterRegistry().routeStream(IFC_A, gwToBack.bootstrap());

  const { a, b } = createMemoryTransportPair();
  new RpcSession(cppGwToClient, b, router, { bootstrap: {} });

  const cppClient = await loadWasm();
  const client = new RpcSession(cppClient, a);
  const cap = client.bootstrap();

  const r = cap.callStream(IFC_A, METHOD, emptyMessage(), {});
  let received = 0;
  for await (const _chunk of r.chunks) received += 1;
  assert.equal(received, 2, "client received both stream chunks via gateway");
  assert.equal(hits[0], 1, "backend stream handler ran once");
});
