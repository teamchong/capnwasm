// Playwright-driven runner: starts a tiny static server, opens index.html in
// Chromium, waits for window.__benchResults, then prints a table.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CAPNWEB_DIST = resolve(ROOT, "..", "capnweb", "dist");

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
};

function startServer(port) {
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/bench/index.html";

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
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${url}`);
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

async function fileSize(p) {
  const buf = await readFile(p);
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
}

async function main() {
  const port = 18091;
  const server = await startServer(port);
  console.log(`[server] listening on http://127.0.0.1:${port}`);

  const cppSize = await fileSize(resolve(ROOT, "zig-out", "capnp_cpp.opt.wasm"));
  const capnwebSize = await fileSize(resolve(CAPNWEB_DIST, "index.js"));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[page ${msg.type()}]`, msg.text());
    }
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto(`http://127.0.0.1:${port}/bench/index.html`);
  await page.waitForFunction(() => window.__benchResults !== undefined, { timeout: 60_000 });
  const browserResults = await page.evaluate(() => window.__benchResults);

  await browser.close();
  server.close();

  const sep = "─".repeat(72);
  console.log("\n" + sep);
  console.log("SIZE  (single .wasm vs single .js, gzipped)");
  console.log(sep);
  console.log(`  capnp_cpp.opt.wasm:  raw=${cppSize.raw.toString().padStart(7)}  gzip=${cppSize.gzip.toString().padStart(7)}`);
  console.log(`  capnweb/index.js:    raw=${capnwebSize.raw.toString().padStart(7)}  gzip=${capnwebSize.gzip.toString().padStart(7)}`);
  console.log(`  cpp/capnweb gzip ratio: ${(cppSize.gzip / capnwebSize.gzip).toFixed(2)}x`);

  if (browserResults.error) {
    console.log("\nBROWSER ERROR:", browserResults.error);
    if (browserResults.stack) console.log(browserResults.stack);
    return;
  }

  console.log("\n" + sep);
  console.log("PERF  (lower µs is better)  cpp = real capnproto C++ via wasm,  cwb = capnweb (JSON)");
  console.log(sep);
  const head = ["fixture", "cpp enc", "cwb enc", "enc spd", "cpp dec", "cwb dec", "dec spd", "cpp B", "cwb B"];
  console.log(head.map((c) => c.padStart(10)).join(""));
  for (const [name, p] of Object.entries(browserResults.perf ?? {})) {
    if (p.error) {
      console.log(`${name.padStart(10)} ERROR: ${p.error}`);
      continue;
    }
    const fmt = (x) => Number.isFinite(x) ? x.toFixed(2) : "-";
    const row = [
      name,
      fmt(p.capnp_cpp_encode_us),
      fmt(p.capnweb_encode_us),
      fmt(p.encode_speedup) + "x",
      fmt(p.capnp_cpp_decode_us),
      fmt(p.capnweb_decode_us),
      fmt(p.decode_speedup) + "x",
      String(p.capnp_cpp_bytes),
      String(p.capnweb_bytes),
    ];
    console.log(row.map((c) => String(c).padStart(10)).join(""));
  }

  console.log("\n" + sep);
  console.log("CORRECTNESS");
  console.log(sep);
  for (const [name, c] of Object.entries(browserResults.correctness)) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${name}${c.error ? ` (${c.error})` : ""}`);
  }

  const okCount = Object.values(browserResults.correctness ?? {}).filter((c) => c.ok).length;
  const totalCount = Object.values(browserResults.correctness ?? {}).length;
  console.log("\n" + sep);
  console.log(`SUMMARY  conformance: ${okCount}/${totalCount} fixtures round-trip`);
  console.log(`         wasm size:   ${(cppSize.gzip / capnwebSize.gzip).toFixed(2)}x of capnweb (gzip)`);
  console.log(sep);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
