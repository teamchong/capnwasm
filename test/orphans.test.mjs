// Orphan-adopt ergonomics: build a sub-tree in isolation, then adopt
// it into a parent struct field via the standard nested-struct setter.
//
// Upstream Cap'n Proto exposes orphans through `Orphanage::newOrphan<T>()`
// / `parent.adoptField(orphan)`. Allocations live in the same arena and
// adoption is zero-copy. Capnwasm's equivalent uses two messages and a
// deep-copy on adoption: build the orphan as a top-level message, hand
// the resulting Reader to the parent's setter, the codegen routes
// through cpp_any_builder_set_anypointer_from_slot. Same user-visible
// API contract, slightly different allocation behavior under the hood.
//
// Same path also accepts `{ _capnpFrame: bytes }` for adopting from
// already-serialized framed bytes (e.g. across a process boundary).

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  buildPostMeta,
  openPostMeta,
  buildPost,
  openPost,
} from "./_fixtures/nested.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

test("orphan: build sub-struct in isolation, adopt into parent via Reader", () => {
  // Build a PostMeta in its own message ("orphan").
  const orphan = buildPostMeta(cpp);
  orphan.views = 42;
  orphan.category = "news";
  // Open it back to a Reader so the typed setter on Post.meta sees a
  // capnwasm Reader instance and routes through the AnyPointer copy.
  const orphanReader = openPostMeta(cpp, orphan.toBytes());

  // Now build a Post and "adopt" the orphan into Post.meta
  const post = buildPost(cpp);
  post.title = "headline";
  post.author = "alice";
  post.meta = orphanReader;
  const bytes = post.toBytes();

  const r = openPost(cpp, bytes);
  assert.equal(r.title, "headline");
  assert.equal(r.author, "alice");
  const meta = r.meta;
  assert.equal(meta.views, 42);
  assert.equal(meta.category, "news");
  r.dispose();
  orphanReader.dispose();
});

test("orphan: adopt from a framed message via _capnpFrame", () => {
  const orphan = buildPostMeta(cpp);
  orphan.views = 7;
  orphan.category = "tech";
  const frame = orphan.toBytes();

  const post = buildPost(cpp);
  post.title = "from-frame";
  post.author = "bob";
  post.meta = { _capnpFrame: frame };

  const r = openPost(cpp, post.toBytes());
  assert.equal(r.title, "from-frame");
  assert.equal(r.meta.views, 7);
  assert.equal(r.meta.category, "tech");
  r.dispose();
});

test("orphan: same orphan adopted into multiple parents (deep copy each time)", () => {
  const orphan = buildPostMeta(cpp);
  orphan.views = 1;
  orphan.category = "common";
  const frame = orphan.toBytes();

  const reader = openPostMeta(cpp, frame);
  const p1 = buildPost(cpp);
  p1.title = "first";
  p1.author = "x";
  p1.meta = reader;
  const r1 = openPost(cpp, p1.toBytes());

  const p2 = buildPost(cpp);
  p2.title = "second";
  p2.author = "y";
  p2.meta = reader;
  const r2 = openPost(cpp, p2.toBytes());

  assert.equal(r1.meta.views, 1);
  assert.equal(r2.meta.views, 1);
  assert.equal(r1.meta.category, "common");
  assert.equal(r2.meta.category, "common");
  r1.dispose();
  r2.dispose();
  reader.dispose();
});
