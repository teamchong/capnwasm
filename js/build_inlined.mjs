#!/usr/bin/env node
// Generates dist/inlined.mjs by reading js/inlined.mjs and substituting
// __WASM_BASE64__ with the actual wasm bytes from zig-out/capnp_cpp.opt.wasm.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const wasm = await readFile(resolve(ROOT, "zig-out", "capnp_cpp.opt.wasm"));
const tmpl = await readFile(resolve(ROOT, "js", "inlined.mjs"), "utf8");

const out = tmpl.replace("__WASM_BASE64__", wasm.toString("base64"));

await mkdir(resolve(ROOT, "dist"), { recursive: true });
await writeFile(resolve(ROOT, "dist", "inlined.mjs"), out);

const { gzipSync } = await import("node:zlib");
const raw = Buffer.byteLength(out, "utf8");
const gz = gzipSync(out, { level: 9 }).length;
console.log(`dist/inlined.mjs:  raw=${raw}  gzip=${gz}`);
