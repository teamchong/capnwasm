// Headless Chromium loads dist/codegen.mjs + dist/inlined.mjs and runs an
// end-to-end codegen demo. Locks in the "works in any browser" claim.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".wasm": "application/wasm",
  ".css":  "text/css",
  ".json": "application/json",
};

test("browser codegen: wasm compiler + runtime work end-to-end in Chromium", { timeout: 120_000 }, async () => {
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/bench/codegen.html";
    const filepath = join(ROOT, normalize(url));
    if (!filepath.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
    try {
      const buf = await readFile(filepath);
      res.writeHead(200, {
        "content-type": MIME[extname(filepath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(buf);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    page.on("pageerror", err => console.error("[browser pageerror]", err.message));
    page.on("requestfailed", req => console.error("[browser requestfailed]", req.url(), req.failure()?.errorText));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => typeof window.__codegenDemoResult === "object" && window.__codegenDemoResult !== null, null, { timeout: 60_000 });
    const result = await page.evaluate(() => window.__codegenDemoResult);
    assert.equal(result.error, undefined, `browser raised: ${result.error}`);
    assert.equal(result.id, 42);
    assert.equal(result.name, "Alice");
    assert.equal(result.active, true);
    assert.ok(Array.isArray(result.model), "compiled model should be an array");
    const userStruct = result.model.find(s => s.name === "User");
    assert.ok(userStruct, "User struct should be in the compiled model");
    assert.equal(userStruct.fields.length, 3);
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
});
