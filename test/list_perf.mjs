// Microbench: List(Struct) projection via draft() at the sizes the
// render-bench actually exercises (10 / 100 / 1000 rows, four fields:
// id u64, name text, email text, active bool). Mirrors the worker-side
// data shape and the render-bench projection callback identically so any
// improvement here should also show up in the browser bench.

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

// Hoisted projection callback so the draft plan cache hits on every iter.
const PROJECT_USER_ROW = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  active: u.active,
});
const PROJECT_USER_LIST = (r) => r.users.map(PROJECT_USER_ROW);

function timed(label, fn, budgetMs = 600) {
  // warm-up
  const warmEnd = performance.now() + 100;
  while (performance.now() < warmEnd) fn();
  let iters = 0;
  const samples = [];
  const start = performance.now();
  const deadline = start + budgetMs;
  while (performance.now() < deadline) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
    iters += 1;
  }
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1];
  const p10 = samples[Math.floor(samples.length * 0.1)];
  const p90 = samples[Math.floor(samples.length * 0.9)];
  console.log(
    `  ${label.padEnd(38)} ` +
    `median ${median.toFixed(3).padStart(7)} ms   ` +
    `p10 ${p10.toFixed(3).padStart(7)} ms   ` +
    `p90 ${p90.toFixed(3).padStart(7)} ms   ` +
    `(${iters} iters)`
  );
}

console.log("\nList(User) projection — 4 fields (id, name, email, active):");
for (const n of [10, 100, 1000]) {
  const bytes = makeUsersBytes(n);
  console.log(`\nN=${n} (${bytes.byteLength} wire bytes):`);
  timed(`draft(users.map(...))`, () => {
    const r = openUserList(cpp, bytes);
    const rows = r.draft(PROJECT_USER_LIST);
    return rows.length;
  });
}
