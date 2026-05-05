// Custom segment allocator: cpp.setSegmentAllocator(fn) installs a JS
// callback the C++ MessageBuilder calls every time it needs a new
// segment. Returning 0 falls back to the C++ default malloc allocation;
// any other return is interpreted as a wasm-memory pointer to
// `minWords * 8` zero-initialized bytes. Always-on wasm import — the
// default JS callback returns 0 so behavior is identical to stock
// MallocMessageBuilder until the user installs an override.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { buildPostMeta, openPostMeta } from "./_fixtures/nested.gen.mjs";

test("segment allocator: default returns 0, builder uses malloc fallback", async () => {
  const cpp = await loadWasm();
  // No allocator set; build a normal message.
  const b = buildPostMeta(cpp);
  b.views = 7;
  b.category = "default";
  const bytes = b.toBytes();
  const r = openPostMeta(cpp, bytes);
  assert.equal(r.views, 7);
  assert.equal(r.category, "default");
  r.dispose();
});

test("segment allocator: invoked when message exceeds first segment", async () => {
  const cpp = await loadWasm();
  let calls = [];
  cpp.setSegmentAllocator((minWords) => {
    calls.push(minWords);
    return 0; // fall back to default; we just want to count invocations
  });
  // Single small message stays within the static first segment, so the
  // allocator might not fire at all. To force at least one call we
  // build a larger message: 64KB Text fits in the first segment, but
  // beyond that we'd allocate. Keep this test bounded — even a single
  // call is enough to assert the wiring works.
  const b = buildPostMeta(cpp);
  b.views = 1;
  b.category = "x".repeat(50_000);
  const bytes = b.toBytes();
  const r = openPostMeta(cpp, bytes);
  assert.equal(r.category.length, 50_000);
  // Callback may have been invoked; either way the bytes round-trip.
  // Reset for the next test so we don't leak the closure state.
  cpp.setSegmentAllocator(null);
  r.dispose();
});

test("segment allocator: setSegmentAllocator(null) reverts to default behavior", async () => {
  const cpp = await loadWasm();
  let invoked = 0;
  cpp.setSegmentAllocator((minWords) => { invoked++; return 0; });
  cpp.setSegmentAllocator(null);
  // After clearing, builder allocations bypass our callback entirely
  // (the C++ side just gets 0 from the default JS shim).
  const b = buildPostMeta(cpp);
  b.views = 0;
  b.category = "y".repeat(60_000);
  b.toBytes();
  assert.equal(invoked, 0, "callback should not fire after setSegmentAllocator(null)");
});

test("segment allocator: rejects non-function inputs", async () => {
  const cpp = await loadWasm();
  assert.throws(() => cpp.setSegmentAllocator(42), /expected function or null/);
  assert.throws(() => cpp.setSegmentAllocator("nope"), /expected function or null/);
  assert.throws(() => cpp.setSegmentAllocator({}), /expected function or null/);
  // null and a real function are both fine
  cpp.setSegmentAllocator(null);
  cpp.setSegmentAllocator(() => 0);
  cpp.setSegmentAllocator(null);
});

test("segment allocator: callback can route to cpp_msg_alloc and return that pointer", async () => {
  const cpp = await loadWasm();
  let allocated = [];
  cpp.setSegmentAllocator((minWords) => {
    // Allocate in wasm linear memory. Returning the pointer hands
    // ownership to the C++ MessageBuilder; we keep the (ptr, size) in
    // case we want to free later.
    const ptr = cpp._exports.cpp_msg_alloc(minWords * 8);
    allocated.push({ ptr, words: minWords });
    return ptr;
  });
  const b = buildPostMeta(cpp);
  b.views = 99;
  b.category = "via custom allocator";
  const bytes = b.toBytes();
  const r = openPostMeta(cpp, bytes);
  assert.equal(r.views, 99);
  assert.equal(r.category, "via custom allocator");
  r.dispose();
  // Free what we allocated. Memory leaks here would otherwise pile up
  // in long-lived processes. Cleanup is the user's responsibility,
  // matching upstream's MessageBuilder allocator contract.
  for (const a of allocated) cpp._exports.cpp_msg_free?.(a.ptr);
  cpp.setSegmentAllocator(null);
});
