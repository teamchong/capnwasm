// Capability-typed struct fields. The wasm capnp compiler resolves a
// `cap @1 :Greeter;` field to `Capability(Greeter)`. Codegen emits a
// reader getter that returns null (no cap table outside RPC) and a
// builder setter that accepts null only — anything else throws so silent
// corruption doesn't slip through. Lifting this to a real cap-proxy
// surface needs RPC cap-table wiring, which is future work.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import {
  buildVisit,
  openVisit,
  Greeter_INTERFACE,
} from "./_fixtures/capability_field.gen.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

test("capability field: codegen exposes the interface meta constant", () => {
  assert.equal(typeof Greeter_INTERFACE, "object");
  assert.ok(Greeter_INTERFACE.id, "Greeter_INTERFACE should carry an id");
});

test("capability field: builder accepts null and round-trips, reader yields null", () => {
  const b = buildVisit(cpp);
  b.who = "alice";
  b.cap = null;  // explicit null setter — should be a no-op
  const bytes = b.toBytes();
  const r = openVisit(cpp, bytes);
  assert.equal(r.who, "alice");
  assert.equal(r.cap, null);
  r.dispose();
});

test("capability field: builder rejects non-null cap writes outside RPC", () => {
  const b = buildVisit(cpp);
  assert.throws(
    () => { b.cap = { fakeProxy: true }; },
    /capability fields can only be set to null/i,
  );
});

test("capability field: open without setting cap yields null without error", () => {
  const b = buildVisit(cpp);
  b.who = "bob";
  const bytes = b.toBytes();
  const r = openVisit(cpp, bytes);
  assert.equal(r.cap, null);
  r.dispose();
});
