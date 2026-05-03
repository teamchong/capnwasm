// Smoke tests for the capnwasm CLI parser. Run via `node --test test/cli.test.mjs`.
//
// These cover the cases that broke during development: directive-overridden
// types, unknown struct refs, methods inside interfaces, unbalanced braces.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("../bin/capnwasm.mjs", import.meta.url).pathname;

function runCli(args, input) {
  const dir = mkdtempSync(join(tmpdir(), "cwtest-"));
  const inFile = join(dir, "input." + (args.format ?? "ts"));
  writeFileSync(inFile, input);
  const outFile = join(dir, "out.gen.mjs");
  const r = spawnSync("node", [CLI, "gen", inFile, "-o", outFile], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("ts: directive overrides number -> UInt32", () => {
  const r = runCli({ format: "ts" }, `
    interface User {
      // @capnp UInt32
      age: number;
    }
  `);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /User  \(1 fields\)/);
});

test("ts: methods inside interface fail loudly", () => {
  const r = runCli({ format: "ts" }, `
    interface Bad {
      doSomething(): void;
    }
  `);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /cannot parse|unsupported/);
});

test("ts: unknown struct ref via directive fails loudly", () => {
  const r = runCli({ format: "ts" }, `
    interface Has {
      // @capnp NotARealType
      field: number;
    }
  `);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not a known Cap'n Proto primitive/);
});

test("ts: forward struct reference resolves correctly", () => {
  const r = runCli({ format: "ts" }, `
    interface Outer {
      name: string;
      inner: Inner;
    }
    interface Inner {
      x: string;
    }
  `);
  assert.equal(r.code, 0, r.stderr);
});

test("ts: typo in struct ref name fails loudly", () => {
  const r = runCli({ format: "ts" }, `
    interface Outer {
      inner: Innre;
    }
  `);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Innre.*not a known/);
});

test("ts: unbalanced braces fail loudly", () => {
  const r = runCli({ format: "ts" }, `
    interface Unbalanced {
      field: string;
  `);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /unbalanced/);
});

test("capnp: rejects unknown struct ref", () => {
  const r = runCli({ format: "capnp" }, `
    @0xb1f7c5e9c4e02134;
    struct Foo {
      bar @0 :BadType;
    }
  `);
  assert.notEqual(r.code, 0);
  // Wasm-built capnp compiler reports this as "Not defined: BadType"; the
  // legacy JS-only parser used "not a known type". Either is a clear,
  // user-actionable message naming the missing type.
  assert.match(r.stderr, /BadType/);
  assert.match(r.stderr, /(not a known|Not defined)/);
});

test("capnp: parses simple struct", () => {
  const r = runCli({ format: "capnp" }, `
    @0xb1f7c5e9c4e02134;
    struct User {
      id @0 :UInt64;
      name @1 :Text;
    }
  `);
  assert.equal(r.code, 0, r.stderr);
});

test("bin: runs when invoked through a package-manager symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "cwbin-"));
  const schema = join(dir, "user.capnp");
  const out = join(dir, "user.gen.mjs");
  const bin = join(dir, "capnwasm");
  writeFileSync(schema, `@0xb1f7c5e9c4e02135;
struct User {
  id @0 :UInt64;
  name @1 :Text;
}`);
  symlinkSync(CLI, bin);

  const r = spawnSync(bin, ["gen", schema, "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Wrote .*user\.gen\.mjs/);
  assert.match(r.stdout, /User  \(2 fields\)/);
});
