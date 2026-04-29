// Playwright-driven runner: starts a tiny static server, opens index.html in
// Chromium, waits for `window.__benchResults`, prints them, also reports
// gzipped sizes for both bundles.

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

  const wasmSize = await fileSize(resolve(ROOT, "zig-out", "capnwasm.opt.wasm"));
  const glueSize = await fileSize(resolve(ROOT, "js", "index.mjs"));
  const capnwebSize = await fileSize(resolve(CAPNWEB_DIST, "index.js"));

  const sizes = {
    capnwasm_wasm: wasmSize,
    capnwasm_glue: glueSize,
    capnwasm_total_raw: wasmSize.raw + glueSize.raw,
    capnwasm_total_gzip: gzipSync(
      Buffer.concat([await readFile(resolve(ROOT, "zig-out", "capnwasm.opt.wasm")), await readFile(resolve(ROOT, "js", "index.mjs"))]),
      { level: 9 },
    ).length,
    capnweb: capnwebSize,
  };

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

  const report = { sizes, ...browserResults };
  console.log(JSON.stringify(report, null, 2));

  // Pretty summary
  const sep = "─".repeat(72);
  console.log("\n" + sep);
  console.log("SIZE  (lower is better)");
  console.log(sep);
  console.log(`  capnwasm wasm:   raw=${sizes.capnwasm_wasm.raw.toString().padStart(7)} gzip=${sizes.capnwasm_wasm.gzip.toString().padStart(7)}`);
  console.log(`  capnwasm glue:   raw=${sizes.capnwasm_glue.raw.toString().padStart(7)} gzip=${sizes.capnwasm_glue.gzip.toString().padStart(7)}`);
  console.log(`  capnwasm total:  raw=${sizes.capnwasm_total_raw.toString().padStart(7)} gzip=${sizes.capnwasm_total_gzip.toString().padStart(7)}`);
  console.log(`  capnweb:         raw=${sizes.capnweb.raw.toString().padStart(7)} gzip=${sizes.capnweb.gzip.toString().padStart(7)}`);
  const sizeRatio = (sizes.capnwasm_total_gzip / sizes.capnweb.gzip).toFixed(2);
  console.log(`  capnwasm/capnweb gzip ratio: ${sizeRatio}x`);

  console.log("\n" + sep);
  console.log("PERF  (lower µs is better)");
  console.log(sep);
  if (browserResults.error) {
    console.log("BROWSER ERROR:", browserResults.error);
    if (browserResults.stack) console.log(browserResults.stack);
    return;
  }
  const head = ["fixture", "cw enc", " (tape)", " (wasm)", "cwb enc", "spd", "cw dec", "cwb dec", "spd", "cw B", "cwb B", "B-ratio"];
  console.log(head.map((c) => c.padStart(10)).join(""));
  for (const [name, p] of Object.entries(browserResults.perf ?? {})) {
    if (p.error) {
      console.log(`${name.padStart(10)} ERROR: ${p.error}`);
      continue;
    }
    const sizeRatio = (p.capnwasm_bytes / Math.max(1, p.capnweb_bytes)).toFixed(2);
    const row = [
      name,
      p.capnwasm_encode_us?.toFixed(2),
      p.capnwasm_writetape_us?.toFixed(2),
      p.capnwasm_wasmencode_us?.toFixed(2),
      p.capnweb_encode_us?.toFixed(2),
      p.encode_speedup?.toFixed(2) + "x",
      p.capnwasm_decode_us?.toFixed(2),
      p.capnweb_decode_us?.toFixed(2),
      p.decode_speedup?.toFixed(2) + "x",
      p.capnwasm_bytes,
      p.capnweb_bytes,
      sizeRatio + "x",
    ];
    console.log(row.map((c) => String(c ?? "-").padStart(10)).join(""));
  }

  console.log("\n" + sep);
  console.log("CORRECTNESS");
  console.log(sep);
  for (const [name, c] of Object.entries(browserResults.correctness)) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${name}${c.error ? ` (${c.error})` : ""}`);
  }

  // Headline summary.
  const okCount = Object.values(browserResults.correctness ?? {}).filter((c) => c.ok).length;
  const totalCount = Object.values(browserResults.correctness ?? {}).length;
  const sizeRatioFmt = (sizes.capnwasm_total_gzip / sizes.capnweb.gzip).toFixed(2);
  console.log("\n" + sep);
  console.log(`SUMMARY  conformance: ${okCount}/${totalCount} fixtures round-trip`);
  console.log(`         bundle size: ${sizeRatioFmt}x of capnweb (gzip)`);
  console.log(sep);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
