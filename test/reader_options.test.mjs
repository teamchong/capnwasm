// ReaderOptions: tighten traversal / nesting limits to refuse oversize or
// deeply-nested messages. The C++ runtime applies the configured limits
// inside FlatArrayMessageReader so the limits enforce on wasm-side
// pointer dereferences, not just JS-side parsing.
//
// Limit violations land as wasm `unreachable` traps because the wasm
// build doesn't link a real C++ exception unwinder (LLVM 21's wasm
// backend can't lower cleanupret for object-typed throws — see
// cpp/eh_runtime.cpp for the writeup). The throw stubs use
// __builtin_trap so callers see a clean RuntimeError and there's no
// libc++abi stderr noise to silence anymore.

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

test("ReaderOptions: tight traversal limit traps on dereference", async () => {
  const cpp = await loadWasm();
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 42 } });
  cpp.setReaderOptions({ traversalLimitInWords: 1 });
  try {
    assert.throws(() => {
      const r = openDynamic(cpp, Outer, msg);
      // Force the lazy pointer dereference. Without forcing, the bound
      // check might not fire until a later access.
      r.get("inner")?.x;
    }, /unreachable|trap|RuntimeError|aborted|undefined/i);
  } finally {
    cpp.resetReaderOptions();
  }
});

test("ReaderOptions: tight nestingLimit traps when descending into a child struct", async () => {
  const cpp = await loadWasm();
  const msg = encodeDynamic(cpp, Outer, { inner: { x: 42 } });
  cpp.setReaderOptions({ nestingLimit: 1 });
  try {
    assert.throws(() => {
      const r = openDynamic(cpp, Outer, msg);
      r.get("inner");
    }, /unreachable|trap|RuntimeError|aborted|undefined/i);
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
  assert.throws(() => {
    const r = openDynamic(cpp, Outer, msg);
    r.get("inner")?.x;
  }, /unreachable|trap|RuntimeError|aborted|undefined/i);
  cpp.resetReaderOptions();
});
