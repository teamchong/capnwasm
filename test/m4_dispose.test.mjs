// M4: Explicit lifetime API (dispose / using / withReader).
//
// Pre-M4, capnwasm relied on FinalizationRegistry to release wasm
// reader slots when JS readers became unreachable. Correct, but GC
// timing is non-deterministic and production code that wants tight
// control had no story other than the openFooUnsafe escape hatch.
//
// M4 adds:
//   - reader.dispose(): release the slot eagerly. Idempotent.
//     Subsequent field access throws DisposedReaderError.
//   - reader[Symbol.dispose](): same as dispose(); enables TC39
//     `using reader = openFoo(cpp, bytes);` on Node 22+, Chrome 134+,
//     Safari 18.4+.
//   - withReader(cpp, bytes, opener, fn): scoped helper that opens a
//     reader, runs fn(reader), and disposes on the way out, no matter
//     whether fn threw, returned, or returned a Promise.
//
// These tests use openPost from the M3 nested fixture.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  defineSchema,
  buildDynamic,
  openDynamic,
  withReader,
  DisposedDynamicReaderError,
} from "../js/dynamic.mjs";
import {
  openPost,
  PostReader,
  DisposedReaderError,
} from "./_fixtures/nested.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

const POST = defineSchema({
  title:    { kind: "text",       slot: 0 },
  author:   { kind: "text",       slot: 1 },
}, { dataWords: 0, ptrWords: 5 });

function buildPostBytes(label = "M4 sample") {
  const b = buildDynamic(cpp, POST);
  b.set("title", label);
  b.set("author", "alice");
  return b.finalize();
}

// ---- Codegen reader: dispose + Symbol.dispose -------------------------------

test("dispose() releases the slot back to the pool", () => {
  const bytes = buildPostBytes();
  const before = cpp._activeSlot;
  const r = openPost(cpp, bytes);
  const slotIdx = r._slotIdx;
  assert.ok(slotIdx > 0, "expected slot pool acquisition");
  assert.equal(r.title, "M4 sample");
  r.dispose();
  // After dispose the slot should be releasable again. We round-trip
  // by acquiring a fresh reader and verifying we can pick the same
  // slot index back up (eventually) when no other readers leak.
  // The release is observable: _slotHandle goes null and a re-open
  // finds the slot free.
  assert.equal(r._slotHandle, null, "slot handle should be cleared");
  assert.equal(r._disposed, true, "reader should be marked disposed");
});

test("dispose() is idempotent", () => {
  const bytes = buildPostBytes();
  const r = openPost(cpp, bytes);
  r.dispose();
  // Calling again must not throw and must not double-release the slot.
  r.dispose();
  r.dispose();
  assert.equal(r._disposed, true);
});

test("field access after dispose() throws DisposedReaderError", () => {
  const bytes = buildPostBytes();
  const r = openPost(cpp, bytes);
  r.dispose();
  assert.throws(
    () => r.title,
    (err) => err instanceof DisposedReaderError && /disposed/i.test(err.message),
  );
});

test("dispose() on root reader does NOT prevent peer readers from working", () => {
  // Opening another reader on the same cpp before disposing the first
  // should not interfere; dispose only releases that one's slot.
  const a = buildPostBytes("A");
  const b = buildPostBytes("B");
  const ra = openPost(cpp, a);
  const rb = openPost(cpp, b);
  assert.equal(ra.title, "A");
  ra.dispose();
  // rb is a different reader on a different slot; still readable.
  assert.equal(rb.title, "B");
  rb.dispose();
});

test("Symbol.dispose enables TC39 `using` semantics", () => {
  // Node 22+ has Symbol.dispose. We rely on that here since the test
  // runs on our test matrix Node version.
  if (typeof Symbol.dispose !== "symbol") {
    console.warn("Symbol.dispose unavailable; skipping `using` test on this runtime");
    return;
  }
  const bytes = buildPostBytes("using-scoped");
  let captured;
  let disposedDuringScope = false;
  {
    using r = openPost(cpp, bytes);
    captured = r.title;
    // r is in scope; not yet disposed.
    assert.equal(r._disposed, false);
    // We capture a closure over r so we can verify post-scope dispose.
    Object.defineProperty(globalThis, "__lastR", { value: r, configurable: true });
  }
  // After the block exits, r.dispose() ran via Symbol.dispose.
  disposedDuringScope = globalThis.__lastR._disposed;
  delete globalThis.__lastR;
  assert.equal(captured, "using-scoped");
  assert.equal(disposedDuringScope, true);
});

// ---- DynamicReader: dispose + Symbol.dispose --------------------------------

test("DynamicReader.dispose() releases the slot", () => {
  const bytes = buildPostBytes("dyn");
  const r = openDynamic(cpp, POST, bytes);
  assert.ok(r._slotIdx > 0);
  assert.equal(r.get("title"), "dyn");
  r.dispose();
  assert.equal(r._disposed, true);
  assert.equal(r._slotHandle, null);
});

test("DynamicReader field access after dispose() throws DisposedDynamicReaderError", () => {
  const bytes = buildPostBytes();
  const r = openDynamic(cpp, POST, bytes);
  r.dispose();
  assert.throws(
    () => r.get("title"),
    (err) => err instanceof DisposedDynamicReaderError,
  );
  assert.throws(
    () => r.pick(["title"]),
    DisposedDynamicReaderError,
  );
});

test("DynamicReader.dispose() is idempotent", () => {
  const bytes = buildPostBytes();
  const r = openDynamic(cpp, POST, bytes);
  r.dispose();
  r.dispose();  // should not throw
});

// ---- withReader scoped helper ----------------------------------------------

test("withReader runs the callback and disposes on normal return", () => {
  const bytes = buildPostBytes("scoped-ok");
  let outerR;
  const result = withReader(cpp, bytes, openPost, (r) => {
    outerR = r;
    return r.title;
  });
  assert.equal(result, "scoped-ok");
  assert.equal(outerR._disposed, true, "reader must be disposed after return");
});

test("withReader disposes even when the callback throws", () => {
  const bytes = buildPostBytes();
  let outerR;
  assert.throws(() => {
    withReader(cpp, bytes, openPost, (r) => {
      outerR = r;
      throw new Error("boom");
    });
  }, /boom/);
  assert.equal(outerR._disposed, true, "reader must be disposed even on throw");
});

test("withReader awaits async callback and disposes after the promise settles", async () => {
  const bytes = buildPostBytes("async-ok");
  let outerR;
  const result = await withReader(cpp, bytes, openPost, async (r) => {
    outerR = r;
    await new Promise((res) => setTimeout(res, 0));
    // Reader must still be live during the awaited body.
    assert.equal(r._disposed, false);
    return r.title;
  });
  assert.equal(result, "async-ok");
  assert.equal(outerR._disposed, true);
});

test("withReader disposes when async callback rejects", async () => {
  const bytes = buildPostBytes();
  let outerR;
  await assert.rejects(
    withReader(cpp, bytes, openPost, async (r) => {
      outerR = r;
      await new Promise((res) => setTimeout(res, 0));
      throw new Error("async boom");
    }),
    /async boom/,
  );
  assert.equal(outerR._disposed, true);
});

test("withReader works with openDynamic too (any opener function)", () => {
  const bytes = buildPostBytes("dyn-scoped");
  const result = withReader(cpp, bytes, (c, b) => openDynamic(c, POST, b), (r) => {
    return r.get("title");
  });
  assert.equal(result, "dyn-scoped");
});

// ---- Slot pool stays healthy under dispose pressure ------------------------

test("opening + disposing 100 readers in a loop reuses slots cleanly", () => {
  const bytes = buildPostBytes("loop");
  for (let i = 0; i < 100; i++) {
    const r = openPost(cpp, bytes);
    assert.equal(r.title, "loop");
    r.dispose();
  }
  // After 100 dispose cycles, a fresh open should still succeed.
  const r = openPost(cpp, bytes);
  assert.ok(r._slotIdx > 0, "slot pool should still hand out slots");
  assert.equal(r.title, "loop");
  r.dispose();
});

test("DisposedReaderError is exported and constructable", () => {
  const err = new DisposedReaderError("test");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "DisposedReaderError");
});

test("DisposedDynamicReaderError is exported and constructable", () => {
  const err = new DisposedDynamicReaderError("test");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "DisposedDynamicReaderError");
});
