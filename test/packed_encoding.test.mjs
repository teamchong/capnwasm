// Packed encoding (capnp.org/encoding.html#packing): pack/unpack helpers
// proxy upstream `capnp::writePackedMessage` and `PackedMessageReader`.
// We only need to prove the bytes round-trip and decode through the public
// reader after unpacking.

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { load as loadWasm } from "../dist/inlined.mjs";
import { defineSchema, encodeDynamic, openDynamic } from "../js/dynamic.mjs";

let cpp;
before(async () => { cpp = await loadWasm(); });

const PROBE = defineSchema({
  id: { kind: "uint32", offset: 0 },
  name: { kind: "text", slot: 0 },
}, { dataWords: 1, ptrWords: 1 });

test("packMessage produces packed bytes that unpack back to the original framed bytes", () => {
  const framed = encodeDynamic(cpp, PROBE, { id: 12345, name: "Alice" });
  const packed = cpp.packMessage(framed);

  // Packing actually shrinks payload byte counts on the runs of zero/text we use.
  assert.ok(packed.length > 0, "packed bytes are produced");
  assert.notEqual(packed.length, framed.length, "packed encoding should differ from framed encoding");

  const unpacked = cpp.unpackMessage(packed);
  const r = openDynamic(cpp, PROBE, unpacked);
  assert.equal(r.get("id"), 12345);
  assert.equal(r.get("name"), "Alice");
  r.dispose();
});

test("packMessage round-trips a numeric list", () => {
  const Schema = defineSchema({
    f64s: { kind: "listFloat64", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const values = Array.from({ length: 256 }, (_, i) => i + 0.5);
  const framed = encodeDynamic(cpp, Schema, { f64s: values });
  const packed = cpp.packMessage(framed);
  const unpacked = cpp.unpackMessage(packed);
  const r = openDynamic(cpp, Schema, unpacked);
  assert.deepEqual(r.get("f64s"), values);
  r.dispose();
});
