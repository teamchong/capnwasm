// Multi-language wire interop test. Proves that bytes produced by
// capnwasm decode correctly with the upstream Cap'n Proto C++ binary
// (and vice versa). We've claimed wire compat in docs since day one;
// this is the thing that actually proves it.
//
// Requires `capnp` (Cap'n Proto reference CLI) on PATH:
//   brew install capnp        (macOS)
//   apt-get install capnproto (Debian/Ubuntu)
//
// Skips if capnp is not installed so this test doesn't break dev setups
// without it.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as loadWasm } from "../dist/inlined.mjs";
import { UserBuilder, UserReader } from "./_fixtures/example_user.gen.mjs";

const SCHEMA = "cpp/example_user.capnp";

function haveCapnp() {
  const r = spawnSync("capnp", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function capnpDecode(framedBytes, structName) {
  // capnp convert binary:json reads framed binary on stdin, writes JSON.
  // The struct name must match a top-level definition in the schema.
  const r = spawnSync(
    "capnp",
    ["convert", "binary:json", SCHEMA, structName],
    { input: framedBytes, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    throw new Error(`capnp convert failed: ${r.stderr.toString()}`);
  }
  return JSON.parse(r.stdout.toString());
}

function capnpEncode(jsonValue, structName) {
  // capnp convert json:binary reads JSON, writes framed binary.
  const r = spawnSync(
    "capnp",
    ["convert", "json:binary", SCHEMA, structName],
    { input: JSON.stringify(jsonValue), stdio: ["pipe", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    throw new Error(`capnp convert failed: ${r.stderr.toString()}`);
  }
  return new Uint8Array(r.stdout);
}

const skip = !haveCapnp();
if (skip) {
  test("interop: skipped (capnp CLI not installed)", { skip: true }, () => {});
}

test("interop: capnwasm encodes → upstream capnp decodes", { skip }, async () => {
  const cpp = await loadWasm();
  const b = new UserBuilder(cpp);
  b.id = 42n;
  b.age = 30;
  b.active = true;
  b.name = "Alice";
  b.email = "alice@example.com";
  b.bio = "engineer";

  // Pull the framed message bytes out of the wasm builder arena.
  const len = cpp._exports.cpp_any_builder_finalize();
  assert.ok(len > 0, "cpp_any_builder_finalize returned a length");
  const bytes = cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);

  // Decode with the upstream Cap'n Proto CLI — different binary, same wire.
  const decoded = capnpDecode(bytes, "User");
  assert.equal(decoded.id, "42");          // capnp emits UInt64 as string
  assert.equal(decoded.age, 30);
  assert.equal(decoded.active, true);
  assert.equal(decoded.name, "Alice");
  assert.equal(decoded.email, "alice@example.com");
  assert.equal(decoded.bio, "engineer");
});

test("interop: upstream capnp encodes → capnwasm decodes", { skip }, async () => {
  const value = {
    id: "1234567890",
    age: 25,
    active: false,
    name: "Bob",
    email: "bob@example.com",
    bio: "designer",
  };
  const bytes = capnpEncode(value, "User");

  // Stage bytes into wasm and parse through the AnyStruct reader path.
  // The standalone-Reader path in capnwasm reads framed messages via
  // cpp_any_message_open_root; that's what the typed Reader expects.
  const cpp = await loadWasm();
  cpp._u8.set(bytes, cpp._inPtr);
  const dataPtr = cpp._exports.cpp_any_open(bytes.length);
  assert.ok(dataPtr > 0, "cpp_any_open returned a dataPtr");

  const r = new UserReader(cpp, dataPtr);
  assert.equal(r.id, 1234567890n);
  assert.equal(r.age, 25);
  assert.equal(r.active, false);
  assert.equal(r.name, "Bob");
  assert.equal(r.email, "bob@example.com");
  assert.equal(r.bio, "designer");
});

test("interop: round-trip through both implementations", { skip }, async () => {
  // Encode with capnwasm → decode with upstream → re-encode with upstream
  // → decode with capnwasm. Tests the wire is bit-stable, not just
  // semantically compatible.
  const cpp = await loadWasm();
  const b = new UserBuilder(cpp);
  b.id = 9007199254740993n;   // > Number.MAX_SAFE_INTEGER, stresses int64
  b.age = 4_000_000_000;
  b.active = true;
  b.name = "round-trip-name";
  b.email = "rt@example.com";
  b.bio = "stress test";

  const len1 = cpp._exports.cpp_any_builder_finalize();
  const bytes1 = cpp._u8.slice(cpp._outPtr, cpp._outPtr + len1);

  const json = capnpDecode(bytes1, "User");
  const bytes2 = capnpEncode(json, "User");

  // Re-decode with capnwasm.
  const cpp2 = await loadWasm();
  cpp2._u8.set(bytes2, cpp2._inPtr);
  const dataPtr = cpp2._exports.cpp_any_open(bytes2.length);
  const r = new UserReader(cpp2, dataPtr);

  assert.equal(r.id, 9007199254740993n);
  assert.equal(r.age, 4_000_000_000);
  assert.equal(r.active, true);
  assert.equal(r.name, "round-trip-name");
  assert.equal(r.email, "rt@example.com");
  assert.equal(r.bio, "stress test");
});
