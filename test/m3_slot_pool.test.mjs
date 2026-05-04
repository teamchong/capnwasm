// M3: Native multi-reader slot pool tests.
//
// Pre-M3, all "safe" capnwasm readers shared a single C++ any_reader
// cursor and JS rebinding kept them coherent. M3 promotes the cursor
// to a fixed pool of 32 dedicated slots; each safe reader (openFoo /
// openDynamic) acquires one. These tests exercise the surface that
// pre-M3 either could not express or could only handle through the
// generation+rebind dance:
//
//   1. Many concurrent readers (more than the slot pool size) work
//      correctly via fallback to the legacy managed-message + rebind
//      path. _acquireSlot returns null at exhaustion; the open path
//      fails over silently. No data corruption, no thrown error.
//   2. Deep nesting + List<Struct> reads stay coherent when an
//      element reader is interleaved with the parent root reader.
//      The slot's any_stack is reset to the root depth on the next
//      root read so pointer-section getters do not accidentally read
//      from the nested element.
//   3. A reader on slot N stays valid across decodes on slot M, as
//      long as the JS handle stays alive. _useSlot tracks the active
//      slot in JS so the steady state for a hot loop is one property
//      compare, no wasm boundary call.
//   4. Pool exhaustion is non-throwing -- _acquireSlot returns null
//      and the default open paths fall back to the managed-message
//      route. (The previous ReaderSlotExhaustedError class was
//      removed in M7 because no code threw it.)

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  defineSchema,
  buildDynamic,
  openDynamic,
} from "../js/dynamic.mjs";
import { openPost } from "./_fixtures/nested.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

// Helper: release every dynamic slot back to the pool. Used between
// tests that hold many readers alive so a later "pool exhaustion"
// test starts from a clean state. Slot 0 is the legacy slot and
// release is a no-op there. We don't need the original handle to
// release -- _releaseSlot is idempotent and can be driven by a
// minimal handle stub for cleanup.
function releaseAllSlots() {
  for (let i = 1; i < 32; i++) {
    cpp._releaseSlot({ slotIdx: i, ptr: 0 });
  }
}

// Hand-written schema mirroring nested.capnp so we can use buildDynamic
// to author messages including List<Struct> elements. The codegen-side
// PostBuilder doesn't yet write nested lists/structs in fromObject, so
// we go through the dynamic builder for the test fixtures.
const TAG = defineSchema({
  name:   { kind: "text",   slot: 0 },
  weight: { kind: "uint32", offset: 0 },
}, { dataWords: 1, ptrWords: 1 });

const POST = defineSchema({
  title:    { kind: "text",       slot: 0 },
  author:   { kind: "text",       slot: 1 },
  tags:     { kind: "listStruct", slot: 2, element: TAG },
}, { dataWords: 0, ptrWords: 5 });

function buildSample({ tagCount = 3, label = "sample" } = {}) {
  const b = buildDynamic(cpp, POST);
  b.set("title", `${label} with ${tagCount} tags`);
  b.set("author", "alice");
  const tags = [];
  for (let i = 0; i < tagCount; i++) {
    tags.push({ name: `tag${i}`, weight: i * 10 });
  }
  b.set("tags", tags);
  return b.finalize();
}

// ---- Slot acquisition + JS-tracked active slot -----------------------------

test("acquiring multiple readers gives each one a distinct slot index", () => {
  const bytes = buildSample({ tagCount: 2 });
  const readers = [];
  const seenSlots = new Set();
  for (let i = 0; i < 8; i++) {
    const r = openPost(cpp, bytes);
    readers.push(r);
    if (r._slotIdx) seenSlots.add(r._slotIdx);
  }
  assert.equal(seenSlots.size, 8, "expected 8 distinct slot indices");
  for (const r of readers) {
    assert.ok(r._slotIdx > 0, `slot index should be > 0 (slot 0 reserved)`);
    assert.ok(r._slotIdx < 32, `slot index should be < READER_SLOT_COUNT`);
  }
});

test("readers alive concurrently keep returning their own data", () => {
  const a = buildSample({ tagCount: 1, label: "A" });
  const b = buildSample({ tagCount: 5, label: "B" });
  const c = buildSample({ tagCount: 3, label: "C" });
  const ra = openPost(cpp, a);
  const rb = openPost(cpp, b);
  const rc = openPost(cpp, c);
  // Read all three in interleaved order; each should still reflect
  // its own message because each lives on its own slot.
  assert.equal(ra.title, "A with 1 tags");
  assert.equal(rb.title, "B with 5 tags");
  assert.equal(rc.title, "C with 3 tags");
  // And again in a different order.
  assert.equal(rc.title, "C with 3 tags");
  assert.equal(ra.title, "A with 1 tags");
  assert.equal(rb.title, "B with 5 tags");
});

// ---- Deep nesting: root <-> element interleave -----------------------------

test("element reader from List<Struct>: root reader still reads root after element read", () => {
  const bytes = buildSample({ tagCount: 3 });
  const post = openPost(cpp, bytes);
  // Read parent root: ok.
  assert.equal(post.title, "sample with 3 tags");
  // Get an element reader and read from it. C++ any_stack pushes a
  // depth-1 entry for the element. Pre-M3 fix this would leave the
  // stack pushed; subsequent post.title would read from the element.
  const tag = post.tags.at(1);
  assert.equal(tag.name, "tag1");
  assert.equal(tag.weight, 10);
  // Root reader must reset the slot's stack back to depth 0 before
  // its pointer-section getters re-read.
  assert.equal(post.title, "sample with 3 tags");
  assert.equal(post.author, "alice");
});

test("element reader survives interleaved root reader access", () => {
  const bytes = buildSample({ tagCount: 4 });
  const post = openPost(cpp, bytes);
  const tag2 = post.tags.at(2);
  assert.equal(tag2.name, "tag2");
  // Read from root: this resets stack to depth 0.
  assert.equal(post.title, "sample with 4 tags");
  // Element reader's _rebind closure walks parent root -> list -> elem
  // again. Should still report tag2's fields.
  assert.equal(tag2.name, "tag2");
  assert.equal(tag2.weight, 20);
});

test("alternating root and element reads stay coherent over many iterations", () => {
  const bytes = buildSample({ tagCount: 5 });
  const post = openPost(cpp, bytes);
  for (let i = 0; i < 50; i++) {
    const t = post.tags.at(i % 5);
    assert.equal(t.name, `tag${i % 5}`);
    assert.equal(post.title, "sample with 5 tags");
    assert.equal(t.weight, (i % 5) * 10);
  }
});

// ---- Cross-message interleave -----------------------------------------------

test("element reader survives another open on the same CapnCpp", () => {
  const a = buildSample({ tagCount: 3, label: "A" });
  const b = buildSample({ tagCount: 1, label: "B" });
  const postA = openPost(cpp, a);
  const tagA1 = postA.tags.at(1);
  assert.equal(tagA1.name, "tag1");
  // Open a different message; both root and element reader of postA
  // must still read postA's data after we read from postB.
  const postB = openPost(cpp, b);
  assert.equal(postB.title, "B with 1 tags");
  assert.equal(tagA1.name, "tag1", "element reader must survive another open");
  assert.equal(postA.title, "A with 3 tags", "root reader must survive another open");
});

test("openDynamic readers also get their own slot and survive interleaving", () => {
  const a = buildSample({ tagCount: 2, label: "A" });
  const b = buildSample({ tagCount: 7, label: "B" });
  const da = openDynamic(cpp, POST, a);
  const db = openDynamic(cpp, POST, b);
  assert.ok(da._slotIdx > 0, "dynamic reader should own a slot");
  assert.ok(db._slotIdx > 0 && db._slotIdx !== da._slotIdx, "different slot");
  assert.equal(da.get("title"), "A with 2 tags");
  assert.equal(db.get("title"), "B with 7 tags");
  assert.equal(da.get("title"), "A with 2 tags");
});

// ---- Pool exhaustion + fallback --------------------------------------------

test("opening more than the pool size still works (graceful fallback)", () => {
  const bytes = buildSample({ tagCount: 1 });
  const readers = [];
  // Pool has 31 dynamic slots (slot 0 reserved). Open 50 readers; the
  // first ~31 land on real slots, the rest fall back to managed-message
  // + rebind path. All should still read correctly.
  for (let i = 0; i < 50; i++) {
    readers.push(openPost(cpp, bytes));
  }
  // Sample several throughout the array.
  for (const i of [0, 5, 15, 30, 31, 32, 49]) {
    assert.equal(
      readers[i].title,
      "sample with 1 tags",
      `reader at index ${i} should read its message`,
    );
  }
});

test("_acquireSlot returns null at pool exhaustion", () => {
  // Force a clean slot pool first; earlier tests in this file may
  // still hold readers in their closure scope, and Node has no
  // deterministic GC trigger.
  releaseAllSlots();
  const bytes = buildSample({ tagCount: 1 });
  // Acquire until we get null. Don't call openPost which would
  // fall back; we want to see the raw exhaustion signal.
  const handles = [];
  let exhausted = false;
  for (let i = 0; i < 64; i++) {
    const acquired = cpp._acquireSlot(bytes);
    if (!acquired) { exhausted = true; break; }
    handles.push(acquired.handle);
  }
  assert.ok(exhausted, "expected pool to exhaust before 64 acquires");
  // Release a few and confirm the next acquire succeeds.
  for (let i = 0; i < 3; i++) cpp._releaseSlot(handles.pop());
  const after = cpp._acquireSlot(bytes);
  assert.ok(after, "should be able to acquire again after releasing some");
  cpp._releaseSlot(after.handle);
  // Clean up the rest.
  for (const h of handles) cpp._releaseSlot(h);
});

// ---- Direct slot API surface -----------------------------------------------

test("_useSlot tracks the active slot in JS", () => {
  releaseAllSlots();
  const bytes = buildSample({ tagCount: 1 });
  const acquired = cpp._acquireSlot(bytes);
  assert.ok(acquired, "should acquire a slot");
  assert.ok(acquired.slotIdx > 0, "slot index should be > 0");
  assert.equal(cpp._activeSlot, acquired.slotIdx);
  cpp._useSlot(acquired.slotIdx);  // idempotent
  assert.equal(cpp._activeSlot, acquired.slotIdx);
  cpp._releaseSlot(acquired.handle);
});

test("_releaseSlot is idempotent and tolerates null/undefined", () => {
  releaseAllSlots();
  const bytes = buildSample({ tagCount: 1 });
  const acquired = cpp._acquireSlot(bytes);
  cpp._releaseSlot(acquired.handle);
  cpp._releaseSlot(acquired.handle);  // should not throw
  cpp._releaseSlot(null);              // should not throw
  cpp._releaseSlot(undefined);         // should not throw
});

test("_supportsReaderSlotPool reports true when the wasm exports the slot API", () => {
  assert.equal(cpp._supportsReaderSlotPool(), true);
});
