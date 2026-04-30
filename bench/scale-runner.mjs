// Runs the seconds-scale workload bench in headless Chromium.
// Same server pattern as bench/runner.mjs and bench/rpc-runner.mjs.

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
    if (url === "/") url = "/bench/scale.html";
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
      res.writeHead(200, { "content-type": mime, "cache-control": "no-store" });
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

const PORT = 18094;
const server = await startServer(PORT);
console.log(`[scale-bench] static server on http://127.0.0.1:${PORT}`);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (err) => console.error("[browser pageerror]", err.message));
page.on("requestfailed", (req) => console.error("[browser fail]", req.url(), req.failure()?.errorText));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => typeof window.__scaleResults === "string", null, { timeout: 120_000 });
console.log("\n" + (await page.evaluate(() => window.__scaleResults)));

await browser.close();
server.close();
