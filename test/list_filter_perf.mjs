// Microbench for filter pushdown: r.users.filter(pred).map(fn)
//
// Compares:
//   1. Full draft 1000 rows (no filter)
//   2. draft full + JS .filter (no pushdown)
//   3. draft with chained .filter(pred).map(fn) — should fuse via planner
//   4. unsupported predicate (e.g. computed) falls back safely

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
const bytes = makeUsersBytes(N);

const PROJECT_USER_ROW = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  active: u.active,
});
const PROJECT_FULL = (r) => r.users.map(PROJECT_USER_ROW);
const PROJECT_FILTERED = (r) => r.users.filter((u) => u.active).map(PROJECT_USER_ROW);
const PROJECT_NEGATED = (r) => r.users.filter((u) => !u.active).map(PROJECT_USER_ROW);
// Unsupported predicate: ternary, falls back to safe path.
const PROJECT_UNSUPPORTED = (r) => r.users.filter((u) => u.email.length > 20).map(PROJECT_USER_ROW);

// Smoke checks
{
  const full = openUserList(cpp, bytes).draft(PROJECT_FULL);
  const filtered = openUserList(cpp, bytes).draft(PROJECT_FILTERED);
  const negated = openUserList(cpp, bytes).draft(PROJECT_NEGATED);
  const unsup = openUserList(cpp, bytes).draft(PROJECT_UNSUPPORTED);
  if (full.length !== N) throw new Error("full");
  if (filtered.length !== N / 2) throw new Error(`filtered=${filtered.length}`);
  if (filtered.some((r) => !r.active)) throw new Error("filtered has inactive");
  if (negated.length !== N / 2) throw new Error(`negated=${negated.length}`);
  if (negated.some((r) => r.active)) throw new Error("negated has active");
  // Unsupported should still produce correct results via fallback.
  // 'user1@example.com' length is 17, 'user10@example.com' is 18, ...
  // user100..999 has 18-19 chars, user1000 has 20 chars. Plus length>20 means
  // length must be > 20 — only those with id >= 10000 qualify. With N=1000
  // none qualify, so unsup.length should be 0.
  // Actually let me check: 'user${i+1}@example.com' for i=0..999 -> 'user1@..' (17) up to 'user1000@..' (20). length>20 false for all.
  if (unsup.length !== 0) throw new Error(`unsupported produced len=${unsup.length}`);
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

console.log(`\nFilter pushdown bench — N=${N}, predicate matches 50%`);
bench("draft full 1000 rows (no filter)", () => openUserList(cpp, bytes).draft(PROJECT_FULL).length);
bench("draft full + JS filter (no pushdown)", () => openUserList(cpp, bytes).draft(PROJECT_FULL).filter((r) => r.active).length);
bench("draft .filter(u => u.active).map(...) [fused]", () => openUserList(cpp, bytes).draft(PROJECT_FILTERED).length);
bench("draft .filter(u => !u.active).map(...) [fused negated]", () => openUserList(cpp, bytes).draft(PROJECT_NEGATED).length);
bench("draft unsupported predicate [safe fallback]", () => openUserList(cpp, bytes).draft(PROJECT_UNSUPPORTED).length);
if (sink == null) console.log("sink", sink);
