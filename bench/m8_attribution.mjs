#!/usr/bin/env node
// M8: Bench attribution.
//
// Quantifies what the M2/M3/M4/M5/M5.5/M7 stack buys vs JSON.parse on
// equivalent shapes. Self-contained; no network, no external deps.
//
// Methodology:
//   - 200 ms warmup per cell.
//   - 5 trials per cell, time-budgeted to ~150 ms each.
//   - Report median ns/op.
//   - JSON baseline encodes/decodes the same logical content.
//   - Where capnwasm has both a "lazy reader" (codegen openFoo, returns
//     readers that stay live) and a "materialize" (DynamicReader.get
//     returns plain JS arrays/objects) path, we bench the LAZY path
//     because that's the architecture's selling point. Materializing
//     everything is what JSON.parse does; if you want to compare
//     materialization vs JSON, capnwasm has no architectural advantage
//     and the bench is ~tied.

import { load as loadWasm } from "../dist/inlined.mjs";
import { defineSchema, buildDynamic, openDynamic } from "../js/dynamic.mjs";
import { openPost, buildPost } from "../test/_fixtures/nested.gen.mjs";

const cpp = await loadWasm();

function timed(fn, { budgetMs = 150, warmMs = 200, trials = 5 } = {}) {
  let warmEnd = performance.now() + warmMs;
  while (performance.now() < warmEnd) fn();
  const results = [];
  for (let t = 0; t < trials; t++) {
    let iters = 0;
    const t0 = performance.now();
    const end = t0 + budgetMs;
    while (performance.now() < end) { fn(); iters++; }
    const elapsed = performance.now() - t0;
    results.push((elapsed * 1e6) / iters);
  }
  results.sort((a, b) => a - b);
  return {
    median: results[Math.floor(results.length / 2)],
    min: results[0],
    max: results[results.length - 1],
  };
}

function fmt(ns) {
  if (ns < 1000) return `${ns.toFixed(0)} ns`;
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`;
  return `${(ns / 1e6).toFixed(2)} ms`;
}

const rows = [];

// ---- Shape 1: small flat struct -----------------------------------------

{
  const SMALL = defineSchema({
    id:    { kind: "uint32", offset: 0 },
    score: { kind: "float64", offset: 8 },
    name:  { kind: "text",   slot: 0 },
    email: { kind: "text",   slot: 1 },
    flag:  { kind: "bool",   bitOffset: 32 },
  }, { dataWords: 2, ptrWords: 2 });
  const obj = { id: 42, score: 3.14159, name: "alice", email: "alice@example.com", flag: true };
  const b = buildDynamic(cpp, SMALL);
  for (const [k, v] of Object.entries(obj)) b.set(k, v);
  const capnBytes = b.finalize();
  const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));

  const capnwasm = timed(() => {
    const r = openDynamic(cpp, SMALL, capnBytes);
    const v = r.get("id") + r.get("score") + r.get("name").length + r.get("email").length + (r.get("flag") ? 1 : 0);
    r.dispose();
    return v;
  });
  const json = timed(() => {
    const o = JSON.parse(new TextDecoder().decode(jsonBytes));
    return o.id + o.score + o.name.length + o.email.length + (o.flag ? 1 : 0);
  });
  rows.push({
    shape: "small (5-field struct)",
    capnwasm: capnwasm.median, json: json.median,
    capnBytes: capnBytes.length, jsonBytes: jsonBytes.length,
  });
  console.log(`small:    capnwasm ${fmt(capnwasm.median)}/op (${capnBytes.length}B)  json ${fmt(json.median)}/op (${jsonBytes.length}B)  ratio ${(json.median / capnwasm.median).toFixed(2)}x`);
}


// ---- Shape 2: 1000-row List<Tag> via codegen reader (LAZY path) ---------

{
  // Author bytes via dynamic builder (codegen builder doesn't emit
  // listStruct setters yet); read via codegen reader (PostReader.tags)
  // which is the M5.5 pure-JS lazy List<Struct> path.
  const TAG = defineSchema({
    name:   { kind: "text",   slot: 0 },
    weight: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });
  const POST = defineSchema({
    title:  { kind: "text",       slot: 0 },
    author: { kind: "text",       slot: 1 },
    tags:   { kind: "listStruct", slot: 2, element: TAG },
  }, { dataWords: 0, ptrWords: 5 });
  const N = 1000;
  const tags = [];
  for (let i = 0; i < N; i++) tags.push({ name: `tag${i}`, weight: i * 7 });
  const b = buildDynamic(cpp, POST);
  b.set("title", "bench");
  b.set("author", "alice");
  b.set("tags", tags);
  const capnBytes = b.finalize();
  const jsonObj = { title: "bench", author: "alice", tags };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj));

  const capnwasm = timed(() => {
    const r = openPost(cpp, capnBytes);
    const list = r.draft((p) => p.tags.map((t) => ({ name: t.name, weight: t.weight })));
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      sum += t.name.length + t.weight;
    }
    r.dispose();
    return sum;
  });
  const json = timed(() => {
    const o = JSON.parse(new TextDecoder().decode(jsonBytes));
    let sum = 0;
    for (let i = 0; i < o.tags.length; i++) {
      sum += o.tags[i].name.length + o.tags[i].weight;
    }
    return sum;
  });
  rows.push({
    shape: "list (1000 rows, 2-field draft projection)",
    capnwasm: capnwasm.median, json: json.median,
    capnBytes: capnBytes.length, jsonBytes: jsonBytes.length,
  });
  console.log(`list:     capnwasm ${fmt(capnwasm.median)}/op (${capnBytes.length}B)  json ${fmt(json.median)}/op (${jsonBytes.length}B)  ratio ${(json.median / capnwasm.median).toFixed(2)}x`);
}

// ---- Shape 3: 256-field metadata struct, read 5 fields (sparse) ---------

{
  const fields = {};
  for (let i = 0; i < 256; i++) fields[`f${i}`] = { kind: "uint32", offset: i * 4 };
  const META = defineSchema(fields, { dataWords: 128, ptrWords: 0 });
  const obj = {};
  for (let i = 0; i < 256; i++) obj[`f${i}`] = (i * 31) >>> 0;
  const b = buildDynamic(cpp, META);
  for (const [k, v] of Object.entries(obj)) b.set(k, v);
  const capnBytes = b.finalize();
  const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));

  const picks = ["f5", "f50", "f100", "f150", "f250"];
  const capnwasm = timed(() => {
    const r = openDynamic(cpp, META, capnBytes);
    let sum = 0;
    for (const k of picks) sum += r.get(k);
    r.dispose();
    return sum;
  });
  const json = timed(() => {
    const o = JSON.parse(new TextDecoder().decode(jsonBytes));
    let sum = 0;
    for (const k of picks) sum += o[k];
    return sum;
  });
  rows.push({
    shape: "sparse (256-field meta, 5-field read)",
    capnwasm: capnwasm.median, json: json.median,
    capnBytes: capnBytes.length, jsonBytes: jsonBytes.length,
  });
  console.log(`sparse:   capnwasm ${fmt(capnwasm.median)}/op (${capnBytes.length}B)  json ${fmt(json.median)}/op (${jsonBytes.length}B)  ratio ${(json.median / capnwasm.median).toFixed(2)}x`);
}

// ---- Shape 4: dense - read every field of every row (draft path) --------

{
  // Same shape as shape 2 but reading all rows + all fields, the
  // bench shape that benefits most from M5.5 pure-JS List<Struct>.
  // Tag has only 2 fields (codegen schema); we read both.
  const TAG = defineSchema({
    name:   { kind: "text",   slot: 0 },
    weight: { kind: "uint32", offset: 0 },
  }, { dataWords: 1, ptrWords: 1 });
  const POST = defineSchema({
    title:  { kind: "text",       slot: 0 },
    author: { kind: "text",       slot: 1 },
    tags:   { kind: "listStruct", slot: 2, element: TAG },
  }, { dataWords: 0, ptrWords: 5 });
  const N = 500;
  const tags = [];
  for (let i = 0; i < N; i++) tags.push({ name: `tag${i}`, weight: i * 7 });
  const b = buildDynamic(cpp, POST);
  b.set("title", "bench");
  b.set("author", "alice");
  b.set("tags", tags);
  const capnBytes = b.finalize();
  const jsonObj = { title: "bench", author: "alice", tags };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj));

  const capnwasm = timed(() => {
    const r = openPost(cpp, capnBytes);
    const list = r.draft((p) => p.tags.map((t) => ({ name: t.name, weight: t.weight })));
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      sum += t.name.length + t.weight;
    }
    r.dispose();
    return sum;
  });
  const json = timed(() => {
    const o = JSON.parse(new TextDecoder().decode(jsonBytes));
    let sum = 0;
    for (let i = 0; i < o.tags.length; i++) {
      sum += o.tags[i].name.length + o.tags[i].weight;
    }
    return sum;
  });
  rows.push({
    shape: "dense (500-row, every-row 2-field read)",
    capnwasm: capnwasm.median, json: json.median,
    capnBytes: capnBytes.length, jsonBytes: jsonBytes.length,
  });
  console.log(`dense:    capnwasm ${fmt(capnwasm.median)}/op (${capnBytes.length}B)  json ${fmt(json.median)}/op (${jsonBytes.length}B)  ratio ${(json.median / capnwasm.median).toFixed(2)}x`);
}

// ---- Shape 5: 32 KB binary blob round-trip ------------------------------

{
  const BLOB = defineSchema({
    data: { kind: "data", slot: 0 },
  }, { dataWords: 0, ptrWords: 1 });
  const blob = new Uint8Array(32 * 1024);
  for (let i = 0; i < blob.length; i++) blob[i] = (i * 31) & 0xFF;
  const b = buildDynamic(cpp, BLOB);
  b.set("data", blob);
  const capnBytes = b.finalize();
  const jsonObj = { data: Buffer.from(blob).toString("base64") };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObj));

  const capnwasm = timed(() => {
    const r = openDynamic(cpp, BLOB, capnBytes);
    const out = r.get("data");
    const v = out[0] + out[out.length - 1];
    r.dispose();
    return v;
  });
  const json = timed(() => {
    const o = JSON.parse(new TextDecoder().decode(jsonBytes));
    const out = Buffer.from(o.data, "base64");
    return out[0] + out[out.length - 1];
  });
  rows.push({
    shape: "blob (32 KB binary)",
    capnwasm: capnwasm.median, json: json.median,
    capnBytes: capnBytes.length, jsonBytes: jsonBytes.length,
  });
  console.log(`blob:     capnwasm ${fmt(capnwasm.median)}/op (${capnBytes.length}B)  json ${fmt(json.median)}/op (${jsonBytes.length}B, +base64)  ratio ${(json.median / capnwasm.median).toFixed(2)}x`);
}

// ---- Final table --------------------------------------------------------

console.log("");
console.log("Shape                                    | capnwasm    | JSON        | ratio    | bytes capnwasm | bytes JSON");
console.log("---                                      | ---         | ---         | ---      | ---            | ---");
for (const r of rows) {
  console.log(
    `${r.shape.padEnd(40)} | ${fmt(r.capnwasm).padEnd(11)} | ${fmt(r.json).padEnd(11)} | ${(r.json / r.capnwasm).toFixed(2)}x   | ${String(r.capnBytes).padStart(14)} | ${String(r.jsonBytes).padStart(10)}`,
  );
}
console.log("");
console.log("Methodology: 200 ms warmup + 5 trials x 150 ms each, median ns/op.");
console.log(`Node ${process.version} / ${process.platform} / ${process.arch}`);
