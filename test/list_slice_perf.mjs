// Microbench for slice-fusion path: r.users.map(fn).slice(0, K).
//
// Compares:
//   1. Full draft 1000 rows (no slice)
//   2. draft 1000 rows then JS .slice(0, 50)
//   3. draft with chained .slice(0, 50) — should fuse via planner
//
// Verifies the slice tag is detected and the decoder honors the bounds.

import { load as loadWasm } from "../dist/inlined.mjs";
import { defineSchema, buildDynamic } from "../js/dynamic.mjs";
import { openUserList } from "../web/src/playground/users.capnp.gen.mjs";

const cpp = await loadWasm();

const USER_SCHEMA = defineSchema({
  id:         { kind: "uint64", offset: 0 },
  name:       { kind: "text",   slot: 0 },
  email:      { kind: "text",   slot: 1 },
  joinedAtMs: { kind: "uint64", offset: 8 },
  active:     { kind: "bool",   bitOffset: 128 },
  avatar:     { kind: "data",   slot: 2 },
}, { dataWords: 3, ptrWords: 3 });

const USER_LIST_SCHEMA = defineSchema({
  users: { kind: "listStruct", slot: 0, element: USER_SCHEMA },
}, { dataWords: 0, ptrWords: 1 });

function makeUsersBytes(n) {
  const users = new Array(n);
  for (let i = 0; i < n; i++) {
    users[i] = {
      id: BigInt(i + 1),
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      joinedAtMs: BigInt(1700000000000 + i * 86400000),
      active: (i & 1) === 0,
      avatar: new Uint8Array(0),
    };
  }
  const b = buildDynamic(cpp, USER_LIST_SCHEMA);
  b.set("users", users);
  return b.finalize();
}

const N = 1000;
const SLICE_END = 50;
const bytes = makeUsersBytes(N);

const PROJECT_USER_ROW = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  active: u.active,
});
const PROJECT_FULL = (r) => r.users.map(PROJECT_USER_ROW);
const PROJECT_SLICED = (r) => r.users.map(PROJECT_USER_ROW).slice(0, SLICE_END);
const PROJECT_SLICED_OFFSET = (r) => r.users.map(PROJECT_USER_ROW).slice(20, SLICE_END);

// Smoke check
{
  const r1 = openUserList(cpp, bytes).draft(PROJECT_FULL);
  const r2 = openUserList(cpp, bytes).draft(PROJECT_SLICED);
  const r3 = openUserList(cpp, bytes).draft(PROJECT_SLICED_OFFSET);
  if (r1.length !== N) throw new Error("full len");
  if (r2.length !== SLICE_END) throw new Error(`slice len=${r2.length}`);
  if (r2[0].id !== 1) throw new Error("slice first id");
  if (r2[SLICE_END - 1].id !== SLICE_END) throw new Error(`slice last id=${r2[SLICE_END-1].id}`);
  if (r3.length !== SLICE_END - 20) throw new Error(`offset slice len=${r3.length}`);
  if (r3[0].id !== 21) throw new Error(`offset slice first id=${r3[0].id}`);
  if (r3[r3.length - 1].id !== SLICE_END) throw new Error("offset last id");
}

let sink;
function bench(label, fn, ms = 700) {
  const warmEnd = performance.now() + 100;
  while (performance.now() < warmEnd) sink = fn();
  const samples = [];
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    const t0 = performance.now();
    sink = fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const med = samples[samples.length >> 1];
  const p10 = samples[Math.floor(samples.length * 0.1)];
  const p90 = samples[Math.floor(samples.length * 0.9)];
  console.log(
    `  ${label.padEnd(48)} median ${(med * 1000).toFixed(1).padStart(8)} us` +
    `   p10 ${(p10 * 1000).toFixed(1).padStart(8)} us` +
    `   p90 ${(p90 * 1000).toFixed(1).padStart(8)} us` +
    `   (${samples.length} samples)`,
  );
}

console.log(`\nSlice fusion bench — N=${N}, slice=[0..${SLICE_END}]`);
bench("draft full 1000 rows", () => openUserList(cpp, bytes).draft(PROJECT_FULL).length);
bench("draft full + JS .slice(0, 50)", () => openUserList(cpp, bytes).draft(PROJECT_FULL).slice(0, SLICE_END).length);
bench("draft with chained .slice(0, 50) [fused]", () => openUserList(cpp, bytes).draft(PROJECT_SLICED).length);
bench("draft with .slice(20, 50) [fused, start=20]", () => openUserList(cpp, bytes).draft(PROJECT_SLICED_OFFSET).length);
if (sink == null) console.log("sink", sink);
