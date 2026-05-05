// End-to-end RPC capability through a struct field. The Lobby interface's
// `greet` method returns a Greeting struct that embeds a Greeter
// capability. The client unwraps the embedded cap and calls .hello() on
// it; the call must reach the server-side Greeter handler.
//
// This exercises the cap-table threading added in Bucket 1:
//   1. Server-side Builder for the Greeting writes the cap via the
//      capability-typed field setter, which pushes into the outbound
//      cap sink and emits a wire pointer with a cap-table index.
//   2. RpcSession drains the sink before finalize, registering each cap
//      with the local export table and calling
//      cpp_rpc_set_outbound_cap_table.
//   3. Client-side Reader receives the Return, sees the embedded cap
//      pointer, looks up the index in the inbound capTable that
//      RpcSession built from CapDescriptor[].
//   4. Client calls .hello() on the resolved cap; the RPC layer routes
//      it to the original server-side Greeter target.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  RpcSession,
  InterfaceRegistry,
  createMemoryTransportPair,
} from "../js/rpc.mjs";
import {
  Greeter_INTERFACE,
  Lobby_INTERFACE,
  greet$ParamsReader,
  greet$ResultsBuilder,
  GreetingBuilder,
  GreetingReader,
  greet$ResultsReader,
  hello$ResultsBuilder,
  useCap$ParamsBuilder,
  useCap$ParamsReader,
  useCap$ResultsBuilder,
  useCap$ResultsReader,
} from "./_fixtures/cap_in_struct.gen.mjs";

test("cap in struct: server embeds cap, client invokes through struct field", async () => {
  const cppA = await loadWasm();
  const cppB = await loadWasm();

  const greeterTarget = {
    kind: "local",
    helloCallCount: 0,
  };

  const registry = new InterfaceRegistry();
  // Greeter.hello — returns "hi from server"
  registry.register(Greeter_INTERFACE.id, 0, async (target, ctx) => {
    target.helloCallCount = (target.helloCallCount ?? 0) + 1;
    const r = ctx.beginResults(hello$ResultsBuilder);
    r.msg = "hi from server";
  });
  // Lobby.greet — returns a Greeting whose `cap` is a Greeter target
  registry.register(Lobby_INTERFACE.id, 0, async (_target, ctx) => {
    const params = ctx.openParams(greet$ParamsReader);
    const who = params.who;
    const results = ctx.beginResults(greet$ResultsBuilder);
    const g = results.greeting;
    g.who = `hello, ${who}`;
    g.cap = greeterTarget;  // capability-typed field setter
  });

  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, registry, { bootstrap: { kind: "lobby" } });
  const client = new RpcSession(cppA, a);

  try {
    const lobby = client.bootstrap();
    // Issue Lobby.greet("world")
    const empty = (() => {
      const o = new Uint8Array(40);
      const dv = new DataView(o.buffer);
      dv.setUint32(0, 0, true); dv.setUint32(4, 4, true);
      // Pre-encoded greet$Params with who="world" via codegen builder
      return null;
    })();

    // Use the typed callBuilder API to set params.who
    const started = lobby.callBuilder(Lobby_INTERFACE.id, 0, Lobby_INTERFACE.methods[0].Params);
    started.params.who = "world";
    const sent = started.send({
      resultsReader: greet$ResultsReader,
      extract: (r, _caps) => {
        // Read the Greeting struct from the result and pull the cap
        const greeting = r.greeting;
        return {
          who: greeting.who,
          cap: greeting.cap,
        };
      },
    });
    const result = await sent.promise;
    assert.equal(result.who, "hello, world");
    assert.ok(result.cap, "greeting.cap should resolve to a cap proxy");
    assert.equal(typeof result.cap.callBuilder, "function", "cap should have callBuilder method");

    // Now invoke .hello() on the embedded cap
    const helloStarted = result.cap.callBuilder(Greeter_INTERFACE.id, 0, Greeter_INTERFACE.methods[0].Params);
    const helloSent = helloStarted.send({
      resultsReader: Greeter_INTERFACE.methods[0].ResultsReader,
      extract: (r) => r.msg,
    });
    const msg = await helloSent.promise;
    assert.equal(msg, "hi from server");
    assert.equal(greeterTarget.helloCallCount, 1, "server-side Greeter target should have been called");
  } finally {
    try { server.close(); } catch {}
    try { client.close(); } catch {}
  }
});

test("cap in struct: client embeds cap in params, server invokes through struct field", async () => {
  const cppA = await loadWasm();
  const cppB = await loadWasm();

  // Client-local Greeter target. The server will invoke .hello() on it
  // via the cap embedded in Lobby.useCap params.
  const clientGreeter = { kind: "client-local", helloCallCount: 0 };
  const clientReg = new InterfaceRegistry();
  clientReg.register(Greeter_INTERFACE.id, 0, async (target, ctx) => {
    target.helloCallCount = (target.helloCallCount ?? 0) + 1;
    const r = ctx.beginResults(hello$ResultsBuilder);
    r.msg = "hi from client";
  });

  const serverReg = new InterfaceRegistry();
  serverReg.register(Lobby_INTERFACE.id, 1, async (_target, ctx) => {
    // Pull the embedded Greeter out of params.greeting.cap and call it.
    const params = ctx.openParams(useCap$ParamsReader);
    const greeting = params.greeting;
    const cap = greeting.cap;
    if (!cap) throw new Error("server: expected greeting.cap to be a cap proxy");
    const helloStarted = cap.callBuilder(Greeter_INTERFACE.id, 0, Greeter_INTERFACE.methods[0].Params);
    const remoteMsg = await helloStarted.send({
      resultsReader: Greeter_INTERFACE.methods[0].ResultsReader,
      extract: (r) => r.msg,
    }).promise;
    const r = ctx.beginResults(useCap$ResultsBuilder);
    r.echoed = `relayed: ${remoteMsg}`;
  });

  const { a, b } = createMemoryTransportPair();
  const server = new RpcSession(cppB, b, serverReg, { bootstrap: { kind: "lobby" } });
  const client = new RpcSession(cppA, a, clientReg);

  try {
    const lobby = client.bootstrap();
    const started = lobby.callBuilder(Lobby_INTERFACE.id, 1, Lobby_INTERFACE.methods[1].Params);
    const greeting = started.params.greeting;
    greeting.who = "client-side";
    greeting.cap = clientGreeter;  // outbound capability
    const echoed = await started.send({
      resultsReader: useCap$ResultsReader,
      extract: (r) => r.echoed,
    }).promise;
    assert.equal(echoed, "relayed: hi from client");
    assert.equal(clientGreeter.helloCallCount, 1, "client-side Greeter target should have been called");
  } finally {
    try { server.close(); } catch {}
    try { client.close(); } catch {}
  }
});
