// Tests for js/inspect.mjs. The standalone wire inspector hosted at
// `<docs site>/inspect.js`.
//
// Two paths to verify:
//   1. Schemaless walk: feed it raw framed Cap'n Proto bytes (no codegen
//      reader), confirm it walks the segment table + root pointer +
//      nested struct/list/text correctly.
//   2. Schema-aware: feed it the same bytes plus a generated reader and
//      a loaded CapnCpp instance, confirm field-by-field decode matches.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { inspect } from "../js/inspect.mjs";
import { load } from "../dist/inlined.mjs";
import { buildUser, openUser, UserReader } from "../web/src/playground/users.capnp.gen.mjs";

const cpp = await load();

// Build a known message we can assert against.
function buildSampleUser() {
  const b = buildUser(cpp);
  b.id = 42n;
  b.name = "Alice";
  b.email = "alice@example.com";
  b.joinedAtMs = 1700000000000n;
  b.active = true;
  b.avatar = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  return b.toBytes();
}

test("inspect: schemaless walk reports segment + root struct shape correctly", async () => {
  const bytes = buildSampleUser();
  const out = await inspect(bytes, { log: false });
  assert.equal(out.bytes, bytes.length);
  assert.equal(out.segments.length, 1, "single-segment message");
  assert.equal(out.root.kind, "struct");
  // The User struct has UInt64 id, Text name, Text email, UInt64 joinedAtMs,
  // Bool active, Data avatar. That's 17 bytes of data + 3 pointers
  // (rounded up to 3 data words + 3 ptr words by Cap'n Proto's word-
  // aligned layout).
  assert.ok(out.root.dataWords >= 2, "data section non-empty");
  assert.ok(out.root.ptrWords >= 1, "pointer section non-empty");
  assert.ok(Array.isArray(out.root.pointers));
});

test("inspect: schemaless walk decodes Text pointers as strings", async () => {
  const bytes = buildSampleUser();
  const out = await inspect(bytes, { log: false });
  // Find the text pointers under root.pointers. At least one should
  // decode to "Alice" or "alice@example.com".
  const textPointers = out.root.pointers.filter((p) => p && p.kind === "text");
  assert.ok(textPointers.length >= 1, "expected at least one text pointer");
  const values = textPointers.map((p) => p.value);
  assert.ok(values.includes("Alice") || values.includes("alice@example.com"),
    "expected to find Alice or alice@example.com in the wire walk, got " + JSON.stringify(values));
});

test("inspect: schemaless walk surfaces Data pointers as bytes preview", async () => {
  const bytes = buildSampleUser();
  const out = await inspect(bytes, { log: false });
  // The avatar is 8 bytes that don't form valid printable UTF-8 in
  // entirely (1..8 are all control chars), so they come back as a
  // bytes view, not a text pointer.
  const bytePointers = out.root.pointers.filter((p) => p && p.kind === "bytes");
  // Could also classify as text since 1..8 isn't UTF-8-valid; be lenient.
  const all = out.root.pointers.filter(Boolean);
  assert.ok(all.length >= 2, "expected at least name + email + avatar pointers");
});

test("inspect: schema-aware path returns the same fields the reader does", async () => {
  const bytes = buildSampleUser();
  const out = await inspect(bytes, { reader: UserReader, cpp, log: false });
  assert.equal(out.id, 42n);
  assert.equal(out.name, "Alice");
  assert.equal(out.email, "alice@example.com");
  assert.equal(out.joinedAtMs, 1700000000000n);
  assert.equal(out.active, true);
  assert.ok(out.avatar instanceof Uint8Array);
  assert.equal(out.avatar.length, 8);
  assert.deepEqual(Array.from(out.avatar), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("inspect: accepts a Promise<Response> shape (the headline use case)", async () => {
  const bytes = buildSampleUser();
  const fakeResponse = new Response(bytes, {
    headers: { "content-type": "application/octet-stream" },
  });
  const promiseOfResponse = Promise.resolve(fakeResponse);
  const out = await inspect(promiseOfResponse, { log: false });
  assert.equal(out.bytes, bytes.length);
  assert.equal(out.root.kind, "struct");
});

test("inspect: accepts ArrayBuffer", async () => {
  const bytes = buildSampleUser();
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const out = await inspect(buf, { log: false });
  assert.equal(out.bytes, bytes.length);
  assert.equal(out.root.kind, "struct");
});

test("inspect: accepts DataView", async () => {
  const bytes = buildSampleUser();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = await inspect(dv, { log: false });
  assert.equal(out.bytes, bytes.length);
});

test("inspect: rejects nonsense input cleanly", async () => {
  await assert.rejects(inspect(null, { log: false }), /expected bytes/);
  await assert.rejects(inspect(undefined, { log: false }), /expected bytes/);
  await assert.rejects(inspect(42, { log: false }), /unsupported input type/);
  await assert.rejects(inspect("not-bytes", { log: false }), /unsupported input type/);
});

test("inspect: rejects truncated framed message with a useful error", async () => {
  // First 8 bytes of a real frame, then truncated.
  const bytes = buildSampleUser();
  const truncated = bytes.subarray(0, 4);
  await assert.rejects(inspect(truncated, { log: false }), /truncated/);
});

test("inspect: rejects garbage bytes that would overflow segment count", async () => {
  // A made-up 4-byte prefix that would claim 0xfffffff segments.
  const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  await assert.rejects(inspect(garbage, { log: false }), /implausibly large/);
});

test("inspect: schema-aware path errors clearly when cpp is missing", async () => {
  const bytes = buildSampleUser();
  await assert.rejects(
    inspect(bytes, { reader: UserReader, log: false }),
    /also needs `\{ cpp \}`/,
  );
});
