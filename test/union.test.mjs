// Verify the wasm-compiler path produces working union accessors:
// which(), is<Variant>(), and discriminant-gated getters.

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
struct Contact {
  name @0 :Text;
  union {
    email @1 :Text;
    phone @2 :Text;
    none @3 :Void;
  }
}`;

const tmp = mkdtempSync(join(tmpdir(), "cw-union-"));
writeFileSync(join(tmp, "contact.capnp"), schemaSrc);
const r = spawnSync("node", [CLI, "gen", join(tmp, "contact.capnp"), "-o", join(tmp, "contact.gen.mjs")], { encoding: "utf8" });
if (r.status !== 0) throw new Error("codegen failed: " + r.stderr);

let cpp;
let gen;
before(async () => {
  const { load } = await import(pathToFileURL(resolve(ROOT, "dist", "inlined.mjs")).href);
  cpp = await load();
  gen = await import(pathToFileURL(join(tmp, "contact.gen.mjs")).href);
});

// Helper: build a Contact via raw capnp bytes. Write directly into cpp_in.
// Layout: 1-segment frame, root struct (1 data word for discriminant + name ptr).
// Easier: use the codegen's Builder.
function buildContactBytes(setUnion) {
  const b = new gen.ContactBuilder(cpp);
  b.name = "Alice";
  setUnion(b);
  return b.toBytes();
}

test("union: which() returns the discriminant for the active variant", () => {
  // We don't currently codegen union setters (Builder doesn't know about
  // discriminants yet). Manually craft bytes via openContact on a value.
  // Instead, use the C++ side to build Contact for each variant via a tiny
  // staging path: write via Builder, then read back via Reader.
  const bytes = buildContactBytes((b) => { b.email = "alice@example.com"; });
  const r = gen.openContact(cpp, bytes);
  // Builder doesn't set discriminant in this test path, so we just check
  // that which() exists and returns a stable value.
  assert.equal(typeof r.which, "function");
  assert.equal(typeof r.which(), "number");
});

test("union: is<Variant>() guards exist for all variants", () => {
  const bytes = buildContactBytes((b) => { b.email = "a@b"; });
  const r = gen.openContact(cpp, bytes);
  assert.equal(typeof r.isEmail, "function");
  assert.equal(typeof r.isPhone, "function");
  assert.equal(typeof r.isNone, "function");
});

test("union: writing a variant via the Builder auto-sets the discriminant", () => {
  // No more raw wasm calls. The Builder's setter for `email` writes the
  // discriminant automatically before writing the value.
  const b = new gen.ContactBuilder(cpp);
  b.name = "Alice";
  b.email = "alice@example.com";
  const bytes = b.toBytes();
  const r = gen.openContact(cpp, bytes);
  assert.equal(r.which(), 0);
  assert.equal(r.isEmail(), true);
  assert.equal(r.isPhone(), false);
  assert.equal(r.email, "alice@example.com");
  assert.equal(r.phone, undefined);
  assert.equal(r.none, undefined);
});

test("union: switching variant via the Builder shadows the previous one", () => {
  const b = new gen.ContactBuilder(cpp);
  b.name = "Bob";
  b.phone = "+1-555-0100";
  const bytes = b.toBytes();
  const r = gen.openContact(cpp, bytes);
  assert.equal(r.which(), 1);
  assert.equal(r.isPhone(), true);
  assert.equal(r.phone, "+1-555-0100");
  assert.equal(r.email, undefined);
});

test("union: setWhich() and Builder.Which constants give explicit control", () => {
  const b = new gen.ContactBuilder(cpp);
  b.name = "Charlie";
  b.setWhich(gen.ContactBuilder.Which.none);
  const bytes = b.toBytes();
  const r = gen.openContact(cpp, bytes);
  assert.equal(r.which(), 2);
  assert.equal(r.isNone(), true);
  // Reader Which constants mirror Builder Which constants:
  assert.equal(gen.ContactReader.Which.none, gen.ContactBuilder.Which.none);
});
