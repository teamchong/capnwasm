// Schema evolution: prove that adding a field (the only allowed schema
// change in Cap'n Proto) doesn't break either direction of version skew.
//
// v1 schema: Profile { id, name }
// v2 schema: Profile { id, name, email }   # email is new at @2
//
// All four combos must round-trip:
//   v1 encode → v1 decode  (baseline)
//   v2 encode → v2 decode  (baseline)
//   v1 encode → v2 decode  (old client → new server: email is "")
//   v2 encode → v1 decode  (new client → old server: email is silently ignored)

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  ProfileBuilder as ProfileBuilderV1,
  ProfileReader as ProfileReaderV1,
} from "./_fixtures/profile_v1.gen.mjs";
import {
  ProfileBuilder as ProfileBuilderV2,
  ProfileReader as ProfileReaderV2,
} from "./_fixtures/profile_v2.gen.mjs";

async function encodeV1({ id, name }) {
  const cpp = await loadWasm();
  const b = new ProfileBuilderV1(cpp);
  b.id = id;
  b.name = name;
  const len = cpp._exports.cpp_any_builder_finalize();
  return cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);
}

async function encodeV2({ id, name, email }) {
  const cpp = await loadWasm();
  const b = new ProfileBuilderV2(cpp);
  b.id = id;
  b.name = name;
  b.email = email;
  const len = cpp._exports.cpp_any_builder_finalize();
  return cpp._u8.slice(cpp._outPtr, cpp._outPtr + len);
}

async function decodeV1(bytes) {
  const cpp = await loadWasm();
  cpp._u8.set(bytes, cpp._inPtr);
  const dataPtr = cpp._exports.cpp_any_open(bytes.length);
  return new ProfileReaderV1(cpp, dataPtr);
}

async function decodeV2(bytes) {
  const cpp = await loadWasm();
  cpp._u8.set(bytes, cpp._inPtr);
  const dataPtr = cpp._exports.cpp_any_open(bytes.length);
  return new ProfileReaderV2(cpp, dataPtr);
}

test("schema evolution: v1 → v1 baseline", async () => {
  const bytes = await encodeV1({ id: 1n, name: "alice" });
  const r = await decodeV1(bytes);
  assert.equal(r.id, 1n);
  assert.equal(r.name, "alice");
});

test("schema evolution: v2 → v2 baseline", async () => {
  const bytes = await encodeV2({ id: 2n, name: "bob", email: "bob@x" });
  const r = await decodeV2(bytes);
  assert.equal(r.id, 2n);
  assert.equal(r.name, "bob");
  assert.equal(r.email, "bob@x");
});

test("schema evolution: v1 client → v2 server (new field defaults empty)", async () => {
  // Old client emits a v1 message — only id + name. Server runs v2 schema
  // and reads it through the v2 Reader. The new email field has no bytes
  // on the wire; Cap'n Proto's wire spec says it reads as default ("" for
  // Text). No error, no crash, no corruption.
  const bytes = await encodeV1({ id: 100n, name: "old-client" });
  const r = await decodeV2(bytes);
  assert.equal(r.id, 100n);
  assert.equal(r.name, "old-client");
  assert.equal(r.email, "", "new field reads as default empty Text");
});

test("schema evolution: v2 client → v1 server (new field silently ignored)", async () => {
  // New client emits a v2 message with an email field. Server runs v1
  // schema and decodes through the v1 Reader, which simply doesn't ask
  // about field @2 — it never sees the email bytes. No error.
  const bytes = await encodeV2({
    id: 200n,
    name: "new-client",
    email: "should-be-ignored@x",
  });
  const r = await decodeV1(bytes);
  assert.equal(r.id, 200n);
  assert.equal(r.name, "new-client");
  // r.email doesn't exist on the v1 Reader (no getter generated).
  assert.equal(typeof r.email, "undefined", "v1 Reader has no email getter");
});

test("schema evolution: full round-trip across versions stays bit-stable for shared fields", async () => {
  // Encode with v2, decode with v1, re-encode with v1 (losing email),
  // decode with v2. The shared fields survive intact; email is now empty.
  const bytes1 = await encodeV2({ id: 333n, name: "rt", email: "lost@x" });
  const r1 = await decodeV1(bytes1);
  assert.equal(r1.id, 333n);
  assert.equal(r1.name, "rt");
  // r1 is v1 — re-encoding through v1 produces a smaller message that
  // omits the email entirely.
  const bytes2 = await encodeV1({ id: r1.id, name: r1.name });
  const r2 = await decodeV2(bytes2);
  assert.equal(r2.id, 333n);
  assert.equal(r2.name, "rt");
  assert.equal(r2.email, "", "email lost in v1 round-trip");
});
