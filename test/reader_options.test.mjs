// ReaderOptions: tighten traversal / nesting limits to refuse oversize or
// deeply-nested messages. The C++ runtime applies the configured limits
// inside FlatArrayMessageReader so the limits enforce on wasm-side
// pointer dereferences, not just JS-side parsing.
//
// The browser/runtime wasm uses trap-on-throw exception ABI stubs to keep
// bundle size down. The schema compiler wasm is the artifact that links real
// wasm-EH because it catches kj::Exception in C++.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { openDynamic, encodeDynamic, defineSchema } from "../js/dynamic.mjs";

const Inner = defineSchema(
  { x: { kind: "uint32", offset: 0 } },
  { dataWords: 1, ptrWords: 0 },
);
const Outer = defineSchema(
  { inner: { kind: "struct", slot: 0, schema: Inner } },
  { dataWords: 0, ptrWords: 1 },
);

test("ReaderOptions: defaults open a normal message just fine", async () => {
  const cpp = await loadWasm();
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 42 } });
  const r = openDynamic(cpp, Outer, msg);
  assert.equal(r.get("inner").x, 42);
});

// Match either real wasm-EH (WebAssembly.Exception, for custom builds) or the
// default trap path (RuntimeError "unreachable" / aborted).
function isLimitViolation(err) {
  if (typeof WebAssembly !== "undefined" && WebAssembly.Exception && err instanceof WebAssembly.Exception) return true;
  if (err && err.constructor && err.constructor.name === "Exception") return true;
  if (err && /unreachable|trap|RuntimeError|aborted/i.test(String(err.message ?? err))) return true;
  return false;
}

test("ReaderOptions: tight traversal limit traps on dereference", async () => {
  const cpp = await loadWasm();
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 42 } });
  cpp.setReaderOptions({ traversalLimitInWords: 1 });
  try {
    let caught = null;
    try {
      const r = openDynamic(cpp, Outer, msg);
      // Force the lazy pointer dereference. Without forcing, the bound
      // check might not fire until a later access.
      r.get("inner")?.x;
    } catch (err) { caught = err; }
    assert.ok(caught, "expected an exception from a tight traversal limit");
    assert.ok(isLimitViolation(caught), `unexpected error: ${caught}`);
  } finally {
    cpp.resetReaderOptions();
  }
});

test("ReaderOptions: tight nestingLimit traps when descending into a child struct", async () => {
  const cpp = await loadWasm();
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 42 } });
  cpp.setReaderOptions({ nestingLimit: 1 });
  try {
    let caught = null;
    try {
      const r = openDynamic(cpp, Outer, msg);
      r.get("inner");
    } catch (err) { caught = err; }
    assert.ok(caught, "expected an exception from a tight nestingLimit");
    assert.ok(isLimitViolation(caught), `unexpected error: ${caught}`);
  } finally {
    cpp.resetReaderOptions();
  }
});

test("ReaderOptions: reset restores defaults so a fresh open succeeds", async () => {
  const cpp = await loadWasm();
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 99 } });
  cpp.setReaderOptions({ traversalLimitInWords: 1 });
  cpp.resetReaderOptions();
  const r = openDynamic(cpp, Outer, msg);
  assert.equal(r.get("inner").x, 99);
});

test("ReaderOptions: undefined fields keep their existing values", async () => {
  const cpp = await loadWasm();
  // Tighten traversal then issue setReaderOptions with only nesting set;
  // traversal should still be in effect (the C++ side leaves untouched
  // fields alone).
  cpp.setReaderOptions({ traversalLimitInWords: 1 });
  cpp.setReaderOptions({ nestingLimit: 100 });
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 1 } });
  let caught = null;
  try {
    const r = openDynamic(cpp, Outer, msg);
    r.get("inner")?.x;
  } catch (err) { caught = err; }
  assert.ok(caught && isLimitViolation(caught), `expected limit violation, got: ${caught}`);
  cpp.resetReaderOptions();
});
