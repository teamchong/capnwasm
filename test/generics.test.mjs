// Generic Cap'n Proto schemas: `struct Box(T) { value @0 :T; }`. Concrete
// instantiations like `Box(Text)` and `Box(Tag)` round-trip through the
// codegen reader/builder. The unbound `value` field is exposed as an
// AnyPointer handle so callers decode it according to the type they expect.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  buildBox,
  openBox,
  buildUseBox,
  openUseBox,
  TagBuilder,
  TagReader,
} from "./_fixtures/generics.gen.mjs";

const SCHEMA = "test/_fixtures/generics.capnp";

function haveCapnp() {
  const r = spawnSync("capnp", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

let cpp;
before(async () => { cpp = await loadWasm(); });

test("generics: codegen Builder writes Box(Text), reader exposes value as AnyPointer text", () => {
  const b = buildBox(cpp);
  b.value = "hello capnwasm";
  const bytes = b.toBytes();
  const r = openBox(cpp, bytes);
  assert.equal(r.value.asText(), "hello capnwasm");
  r.dispose();
});

test("generics: Box(Data) carries a Uint8Array through value", () => {
  const b = buildBox(cpp);
  b.value = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const bytes = b.toBytes();
  const r = openBox(cpp, bytes);
  assert.deepEqual(Array.from(r.value.asData()), [0xde, 0xad, 0xbe, 0xef]);
  r.dispose();
});

test("generics: AnyPointer.asStruct decodes a struct ref written by upstream capnp CLI", { skip: !haveCapnp() }, () => {
  // Use the upstream `capnp convert` CLI to encode a Box(Tag) message, then
  // decode it via the codegen Box reader. The unbound `value @0 :T` field
  // exposes the embedded Tag through AnyPointer.asStruct(TagReader). This is
  // the canonical generic-schema interop shape.
  const json = JSON.stringify({ value: { name: "alpha", weight: 7 } });
  const r = spawnSync("capnp", ["convert", "json:binary", SCHEMA, "Box(Tag)"], {
    input: json,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (r.status !== 0) throw new Error(`capnp convert json:binary failed: ${r.stderr}`);
  const bytes = new Uint8Array(r.stdout);
  const reader = openBox(cpp, bytes);
  const tag = reader.value.asStruct(TagReader);
  assert.equal(tag.name, "alpha");
  assert.equal(tag.weight, 7);
  reader.dispose();
});

test("generics: capnwasm-encoded Box(Text) decodes through upstream capnp CLI", { skip: !haveCapnp() }, () => {
  const b = buildBox(cpp);
  b.value = "interop";
  const bytes = b.toBytes();
  const decoded = JSON.parse(
    spawnSync("capnp", ["convert", "binary:json", SCHEMA, "Box(Text)"], {
      input: bytes,
      stdio: ["pipe", "pipe", "pipe"],
    }).stdout.toString(),
  );
  assert.equal(decoded.value, "interop");
});
