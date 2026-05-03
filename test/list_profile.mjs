// Profile: where does the 1000-row draft projection actually spend time?
//   1. Reader open (bytes -> reader instance)
//   2. C++ list project call (cpp_any_list_project; populates row tape)
//   3. JS materialization loop (decode tape into row objects)
//
// Run:    node test/list_profile.mjs

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

const N = 1000;
const users = new Array(N);
for (let i = 0; i < N; i++) {
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
const bytes = b.finalize();
console.log(`bytes: ${bytes.byteLength}`);

// Build the request bytes manually so we can profile the C++ call alone.
const exp = cpp._exports;
const FIELDS = {
  id:    { kind: 4, off: 0,   type: "uint64" },
  name:  { kind: 0, off: 0,   type: "text"   },
  email: { kind: 0, off: 1,   type: "text"   },
  active:{ kind: 5, off: 128, type: "bool"   },
};
const NAMES = ["id", "name", "email", "active"];
const req = new Uint8Array(4 + NAMES.length * 5);
const reqDv = new DataView(req.buffer);
reqDv.setUint32(0, NAMES.length, true);
let p = 4;
for (const n of NAMES) {
  req[p] = FIELDS[n].kind; p += 1;
  reqDv.setUint32(p, FIELDS[n].off, true); p += 4;
}

function bench(label, fn, ms = 800) {
  const end = performance.now() + 100;
  while (performance.now() < end) fn();
  const samples = [];
  const start = performance.now();
  const deadline = start + ms;
  while (performance.now() < deadline) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const med = samples[samples.length >> 1];
  console.log(`  ${label.padEnd(46)} median ${(med * 1000).toFixed(1).padStart(8)} µs  (${samples.length} samples)`);
}

console.log("\nProfile breakdown — list-1000:");

bench("a) framing only: openUserList(cpp, bytes)", () => {
  const r = openUserList(cpp, bytes);
  return r._dataPtr;
});

bench("b) C++ list project ONLY (1 wasm call)", () => {
  const r = openUserList(cpp, bytes);
  cpp._u8.set(req, cpp._auxPtr);
  return exp.cpp_any_list_project(0, req.length);
});

// Full draft: same as render-bench, real allocation, real materialization.
const PROJECT = (u) => ({ id: u.id, name: u.name, email: u.email, active: u.active });
const PROJECT_LIST = (r) => r.users.map(PROJECT);
bench("c) full draft(users.map(...))", () => {
  const r = openUserList(cpp, bytes);
  return r.draft(PROJECT_LIST).length;
});

// Estimate "pure JS materialization" by subtracting (a) + (b) from (c).
// Rough but informative: if JS dominates, optimizing JS wins.
