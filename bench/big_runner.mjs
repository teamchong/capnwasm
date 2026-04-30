// Playwright runner for big_bench.mjs — opens a Chromium tab, waits for
// results, prints a stats table.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, normalize } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPNWEB_DIST = resolve(ROOT, "..", "capnweb", "dist");

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".wasm": "application/wasm",
};

function startServer(port) {
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/bench/big.html";
    let filepath;
    if (url.startsWith("/capnweb-vendor/")) {
      filepath = join(CAPNWEB_DIST, url.replace("/capnweb-vendor/", ""));
    } else {
      filepath = join(ROOT, normalize(url));
    }
    try {
      const buf = await readFile(filepath);
      res.writeHead(200, { "content-type": MIME[extname(filepath)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(buf);
    } catch {
      console.log(`[404] ${url}`);
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

function fmt(ns) {
  if (ns >= 1e6) return (ns / 1e6).toFixed(2) + " ms";
  if (ns >= 1e3) return (ns / 1e3).toFixed(2) + " µs";
  return ns.toFixed(0) + " ns";
}

function row(label, m) {
  const spread = (m.spread * 100).toFixed(1) + "%";
  return `  ${label.padEnd(20)} median=${fmt(m.medianNs).padStart(10)}  min=${fmt(m.minNs).padStart(10)}  spread=${spread.padStart(6)}`;
}

async function main() {
  const port = 18092;
  const server = await startServer(port);
  console.log(`[server] http://127.0.0.1:${port}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("console", (msg) => console.log(`[console.${msg.type()}]`, msg.text()));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bigBenchResults !== undefined, { timeout: 120_000, polling: 200 });
  const r = await page.evaluate(() => window.__bigBenchResults);
  await browser.close();
  server.close();

  if (r.error) { console.error(r.error); console.error(r.stack); process.exit(1); }

  const sep = "─".repeat(80);
  console.log("\n" + sep);
  console.log(`BIG BENCH: BigUser (256 named Text fields)`);
  console.log(`  cap'n proto wire: ${r.fixture.cppBytes} bytes`);
  console.log(`  capnweb JSON:     ${r.fixture.cwbBytes} bytes`);
  console.log(sep);
  console.log("READ 5 FIELDS  (sparse access — Cap'n Proto's design intent)");
  console.log(row("capnweb",    r.read5.capnweb));
  console.log(row("cpp raw",    r.read5.cpp_raw));
  console.log(row("cpp reader", r.read5.cpp_reader));
  const sp5 = r.read5.capnweb.medianNs / r.read5.cpp_reader.medianNs;
  console.log(`  cpp_reader speedup over capnweb: ${sp5.toFixed(2)}x`);
  console.log(sep);
  console.log("READ ALL 256 FIELDS  (full materialization — JSON.parse home turf)");
  console.log(row("capnweb", r.readAll.capnweb));
  console.log(row("cpp",     r.readAll.cpp));
  const spA = r.readAll.capnweb.medianNs / r.readAll.cpp.medianNs;
  console.log(`  cpp speedup over capnweb: ${spA.toFixed(2)}x`);
  console.log(sep);
}

main().catch((err) => { console.error(err); process.exit(1); });
