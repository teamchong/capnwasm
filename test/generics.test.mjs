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
  buildTag,
  openTag,
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

test("AnyPointer setter accepts a Reader (deep struct copy via slot)", () => {
  // Build a Tag and wrap it in a Box via AnyPointer struct write.
  // Box(T)'s `value` slot is exposed as bare AnyPointer in our codegen,
  // so the setter dispatches to cpp_any_builder_set_anypointer_from_slot.
  const tag = buildTag(cpp).fromObject({ name: "anyptr-copy", weight: 99 }).toBytes();
  const tagReader = openTag(cpp, tag);
  const b = buildBox(cpp);
  b.value = tagReader;
  const bytes = b.toBytes();
  const r = openBox(cpp, bytes);
  const decoded = r.value.asStruct(TagReader);
  assert.equal(decoded.name, "anyptr-copy");
  assert.equal(decoded.weight, 99);
  r.dispose();
  tagReader.dispose();
});

test("AnyPointer setter accepts a framed message via _capnpFrame", () => {
  // Same as above but through the bytes path (set_struct_from_bytes).
  // Useful when the caller has serialized bytes but no live Reader.
  const tagBytes = buildTag(cpp).fromObject({ name: "frame", weight: 1 }).toBytes();
  const b = buildBox(cpp);
  b.value = { _capnpFrame: tagBytes };
  const bytes = b.toBytes();
  const r = openBox(cpp, bytes);
  const decoded = r.value.asStruct(TagReader);
  assert.equal(decoded.name, "frame");
  assert.equal(decoded.weight, 1);
  r.dispose();
});

test("AnyPointer setter rejects unsupported value shapes", () => {
  const b = buildBox(cpp);
  assert.throws(() => { b.value = 42; }, /AnyPointer setter/);
  assert.throws(() => { b.value = { not: "a-reader" }; }, /AnyPointer setter/);
});

test("generic specialization: Box$Text exposes value as a typed string", async () => {
  // Codegen synthesized a Box$Text Reader/Builder for the Box(Text)
  // instantiation seen in UseBox.textBox. The specialized classes have
  // `value` typed as Text directly — no manual .asText() call needed.
  const { buildBox$Text, openBox$Text, Box$TextBuilder, Box$TextReader } =
    await import("./_fixtures/generics.gen.mjs");
  const b = buildBox$Text(cpp);
  b.value = "specialized";
  const bytes = b.toBytes();
  const r = openBox$Text(cpp, bytes);
  assert.equal(r.value, "specialized");
  r.dispose();
});

test("generic specialization: Box$Tag exposes value as a typed Tag reader", async () => {
  const { buildBox$Tag, openBox$Tag, Box$TagBuilder, Box$TagReader, TagBuilder, TagReader: _Tr } =
    await import("./_fixtures/generics.gen.mjs");
  const b = buildBox$Tag(cpp);
  // For now the AnyPointer-style setter still works on a specialized
  // Box$Tag because the underlying field is still a pointer. We accept
  // a Tag reader and copy it in.
  const tag = buildTag(cpp).fromObject({ name: "sp", weight: 11 }).toBytes();
  b.value = openTag(cpp, tag);
  const bytes = b.toBytes();
  const r = openBox$Tag(cpp, bytes);
  assert.equal(r.value.name, "sp");
  assert.equal(r.value.weight, 11);
  r.dispose();
});

test("generic specialization: UseBox.textBox returns Box$TextReader (typed access)", async () => {
  const { buildUseBox, openUseBox } = await import("./_fixtures/generics.gen.mjs");
  const b = buildUseBox(cpp);
  // The UseBox field setter for textBox uses the existing nested-struct
  // pattern, which routes through enter_struct. Since Box$Text has the
  // same wire layout as Box (1 ptr field), the bytes are identical.
  const tb = b.textBox;
  tb.value = "from-usebox";
  const bytes = b.toBytes();
  const r = openUseBox(cpp, bytes);
  // Typed access — no .asText() call.
  assert.equal(r.textBox.value, "from-usebox");
  r.dispose();
});
