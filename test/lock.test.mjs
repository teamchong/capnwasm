// Lock file engine: pinned `@N` ordinals across schema edits.
//
// The contract these tests pin:
//
//   1. Bootstrap: every member from emit-capnp's structural inventory
//      gets a positional ordinal in emission order.
//   2. Update preserves all existing ordinals verbatim. New members
//      get the next free ordinal in the scope.
//   3. Removed members tombstone (stay in the lock with their ordinal
//      so it isn't reused).
//   4. emit-capnp respects the lock: present members emit at their
//      pinned ordinals; tombstoned members reappear as
//      `removedFoo @N :Void;` so the ordinal slot stays sequential.
//   5. Output of step 4 passes `capnp compile`.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseOpenApi } from "../js/openapi_parser.mjs";
import { buildManifest } from "../js/manifest.mjs";
import { buildCapnp } from "../js/emit_capnp.mjs";
import { bootstrapLock, updateLock, lookup, lockToJson } from "../js/lock.mjs";

const PETSTORE_V1 = {
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id:   { type: "string" },
          name: { type: "string" },
          tag:  { type: "string", nullable: true },
          kind: { type: "string", enum: ["dog", "cat", "bird"] },
        },
      },
    },
  },
};

const PETSTORE_V2_RENAMED = {
  ...PETSTORE_V1,
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "displayName"],
        properties: {
          id:          { type: "string" },
          displayName: { type: "string" },     // renamed from `name`
          tag:         { type: "string", nullable: true },
          kind:        { type: "string", enum: ["dog", "cat", "bird", "hamster"] },  // hamster added
          weightKg:    { type: "number" },     // new field
        },
      },
    },
  },
};

function manifestFromSpec(spec, name = "spec.json") {
  return buildManifest(parseOpenApi(spec), { source: { name, format: "openapi" } });
}

function inventoryOf(manifest) {
  return buildCapnp(manifest).structures;
}

// ---- bootstrap -------------------------------------------------------

test("bootstrapLock: assigns positional ordinals for every emitted member", () => {
  const lock = bootstrapLock(inventoryOf(manifestFromSpec(PETSTORE_V1)));
  // Pet
  assert.equal(lookup(lock, "structs", "Pet", "fields", "id"), 0);
  assert.equal(lookup(lock, "structs", "Pet", "fields", "name"), 1);
  assert.equal(lookup(lock, "structs", "Pet", "fields", "tag"), 2);
  assert.equal(lookup(lock, "structs", "Pet", "fields", "kind"), 3);
  // Inline enum (PetKind, derived from Pet.kind)
  assert.equal(lookup(lock, "enums", "PetKind", "values", "dog"), 0);
  assert.equal(lookup(lock, "enums", "PetKind", "values", "cat"), 1);
  assert.equal(lookup(lock, "enums", "PetKind", "values", "bird"), 2);
  // Interface
  assert.equal(lookup(lock, "interfaces", "Petstore", "methods", "listPets"), 0);
});

test("bootstrapLock: tracks `next` so subsequent updates keep ordinals monotonic", () => {
  const lock = bootstrapLock(inventoryOf(manifestFromSpec(PETSTORE_V1)));
  assert.equal(lock.structs.Pet.next, 4);
  assert.equal(lock.enums.PetKind.next, 3);
  assert.equal(lock.interfaces.Petstore.next, 1);
});

// ---- update ----------------------------------------------------------

test("updateLock: existing assignments are preserved verbatim, new members get next free", () => {
  const v1Inv = inventoryOf(manifestFromSpec(PETSTORE_V1));
  const v1Lock = bootstrapLock(v1Inv);

  const v2Inv = inventoryOf(manifestFromSpec(PETSTORE_V2_RENAMED));
  const { lock, diff } = updateLock(v1Lock, v2Inv);

  // Old assignments unchanged.
  assert.equal(lookup(lock, "structs", "Pet", "fields", "id"), 0);
  assert.equal(lookup(lock, "structs", "Pet", "fields", "tag"), 2);
  assert.equal(lookup(lock, "structs", "Pet", "fields", "kind"), 3);
  // `name` removed from schema → still present in lock (tombstone).
  assert.equal(lookup(lock, "structs", "Pet", "fields", "name"), 1);
  // New fields appended after the previous `next` (4) and the
  // first-fit allocator climbed past any holes.
  const dn = lookup(lock, "structs", "Pet", "fields", "displayName");
  const wk = lookup(lock, "structs", "Pet", "fields", "weightKg");
  assert.ok(dn >= 4);
  assert.ok(wk >= 4);
  assert.notEqual(dn, wk);

  assert.ok(diff.removed.some((r) => r.includes("Pet.fields.name")));
  assert.ok(diff.added.some((a) => a.includes("Pet.fields.displayName")));
  assert.ok(diff.added.some((a) => a.includes("Pet.fields.weightKg")));
});

test("updateLock: tombstoned members are never re-issued even if a new member would land on the same ordinal", () => {
  // Bootstrap a lock from a 3-field struct, then "remove" all 3 and
  // add 3 new ones. The new ones must get @3, @4, @5 (not 0, 1, 2).
  const inv1 = { interfaces: {}, structs: { Bag: { fields: ["a", "b", "c"] } }, enums: {} };
  const lock1 = bootstrapLock(inv1);
  assert.equal(lock1.structs.Bag.next, 3);

  const inv2 = { interfaces: {}, structs: { Bag: { fields: ["x", "y", "z"] } }, enums: {} };
  const { lock: lock2 } = updateLock(lock1, inv2);
  assert.equal(lock2.structs.Bag.fields.x, 3);
  assert.equal(lock2.structs.Bag.fields.y, 4);
  assert.equal(lock2.structs.Bag.fields.z, 5);
  // Old members tombstone at their original ordinals.
  assert.equal(lock2.structs.Bag.fields.a, 0);
  assert.equal(lock2.structs.Bag.fields.b, 1);
  assert.equal(lock2.structs.Bag.fields.c, 2);
});

// ---- emit-capnp + lock integration ---------------------------------

test("emit-capnp: pinned ordinals from lock are honored", () => {
  const v1 = manifestFromSpec(PETSTORE_V1);
  const lock = bootstrapLock(buildCapnp(v1).structures);

  const v2 = manifestFromSpec(PETSTORE_V2_RENAMED);
  const { lock: updatedLock } = updateLock(lock, buildCapnp(v2).structures);
  v2.lock = updatedLock;

  const { text } = buildCapnp(v2);
  // `id` stays at @0; `tag` at @2; `kind` at @3.
  const petBlock = text.match(/struct Pet \{[\s\S]*?\n\}/)[0];
  assert.match(petBlock, /id @0 :/);
  assert.match(petBlock, /tag @2 :/);
  assert.match(petBlock, /kind @3 :/);
  // displayName + weightKg at >=4 (the lock's `next` after v1).
  assert.match(petBlock, /displayName @[4-9]\d* :/);
  assert.match(petBlock, /weightKg @[4-9]\d* :/);
});

test("emit-capnp: tombstoned fields reappear as removedFoo :Void so ordinals stay sequential", () => {
  const v1 = manifestFromSpec(PETSTORE_V1);
  const lock = bootstrapLock(buildCapnp(v1).structures);

  const v2 = manifestFromSpec(PETSTORE_V2_RENAMED);
  const { lock: updatedLock } = updateLock(lock, buildCapnp(v2).structures);
  v2.lock = updatedLock;

  const { text } = buildCapnp(v2);
  const petBlock = text.match(/struct Pet \{[\s\S]*?\n\}/)[0];
  // `name` was removed from the schema. Lock keeps @1 reserved, so the
  // emit must include `removedName @1 :Void;` to fill the slot.
  assert.match(petBlock, /removedName @1 :Void;/);
  // No skipped ordinals: ordinals 0..N must each appear exactly once.
  const ords = [...petBlock.matchAll(/@(\d+)/g)].map((m) => parseInt(m[1], 10));
  ords.sort((a, b) => a - b);
  for (let i = 0; i < ords.length; i++) assert.equal(ords[i], i);
});

const haveCapnp = spawnSync("capnp", ["--version"], { encoding: "utf8" }).status === 0;

test("emit-capnp + lock: tombstoned schema still passes `capnp compile`", { skip: !haveCapnp }, () => {
  const v1 = manifestFromSpec(PETSTORE_V1);
  const lock1 = bootstrapLock(buildCapnp(v1).structures);

  const v2 = manifestFromSpec(PETSTORE_V2_RENAMED);
  const { lock: lock2 } = updateLock(lock1, buildCapnp(v2).structures);
  v2.lock = lock2;

  const { text } = buildCapnp(v2);
  const dir = mkdtempSync(join(tmpdir(), "capnwasm-lock-"));
  const file = join(dir, "schema.capnp");
  writeFileSync(file, text);
  const r = spawnSync("capnp", ["compile", "-o-", file], { encoding: "utf8" });
  assert.equal(r.status, 0, `capnp compile failed:\n${r.stderr}`);
});

// ---- IO --------------------------------------------------------------

// ---- rename detection ------------------------------------------------

test("updateLock --detect-renames: unique 1-to-1 type match transfers the ordinal", () => {
  const v1Inv = inventoryOf(manifestFromSpec(PETSTORE_V1));
  const v1Lock = bootstrapLock(v1Inv);

  const v2Inv = inventoryOf(manifestFromSpec(PETSTORE_V2_RENAMED));
  const { lock, diff } = updateLock(v1Lock, v2Inv, { detectRenames: true });

  // `name` (Text) was the only removed Text field, `displayName` (Text)
  // was the only new Text field → transfer `@1` to `displayName`.
  assert.equal(lookup(lock, "structs", "Pet", "fields", "displayName"), 1);
  assert.equal(lookup(lock, "structs", "Pet", "fields", "name"), undefined);
  assert.ok(diff.renamed.some((r) => r.includes("name→displayName@1")));
});

test("updateLock --detect-renames: ambiguous (multi-match) leaves both as tombstone+new", () => {
  // Two removed Text fields + two new Text fields = ambiguous. Don't
  // guess; tombstone the old ones, append the new ones.
  const inv1 = { interfaces: {}, enums: {}, structs: { Bag: { fields: [{ name: "a", type: "Text" }, { name: "b", type: "Text" }] } } };
  const lock1 = bootstrapLock(inv1);

  const inv2 = { interfaces: {}, enums: {}, structs: { Bag: { fields: [{ name: "x", type: "Text" }, { name: "y", type: "Text" }] } } };
  const { lock, diff } = updateLock(lock1, inv2, { detectRenames: true });

  // No renames recorded; `a` and `b` tombstone, `x` and `y` get new ordinals.
  assert.equal(diff.renamed.length, 0);
  assert.equal(lookup(lock, "structs", "Bag", "fields", "a"), 0);  // tombstoned
  assert.equal(lookup(lock, "structs", "Bag", "fields", "b"), 1);  // tombstoned
  assert.equal(lookup(lock, "structs", "Bag", "fields", "x"), 2);  // new
  assert.equal(lookup(lock, "structs", "Bag", "fields", "y"), 3);  // new
});

test("updateLock --detect-renames: type mismatch never gets matched", () => {
  // Removed Text + added UInt32 → don't transfer (different types).
  const inv1 = { interfaces: {}, enums: {}, structs: { Bag: { fields: [{ name: "a", type: "Text" }] } } };
  const lock1 = bootstrapLock(inv1);

  const inv2 = { interfaces: {}, enums: {}, structs: { Bag: { fields: [{ name: "x", type: "UInt32" }] } } };
  const { lock, diff } = updateLock(lock1, inv2, { detectRenames: true });

  assert.equal(diff.renamed.length, 0);
  assert.equal(lookup(lock, "structs", "Bag", "fields", "a"), 0);  // tombstoned
  assert.equal(lookup(lock, "structs", "Bag", "fields", "x"), 1);  // new
});

test("updateLock --detect-renames: methods are matched by signature", () => {
  // listPets(limit:Int32)->ListPetsResult renamed to listAllPets with
  // the same signature → rename detected. Without --detect-renames,
  // the test should still tombstone+new.
  const inv1 = {
    structs: {}, enums: {},
    interfaces: { Api: { methods: [{ name: "listPets", signature: "(Int32)->ListPetsResult" }] } },
  };
  const lock1 = bootstrapLock(inv1);

  const inv2 = {
    structs: {}, enums: {},
    interfaces: { Api: { methods: [{ name: "listAllPets", signature: "(Int32)->ListPetsResult" }] } },
  };
  const { lock, diff } = updateLock(lock1, inv2, { detectRenames: true });
  assert.ok(diff.renamed.some((r) => r.includes("listPets→listAllPets@0")));
  assert.equal(lookup(lock, "interfaces", "Api", "methods", "listAllPets"), 0);
  assert.equal(lookup(lock, "interfaces", "Api", "methods", "listPets"), undefined);
});

test("lockToJson: pretty-printed with trailing newline", () => {
  const lock = bootstrapLock(inventoryOf(manifestFromSpec(PETSTORE_V1)));
  const txt = lockToJson(lock);
  assert.equal(txt[txt.length - 1], "\n");
  // Two-space indent.
  assert.match(txt, /^\{\n {2}"lockfileVersion"/);
});
