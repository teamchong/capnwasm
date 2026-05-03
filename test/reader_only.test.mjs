// Verify capnp.reader.wasm round-trips through the codegen Reader path.
// We build the bytes with the full wasm (builder needed to encode), then
// decode them with the reader-only wasm to prove the read path runs
// against the smaller artifact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load as loadFull } from "../dist/inlined.mjs";
import { load as loadReader } from "../js/reader.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";
import { openUserList } from "../web/src/playground/users.capnp.gen.mjs";

// Load the reader-only wasm by reading bytes — Node's file:// fetch is not
// implemented, so the URL form in js/reader.mjs only works in browsers.
const READER_WASM_PATH = fileURLToPath(new URL("../dist/capnp.reader.wasm", import.meta.url));
async function readerCpp() {
  return loadReader(readFileSync(READER_WASM_PATH));
}

const USER_SCHEMA = defineSchema({
  id:         { kind: "uint64", offset: 0 },
  name:       { kind: "text",   slot: 0 },
  email:      { kind: "text",   slot: 1 },
  joinedAtMs: { kind: "uint64", offset: 8 },
  active:     { kind: "bool",   bitOffset: 128 },
  avatar:     { kind: "data",   slot: 2 },
}, { dataWords: 3, ptrWords: 3 });

const USER_LIST_SCHEMA = defineSchema({
  users: { kind: "listStruct", slot: 0, element: USER_SCHEMA },
}, { dataWords: 0, ptrWords: 1 });

function makeBytes(cppFull, n) {
  const users = new Array(n);
  for (let i = 0; i < n; i++) {
    users[i] = {
      id: BigInt(i + 1),
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      joinedAtMs: BigInt(1700000000000 + i * 86400000),
      active: (i & 1) === 0,
      avatar: new Uint8Array(0),
    };
  }
  const b = buildDynamic(cppFull, USER_LIST_SCHEMA);
  b.set("users", users);
  return b.finalize();
}

test("reader-only wasm exposes the read path and not the write path", async () => {
  const cppReader = await readerCpp();
  const exp = cppReader._exports;
  // Read path: present.
  assert.equal(typeof exp.cpp_any_open, "function");
  assert.equal(typeof exp.cpp_any_batch_read, "function");
  assert.equal(typeof exp.cpp_any_list_project, "function");
  assert.equal(typeof exp.cpp_any_text_at, "function");
  // Write / RPC / lazy / tape: absent.
  assert.equal(exp.cpp_any_builder_init, undefined, "builder leaked");
  assert.equal(exp.cpp_rpc_decode, undefined, "rpc leaked");
  assert.equal(exp.cpp_lazy_open, undefined, "lazy leaked");
  assert.equal(exp.cpp_serialize_tape, undefined, "tape leaked");
});

test("reader-only wasm decodes a UserList built by the full wasm", async () => {
  const cppFull = await loadFull();
  const cppReader = await readerCpp();
  const bytes = makeBytes(cppFull, 100);
  const reader = openUserList(cppReader, bytes);
  const rows = reader.draft((r) => r.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active,
  })));
  assert.equal(rows.length, 100);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].name, "User 1");
  assert.equal(rows[0].email, "user1@example.com");
  assert.equal(rows[0].active, true);
  assert.equal(rows[99].id, 100);
  assert.equal(rows[99].name, "User 100");
});

test("reader-only wasm honours slice fusion", async () => {
  const cppFull = await loadFull();
  const cppReader = await readerCpp();
  const bytes = makeBytes(cppFull, 1000);
  const reader = openUserList(cppReader, bytes);
  const rows = reader.draft((r) => r.users.map((u) => ({
    id: u.id,
    name: u.name,
  })).slice(0, 50));
  assert.equal(rows.length, 50);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[49].id, 50);
});

test("reader-only wasm honours filter pushdown", async () => {
  const cppFull = await loadFull();
  const cppReader = await readerCpp();
  const bytes = makeBytes(cppFull, 100);
  const reader = openUserList(cppReader, bytes);
  const rows = reader.draft((r) => r.users.filter((u) => u.active).map((u) => ({
    id: u.id,
    active: u.active,
  })));
  assert.equal(rows.length, 50);
  assert.equal(rows.every((r) => r.active === true), true);
});
