// Real C++ exception handling through wasm-EH in the schema compiler wasm.
// capnpc.wasm links the upstream libcxxabi+libunwind variant
// (cpp/build_eh_runtime.sh + cpp/eh_tag.s), catches kj::Exception inside
// C++, and surfaces bad-input reports as JS `Error` instances with the
// exception's description text. The browser/runtime wasm stays smaller and
// uses trap-on-throw stubs because cpp/wrapper.cpp has no C++ catch sites.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CapnpCompiler } from "../js/capnpc_loader.mjs";

test("wasm-EH: bad generic schema surfaces a clean error, not a wasm trap", async () => {
  const c = await CapnpCompiler.load();
  const src = `@0xfeedfacefeedface;
struct Box(T) { value @0 :T; }
struct UseBadBox { bad @0 :Box(UInt32); }
`;
  let caught = null;
  try {
    await c.compile("badgeneric.capnp", src);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected compile to fail on bad generic instantiation");
  // The thrown value should be a plain Error (not WebAssembly.Exception)
  // because the C++ side caught the kj::Exception and surfaced its
  // description through the reporter mechanism.
  assert.ok(caught instanceof Error, `expected Error, got ${caught.constructor.name}`);
  assert.match(caught.message, /pointer types|generic parameter/i);
});

test("wasm-EH: malformed schema text reports parse errors via the reporter", async () => {
  const c = await CapnpCompiler.load();
  const src = `@0xfeedfacefeedface;
struct Foo {
  not-a-valid-field-name @0 :Text;
}
`;
  let caught = null;
  try {
    await c.compile("bad.capnp", src);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected compile to fail on parse error");
  assert.ok(caught instanceof Error);
});

test("wasm-EH: well-formed schemas still compile and round-trip normally", async () => {
  const c = await CapnpCompiler.load();
  const src = `@0xcafe1234cafe1234;
struct Greeter {
  name @0 :Text;
  count @1 :UInt32;
}
`;
  // Should NOT throw.
  const structs = await c.compileToModel("ok.capnp", src);
  const greeter = structs.find(s => s.name === "Greeter");
  assert.ok(greeter, "expected Greeter struct in model");
  assert.equal(greeter.fields.length, 2);
});
