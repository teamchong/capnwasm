// Generated-Reader draft() projection API.
//
// draft() is the user-facing Immer-style read API: pass a callback, receive a
// plain object shaped however the callback returns. The recording planner runs
// the callback once against a Proxy that traces field accesses, then a
// precompiled plan does one batched wasm read per scope on every subsequent
// call. The tests below pin the contract for top-level fields, nested struct
// paths, list-of-struct .map(...) projections, plan caching, and the edge
// cases where the wire-side data is missing or empty.
//
// Each test compiles a fresh schema via `npx capnwasm gen` so the codegen
// path itself stays exercised: any regression in the generated reader breaks
// tests immediately, not just at runtime against pre-baked fixtures.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { load } from "../dist/inlined.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";

const CLI = new URL("../bin/capnwasm.mjs", import.meta.url).pathname;

// Compile a one-off .capnp source through the bundled wasm capnpc and import
// the generated module. Each test gets its own tmp dir so schemas don't fight
// over file IDs and module-cache entries.
async function compile(schemaText) {
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-draft-"));
  const schema = join(dir, "draft.capnp");
  const output = join(dir, "draft.gen.mjs");
  writeFileSync(schema, schemaText);
  const r = spawnSync("node", [CLI, "gen", schema, "-o", output], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return import(pathToFileURL(output).href);
}

// ---- happy path ---------------------------------------------------------

test("draft: supports deep nested struct projection", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e02136;
struct Profile {
  city @0 :Text;
  country @1 :Text;
}
struct Person {
  id @0 :UInt64;
  profile @1 :Profile;
  name @2 :Text;
}`);
  const cpp = await load();
  const Profile = defineSchema({
    city: { kind: "text", slot: 0 },
    country: { kind: "text", slot: 1 },
  }, { dataWords: 0, ptrWords: 2 });
  const Person = defineSchema({
    id: { kind: "uint64", offset: 0 },
    profile: { kind: "struct", slot: 0, schema: Profile },
    name: { kind: "text", slot: 1 },
  }, { dataWords: 1, ptrWords: 2 });
  const bytes = buildDynamic(cpp, Person).fromObject({
    id: 42n,
    name: "Alice",
    profile: { city: "Austin", country: "US" },
  }).finalize();

  const person = mod.openPerson(cpp, bytes);
  const projected = person.draft((p) => ({
    id: p.id,
    name: p.name,
    location: {
      city: p.profile.city,
    },
  }));

  assert.deepEqual(projected, {
    id: 42,
    name: "Alice",
    location: { city: "Austin" },
  });
});

test("draft: projects list rows with normal map syntax", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e02137;
struct User {
  id @0 :UInt64;
  name @1 :Text;
  email @2 :Text;
  active @3 :Bool;
}
struct UserList {
  users @0 :List(User);
}`);
  const cpp = await load();
  const User = defineSchema({
    id: { kind: "uint64", offset: 0 },
    active: { kind: "bool", bitOffset: 64 },
    name: { kind: "text", slot: 0 },
    email: { kind: "text", slot: 1 },
  }, { dataWords: 2, ptrWords: 2 });
  const UserList = defineSchema({
    users: { kind: "listStruct", slot: 0, element: User },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = buildDynamic(cpp, UserList).fromObject({
    users: [
      { id: 1n, name: "Ada", email: "ada@example.com", active: true },
      { id: 2n, name: "Grace", email: "grace@example.com", active: false },
    ],
  }).finalize();

  const projected = mod.openUserList(cpp, bytes).draft((r) => ({
    rows: r.users.map((u) => ({ id: u.id, name: u.name, active: u.active })),
  }));

  assert.deepEqual(projected, {
    rows: [
      { id: 1, name: "Ada", active: true },
      { id: 2, name: "Grace", active: false },
    ],
  });
});

test("draft: list projection keeps non-ASCII text correct", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0214b;
struct User {
  name @0 :Text;
  email @1 :Text;
}
struct UserList {
  users @0 :List(User);
}`);
  const cpp = await load();
  const User = defineSchema({
    name: { kind: "text", slot: 0 },
    email: { kind: "text", slot: 1 },
  }, { dataWords: 0, ptrWords: 2 });
  const UserList = defineSchema({
    users: { kind: "listStruct", slot: 0, element: User },
  }, { dataWords: 0, ptrWords: 1 });
  const rows = [
    { name: "Zoë", email: "zoe@example.com" },
    { name: "李雷", email: "li@example.com" },
  ];
  const bytes = buildDynamic(cpp, UserList).fromObject({ users: rows }).finalize();

  const projected = mod.openUserList(cpp, bytes).draft((r) => ({
    rows: r.users.map((u) => ({ name: u.name, email: u.email })),
  }));

  assert.deepEqual(projected, { rows });
});

test("draft: supports nested list projection with normal map syntax", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e02138;
struct Comment {
  body @0 :Text;
  author @1 :Text;
}
struct Profile {
  city @0 :Text;
  comments @1 :List(Comment);
}
struct Person {
  profile @0 :Profile;
  name @1 :Text;
}`);
  const cpp = await load();
  const Comment = defineSchema({
    body: { kind: "text", slot: 0 },
    author: { kind: "text", slot: 1 },
  }, { dataWords: 0, ptrWords: 2 });
  const Profile = defineSchema({
    city: { kind: "text", slot: 0 },
    comments: { kind: "listStruct", slot: 1, element: Comment },
  }, { dataWords: 0, ptrWords: 2 });
  const Person = defineSchema({
    profile: { kind: "struct", slot: 0, schema: Profile },
    name: { kind: "text", slot: 1 },
  }, { dataWords: 0, ptrWords: 2 });
  const bytes = buildDynamic(cpp, Person).fromObject({
    name: "Alice",
    profile: {
      city: "Austin",
      comments: [
        { body: "hello", author: "Ada" },
        { body: "world", author: "Grace" },
      ],
    },
  }).finalize();

  const projected = mod.openPerson(cpp, bytes).draft((p) => ({
    name: p.name,
    city: p.profile.city,
    comments: p.profile.comments.map((c) => ({ body: c.body })),
  }));

  assert.deepEqual(projected, {
    name: "Alice",
    city: "Austin",
    comments: [
      { body: "hello" },
      { body: "world" },
    ],
  });
});

test("draft: list row projection falls back for nested row fields", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e02142;
struct Profile {
  city @0 :Text;
}
struct User {
  id @0 :UInt64;
  profile @1 :Profile;
}
struct UserList {
  users @0 :List(User);
}`);
  const cpp = await load();
  const Profile = defineSchema({
    city: { kind: "text", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const User = defineSchema({
    id: { kind: "uint64", offset: 0 },
    profile: { kind: "struct", slot: 0, schema: Profile },
  }, { dataWords: 1, ptrWords: 1 });
  const UserList = defineSchema({
    users: { kind: "listStruct", slot: 0, element: User },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = buildDynamic(cpp, UserList).fromObject({
    users: [
      { id: 1n, profile: { city: "Austin" } },
      { id: 2n, profile: { city: "London" } },
    ],
  }).finalize();

  const projected = mod.openUserList(cpp, bytes).draft((r) => ({
    rows: r.users.map((u) => ({ id: u.id, city: u.profile.city })),
  }));

  assert.deepEqual(projected, {
    rows: [
      { id: 1, city: "Austin" },
      { id: 2, city: "London" },
    ],
  });
});

// ---- type coverage ------------------------------------------------------

test("draft: round-trips primitive types (bool, int, uint64, float, data, text)", async () => {
  // Order fields largest-first so Cap'n Proto's hole-filling layout becomes
  // unambiguous. The dynamic-builder schema below uses those exact offsets;
  // any drift between the builder's offsets and the codegen reader's
  // _FIELDS table would surface as garbled values, not silent corruption.
  const mod = await compile(`@0xb1f7c5e9c4e02139;
struct Mixed {
  big @0 :Int64;
  ratio @1 :Float64;
  count @2 :UInt32;
  flag @3 :Bool;
  label @4 :Text;
  blob @5 :Data;
}`);
  const cpp = await load();
  const Mixed = defineSchema({
    big: { kind: "int64", offset: 0 },
    ratio: { kind: "float64", offset: 8 },
    count: { kind: "uint32", offset: 16 },
    // Bool lands in the next available bit after UInt32 (byte 20, bit 0 →
    // bitOffset 160). Float64 already consumed bytes 8-15; UInt32 took 16-19.
    flag: { kind: "bool", bitOffset: 160 },
    label: { kind: "text", slot: 0 },
    blob: { kind: "data", slot: 1 },
  }, { dataWords: 3, ptrWords: 2 });
  const blob = new Uint8Array([1, 2, 3, 4]);
  const bytes = buildDynamic(cpp, Mixed).fromObject({
    flag: true,
    count: 7,
    big: -123456789012345n,
    ratio: 1.5,
    label: "hello",
    blob,
  }).finalize();

  const projected = mod.openMixed(cpp, bytes).draft((m) => ({
    flag: m.flag,
    count: m.count,
    big: m.big,
    ratio: m.ratio,
    label: m.label,
    blob: m.blob,
  }));

  assert.equal(projected.flag, true);
  assert.equal(projected.count, 7);
  assert.equal(projected.big, -123456789012345);
  assert.equal(projected.ratio, 1.5);
  assert.equal(projected.label, "hello");
  assert.deepEqual(Array.from(projected.blob), [1, 2, 3, 4]);
});

// ---- subset / shape semantics ------------------------------------------

test("draft: only requested fields appear in the materialized object", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0213a;
struct Triple {
  a @0 :UInt32;
  b @1 :UInt32;
  c @2 :UInt32;
}`);
  const cpp = await load();
  const Triple = defineSchema({
    a: { kind: "uint32", offset: 0 },
    b: { kind: "uint32", offset: 4 },
    c: { kind: "uint32", offset: 8 },
  }, { dataWords: 2, ptrWords: 0 });
  const bytes = buildDynamic(cpp, Triple).fromObject({ a: 1, b: 2, c: 3 }).finalize();

  const triple = mod.openTriple(cpp, bytes);
  // Only `a` is touched in the planning callback. The materialized object
  // must therefore have `a` and nothing else; `c` was never asked for, so the
  // pick step never reads it. The user's returned shape can rename the field.
  const projected = triple.draft((t) => ({ first: t.a }));
  assert.deepEqual(projected, { first: 1 });
});

test("draft: returns whatever shape the callback returns (primitive, array)", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0213b;
struct Triple {
  a @0 :UInt32;
  b @1 :UInt32;
  c @2 :UInt32;
}`);
  const cpp = await load();
  const Triple = defineSchema({
    a: { kind: "uint32", offset: 0 },
    b: { kind: "uint32", offset: 4 },
    c: { kind: "uint32", offset: 8 },
  }, { dataWords: 2, ptrWords: 0 });
  const bytes = buildDynamic(cpp, Triple).fromObject({ a: 10, b: 20, c: 30 }).finalize();
  const triple = mod.openTriple(cpp, bytes);

  // Single primitive return: draft just hands back the picked value, no
  // wrapping object.
  assert.equal(triple.draft((t) => t.b), 20);
  // Array return: ordering matches the callback expression, not declaration
  // order.
  assert.deepEqual(triple.draft((t) => [t.c, t.a]), [30, 10]);
});

// ---- structural edge cases ---------------------------------------------

test("draft: empty list yields an empty array via map", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0213c;
struct Item {
  v @0 :UInt32;
}
struct Bag {
  items @0 :List(Item);
}`);
  const cpp = await load();
  const Item = defineSchema({
    v: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 0 });
  const Bag = defineSchema({
    items: { kind: "listStruct", slot: 0, element: Item },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = buildDynamic(cpp, Bag).fromObject({ items: [] }).finalize();

  const projected = mod.openBag(cpp, bytes).draft((b) => ({
    rows: b.items.map((i) => ({ v: i.v })),
  }));
  assert.deepEqual(projected, { rows: [] });
});

test("draft: missing nested struct pointer materializes as zero-default fields", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0213d;
struct Inner {
  v @0 :UInt32;
}
struct Outer {
  name @0 :Text;
  inner @1 :Inner;
}`);
  const cpp = await load();
  // Build with the inner pointer never set: the dynamic builder leaves the
  // pointer-section slot null. Cap'n Proto wire convention is that a null
  // struct pointer reads as a struct with all fields at their zero defaults
  // (the same as if the writer had built one with no fields set). This is
  // what readers across all capnp implementations do; surfacing `null`
  // through draft would require an extra "is null pointer" wasm check that
  // doesn't exist in the boundary today.
  const Outer = defineSchema({
    name: { kind: "text", slot: 0 },
  }, { dataWords: 0, ptrWords: 2 });
  const bytes = buildDynamic(cpp, Outer).fromObject({ name: "no inner" }).finalize();

  const projected = mod.openOuter(cpp, bytes).draft((o) => ({
    name: o.name,
    inner: { v: o.inner.v },
  }));
  assert.deepEqual(projected, { name: "no inner", inner: { v: 0 } });
});

test("draft: three-level nesting projects through every level", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0213e;
struct Country {
  code @0 :Text;
}
struct Address {
  city @0 :Text;
  country @1 :Country;
}
struct Employee {
  name @0 :Text;
  address @1 :Address;
}`);
  const cpp = await load();
  const Country = defineSchema({
    code: { kind: "text", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const Address = defineSchema({
    city: { kind: "text", slot: 0 },
    country: { kind: "struct", slot: 1, schema: Country },
  }, { dataWords: 0, ptrWords: 2 });
  const Employee = defineSchema({
    name: { kind: "text", slot: 0 },
    address: { kind: "struct", slot: 1, schema: Address },
  }, { dataWords: 0, ptrWords: 2 });
  const bytes = buildDynamic(cpp, Employee).fromObject({
    name: "Alice",
    address: { city: "Austin", country: { code: "US" } },
  }).finalize();

  const projected = mod.openEmployee(cpp, bytes).draft((e) => ({
    name: e.name,
    city: e.address.city,
    country: e.address.country.code,
  }));
  assert.deepEqual(projected, { name: "Alice", city: "Austin", country: "US" });
});

// ---- callback identity / cache behaviour --------------------------------

test("draft: stable callback identity reuses the precompiled plan", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e0213f;
struct Triple {
  a @0 :UInt32;
  b @1 :UInt32;
  c @2 :UInt32;
}`);
  const cpp = await load();
  const Triple = defineSchema({
    a: { kind: "uint32", offset: 0 },
    b: { kind: "uint32", offset: 4 },
    c: { kind: "uint32", offset: 8 },
  }, { dataWords: 2, ptrWords: 0 });
  const bytes = buildDynamic(cpp, Triple).fromObject({ a: 1, b: 2, c: 3 }).finalize();
  const triple = mod.openTriple(cpp, bytes);

  // The Proxy planner has observable side effects: each get adds to a Set.
  // Wrap the callback so we can count how many times the planner saw it
  // executed. With caching, the planner runs exactly once; subsequent draft
  // calls run only the materialize step (which never calls the recording
  // Proxy, so plannerHits stays at 1).
  let plannerHits = 0;
  const probe = (t) => { plannerHits++; return { a: t.a, b: t.b }; };

  const first = triple.draft(probe);
  const second = triple.draft(probe);
  // We can't assert plannerHits === 1 directly without a hook into the planner;
  // we instead assert the materialized output on each call equals the same
  // shape, which proves the cached plan is still valid after the first run.
  assert.deepEqual(first, { a: 1, b: 2 });
  assert.deepEqual(second, { a: 1, b: 2 });
  // probe runs once during planning + once per draft() execution, so total
  // calls = 1 (plan) + 2 (execute) = 3. If the plan cache miss-fired on the
  // second draft() call, we'd see 4.
  assert.equal(plannerHits, 3);
});

test("draft: different callbacks against the same reader produce independent results", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e02140;
struct Triple {
  a @0 :UInt32;
  b @1 :UInt32;
  c @2 :UInt32;
}`);
  const cpp = await load();
  const Triple = defineSchema({
    a: { kind: "uint32", offset: 0 },
    b: { kind: "uint32", offset: 4 },
    c: { kind: "uint32", offset: 8 },
  }, { dataWords: 2, ptrWords: 0 });
  const bytes = buildDynamic(cpp, Triple).fromObject({ a: 1, b: 2, c: 3 }).finalize();
  const triple = mod.openTriple(cpp, bytes);

  // Each callback is a distinct closure → distinct cache key → distinct plan.
  // Both should still resolve correctly.
  const ab = triple.draft((t) => ({ a: t.a, b: t.b }));
  const c = triple.draft((t) => ({ c: t.c }));
  assert.deepEqual(ab, { a: 1, b: 2 });
  assert.deepEqual(c, { c: 3 });
});

// ---- list single-row projections ----------------------------------------

test("draft: single list row can be projected via map().slice()", async () => {
  const mod = await compile(`@0xb1f7c5e9c4e02141;
struct User {
  id @0 :UInt64;
  name @1 :Text;
  email @2 :Text;
}
struct UserList {
  users @0 :List(User);
}`);
  const cpp = await load();
  const User = defineSchema({
    id: { kind: "uint64", offset: 0 },
    name: { kind: "text", slot: 0 },
    email: { kind: "text", slot: 1 },
  }, { dataWords: 1, ptrWords: 2 });
  const UserList = defineSchema({
    users: { kind: "listStruct", slot: 0, element: User },
  }, { dataWords: 0, ptrWords: 1 });
  const bytes = buildDynamic(cpp, UserList).fromObject({
    users: [
      { id: 10n, name: "Ada", email: "ada@x" },
      { id: 11n, name: "Grace", email: "grace@x" },
    ],
  }).finalize();

  const projected = mod.openUserList(cpp, bytes).draft((r) =>
    r.users.map((u) => ({ id: u.id, name: u.name })).slice(1, 2),
  );
  assert.deepEqual(projected, [{ id: 11, name: "Grace" }]);
});
