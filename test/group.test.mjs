// Verify nested group accessors:
//   r.parent.child  /  b.parent.child = ...
// Groups share storage with the parent. Accessing them is the same wasm
// cost as accessing a flat field, but the API mirrors the schema's shape.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI  = join(ROOT, "bin", "capnwasm.mjs");

const schemaSrc = `@0xb1f7c5e9c4e02134;
struct Person {
  name @0 :Text;
  address :group {
    street @1 :Text;
    city @2 :Text;
    zip @3 :UInt32;
  }
}`;

const tmp = mkdtempSync(join(tmpdir(), "cw-group-"));
writeFileSync(join(tmp, "person.capnp"), schemaSrc);
const r = spawnSync("node", [CLI, "gen", join(tmp, "person.capnp"), "-o", join(tmp, "person.gen.mjs")], { encoding: "utf8" });
if (r.status !== 0) throw new Error("codegen failed: " + r.stderr);

let cpp;
let gen;
before(async () => {
  const { load } = await import(pathToFileURL(resolve(ROOT, "dist", "inlined.mjs")).href);
  cpp = await load();
  gen = await import(pathToFileURL(join(tmp, "person.gen.mjs")).href);
});

test("group: build via b.address.field, read via r.address.field", () => {
  const b = new gen.PersonBuilder(cpp);
  b.name = "Alice";
  b.address.street = "1 Main St";
  b.address.city = "Springfield";
  b.address.zip = 12345;
  const bytes = b.toBytes();
  const r = gen.openPerson(cpp, bytes);
  assert.equal(r.name, "Alice");
  // The nested accessor returns a typed Reader for the group.
  assert.equal(r.address.street, "1 Main St");
  assert.equal(r.address.city, "Springfield");
  assert.equal(r.address.zip, 12345);
});

test("group: nested Reader/Builder classes are exported with parent-prefixed names", () => {
  assert.equal(typeof gen.Person_addressReader, "function");
  assert.equal(typeof gen.Person_addressBuilder, "function");
});
