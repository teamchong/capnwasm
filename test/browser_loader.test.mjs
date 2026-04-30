// js/browser.mjs loads the wasm as a separate asset (no base64 inflation)
// and prefers WebAssembly.instantiateStreaming when given a URL/Response.
// Verified here against an in-process HTTP server so the streaming-compile
// path actually fires (file:// + Node's fetch don't compose).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load, CapnCpp } from "../js/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const WASM_PATH = resolve(ROOT, "dist/capnp.slim.wasm");

test("browser loader: streams wasm over HTTP via instantiateStreaming", async () => {
  const wasm = await readFile(WASM_PATH);
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/wasm" });
    res.end(wasm);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const port = server.address().port;
    const cpp = await load(`http://127.0.0.1:${port}/capnp.slim.wasm`);
    assert.equal(cpp.exports.cpp_abi_version(), 1);
    assert.ok(cpp.exports.cpp_in_ptr() > 0);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test("browser loader: accepts a URL object", async () => {
  const wasm = await readFile(WASM_PATH);
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/wasm" });
    res.end(wasm);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const port = server.address().port;
    const cpp = await load(new URL(`http://127.0.0.1:${port}/capnp.slim.wasm`));
    assert.equal(cpp.exports.cpp_abi_version(), 1);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test("browser loader: accepts a fetched Response (manual streaming)", async () => {
  const wasm = await readFile(WASM_PATH);
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/wasm" });
    res.end(wasm);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const port = server.address().port;
    const resp = await fetch(`http://127.0.0.1:${port}/capnp.slim.wasm`);
    const cpp = await CapnCpp.load(resp);
    assert.equal(cpp.exports.cpp_abi_version(), 1);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test("browser loader: still accepts a Uint8Array for legacy callers", async () => {
  const bytes = new Uint8Array(await readFile(WASM_PATH));
  const cpp = await load(bytes);
  assert.equal(cpp.exports.cpp_abi_version(), 1);
});

test("loader: accepts a pre-compiled WebAssembly.Module (Cloudflare Workers shape)", async () => {
  // Cloudflare Workers' canonical pattern — `import wasm from "./x.wasm"`
  // gives you a WebAssembly.Module object directly. Workers reject sync
  // compile (`new Module(bytes)`) for security, so this code path is the
  // only way capnwasm can load wasm in a Worker. We simulate it here with
  // an explicit WebAssembly.compile().
  const bytes = await readFile(WASM_PATH);
  const mod = await WebAssembly.compile(bytes);
  assert.ok(mod instanceof WebAssembly.Module);
  const cpp = await CapnCpp.load(mod);
  assert.equal(cpp.exports.cpp_abi_version(), 1);
  assert.ok(cpp.exports.cpp_in_ptr() > 0);
});
