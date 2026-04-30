// Spin up a static server, open bench/rpc.html in headless Chromium,
// wait for the in-browser RPC bench to populate window.__rpcBenchResults,
// and print them. Mirrors bench/runner.mjs's structure for the serializer
// bench, but runs the RPC layer end-to-end inside a real browser.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, normalize } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPNWEB_DIST = resolve(ROOT, "..", "capnweb", "dist");

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".wasm": "application/wasm",
  ".css":  "text/css",
  ".json": "application/json",
};

function startServer(port) {
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/bench/rpc.html";
    let filepath;
    if (url.startsWith("/capnweb-vendor/")) {
      filepath = join(CAPNWEB_DIST, url.replace("/capnweb-vendor/", ""));
    } else {
      filepath = join(ROOT, normalize(url));
    }
    if (!filepath.startsWith(ROOT) && !filepath.startsWith(CAPNWEB_DIST)) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    try {
      const buf = await readFile(filepath);
      const mime = MIME[extname(filepath)] ?? "application/octet-stream";
      res.writeHead(200, {
        "content-type": mime,
        "cache-control": "no-store",
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(404); res.end("not found: " + filepath);
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

const PORT = 18092;
const server = await startServer(PORT);
console.log(`[rpc-bench] static server on http://127.0.0.1:${PORT}`);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("console", (msg) => {
  console.log(`[browser ${msg.type()}]`, msg.text());
});
page.on("pageerror", (err) => console.error("[browser pageerror]", err.message, err.stack));
page.on("requestfailed", (req) => console.error("[browser 404/fail]", req.url(), req.failure()?.errorText));

await page.goto(`http://127.0.0.1:${PORT}/`);

// Wait for the bench to finish and write results.
await page.waitForFunction(() => typeof window.__rpcBenchResults === "string", null, { timeout: 60_000 });
const out = await page.evaluate(() => window.__rpcBenchResults);
console.log("\n" + out);

await browser.close();
server.close();
