// Microbench for slice-fusion path: r.users.map(fn).slice(0, K).
//
// Compares:
//   1. Full draft N rows (no slice)
//   2. draft N rows then JS .slice(0, K)
//   3. draft with chained .slice(0, K) — should fuse via planner
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

const PROJECT_USER_ROW = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  active: u.active,
});
const PROJECT_FULL = (r) => r.users.map(PROJECT_USER_ROW);

function makeSliceFns(sliceStart, sliceEnd) {
  return {
    sliced: (r) => r.users.map(PROJECT_USER_ROW).slice(0, sliceEnd),
    offset: (r) => r.users.map(PROJECT_USER_ROW).slice(sliceStart, sliceEnd),
  };
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

console.log("\nSlice fusion bench — small / medium / large");
for (const n of [10, 100, 1000]) {
  const bytes = makeUsersBytes(n);
  const sliceEnd = Math.min(50, n);
  const sliceStart = Math.min(20, Math.max(0, sliceEnd - 1));
  const { sliced, offset } = makeSliceFns(sliceStart, sliceEnd);

  // Smoke check per size.
  const r1 = openUserList(cpp, bytes).draft(PROJECT_FULL);
  const r2 = openUserList(cpp, bytes).draft(sliced);
  const r3 = openUserList(cpp, bytes).draft(offset);
  if (r1.length !== n) throw new Error(`full len n=${n}`);
  if (r2.length !== sliceEnd) throw new Error(`slice len n=${n}: ${r2.length}`);
  if (sliceEnd > 0 && r2[0].id !== 1) throw new Error(`slice first id n=${n}`);
  if (sliceEnd > 0 && r2[sliceEnd - 1].id !== sliceEnd) throw new Error(`slice last id n=${n}`);
  if (r3.length !== sliceEnd - sliceStart) throw new Error(`offset len n=${n}: ${r3.length}`);
  if (r3.length > 0 && r3[0].id !== sliceStart + 1) throw new Error(`offset first id n=${n}: ${r3[0].id}`);

  console.log(`\nN=${n} (${bytes.byteLength} wire bytes), slice=[0..${sliceEnd}], offset=[${sliceStart}..${sliceEnd}]`);
  bench(`draft full ${n} rows`, () => openUserList(cpp, bytes).draft(PROJECT_FULL).length);
  bench(`draft full + JS .slice(0, ${sliceEnd})`, () => openUserList(cpp, bytes).draft(PROJECT_FULL).slice(0, sliceEnd).length);
  bench(`draft with chained .slice(0, ${sliceEnd}) [fused]`, () => openUserList(cpp, bytes).draft(sliced).length);
  bench(`draft with .slice(${sliceStart}, ${sliceEnd}) [fused]`, () => openUserList(cpp, bytes).draft(offset).length);
}
if (sink == null) console.log("sink", sink);
