// End-to-end: codegen interface metadata → typed proxy → bindHandlers.
// Generates a temporary echo schema, compiles it, then exercises the
// typed-proxy + bindHandlers helpers against a real RpcSession pair.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import { typed, bindHandlers } from "../js/typed.mjs";

const SCHEMA = `
@0xb0b1c0deabcdef01;

interface Echo @0xeeeeeeeeeeeeeeee {
  echo @0 (text :Text) -> (text :Text);
  ping @1 () -> (count :UInt64);
}
`;

async function compileFixture() {
  const dir = await mkdtemp(join(tmpdir(), "capnwasm-typed-"));
  const capnp = join(dir, "echo.capnp");
  const gen = join(dir, "echo.gen.mjs");
  await writeFile(capnp, SCHEMA);
  const r = spawnSync("node", ["bin/capnwasm.mjs", "gen", capnp, "-o", gen], {
    cwd: process.cwd(), encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`capnwasm gen failed: ${r.stderr}\n${r.stdout}`);
  }
  return gen;
}

async function setup() {
  const genPath = await compileFixture();
  const mod = await import(pathToFileURL(genPath).href);
  const cppA = await loadWasm();
  const cppB = await loadWasm();
  const { a, b } = createMemoryTransportPair();

  // Server: bindHandlers + an impl object.
  const registry = new InterfaceRegistry();
  let pingCount = 0;
  const impl = {
    echo({ text }) { return { text }; },
    ping() { return { count: BigInt(++pingCount) }; },
  };
  bindHandlers(registry, mod.Echo_INTERFACE, impl);

  const server = new RpcSession(cppB, b, registry, { bootstrap: impl });
  const client = new RpcSession(cppA, a);
  return { client, server, mod };
}

test("typed proxy: round-trips a method call with text params/results", async () => {
  const { client, mod } = await setup();
  const cap = client.bootstrap();
  const echo = typed(cap, mod.Echo_INTERFACE);

  const result = await echo.echo({ text: "hello" });
  assert.equal(result.text, "hello");
  client.close();
});

test("typed proxy: empty-params method works (no args object)", async () => {
  const { client, mod } = await setup();
  const cap = client.bootstrap();
  const echo = typed(cap, mod.Echo_INTERFACE);

  const r1 = await echo.ping();
  const r2 = await echo.ping();
  // u64 reader returns Number when safe-integer; coerce for the comparison.
  assert.equal(BigInt(r1.count), 1n);
  assert.equal(BigInt(r2.count), 2n);
  client.close();
});

test("typed proxy: rejects on missing-interface-meta arg", async () => {
  const { client } = await setup();
  const cap = client.bootstrap();
  assert.throws(() => typed(cap, null), /must be a \*_INTERFACE/);
  assert.throws(() => typed(cap, { id: 0n, methods: "nope" }), /must be a \*_INTERFACE/);
  client.close();
});

test("typed proxy: result is a plain JS object usable across awaits", async () => {
  const { client, mod } = await setup();
  const cap = client.bootstrap();
  const echo = typed(cap, mod.Echo_INTERFACE);

  // Two sequential calls — r1 must remain valid after r2 runs.
  // (The reader is live against wasm scratch memory; toObject materializes.)
  const r1 = await echo.echo({ text: "first" });
  const r2 = await echo.echo({ text: "second" });
  assert.equal(r1.text, "first");
  assert.equal(r2.text, "second");
  client.close();
});

test("interface ID survives round-trip without precision loss", async () => {
  const { mod } = await setup();
  // 0xeeeeeeeeeeeeeeee = 17216961135462248174 — well over 2^53.
  assert.equal(mod.Echo_INTERFACE.id, 17216961135462248174n);
  assert.equal(typeof mod.Echo_INTERFACE.id, "bigint");
});

// One-line API parity with capnweb's newHttpBatchRpcSession. typedClient(url,
// meta) does load + connect + bootstrap + wrap, and the user just calls
// methods on the returned proxy. URL scheme picks the transport.
test("typedClient: one-line API over HTTP batch", async () => {
  const genPath = await compileFixture();
  const mod = await import(pathToFileURL(genPath).href);

  // Server side: an in-process Worker handler shimmed through a fake fetch.
  const { createHttpBatchHandler } = await import("../js/http_batch.mjs");
  const cppServer = await loadWasm();
  const registry = new InterfaceRegistry();
  const impl = { echo({ text }) { return { text: `echo:${text}` }; }, ping() { return { count: 7n }; } };
  bindHandlers(registry, mod.Echo_INTERFACE, impl);
  const handler = createHttpBatchHandler(cppServer, registry, { bootstrap: impl });

  const fetchShim = async (_url, init) => {
    const req = new Request("http://test.local/rpc", {
      method: init.method, headers: init.headers, body: init.body,
    });
    return handler(req);
  };

  // The whole client side, in two lines:
  const { typedClient } = await import("../js/typed.mjs");
  const api = await typedClient("http://test.local/rpc", mod.Echo_INTERFACE, { fetch: fetchShim });

  const r = await api.echo({ text: "hi" });
  assert.equal(r.text, "echo:hi");
  const p = await api.ping();
  assert.equal(BigInt(p.count), 7n);

  api._session.close();
});
