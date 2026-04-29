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
  const indexSize = await fileSize(resolve(ROOT, "js", "index.mjs"));
  const tapeSize = await fileSize(resolve(ROOT, "js", "tape.mjs"));
  const capnwebSize = await fileSize(resolve(CAPNWEB_DIST, "index.js"));

  // For an apples-to-apples comparison we use the inlined single-file bundle
  // (one network fetch) and compare gzipped sizes — the actual cost on the wire.
  let bundleSize = null;
  try {
    bundleSize = await fileSize(resolve(ROOT, "dist", "capnwasm.bundle.mjs"));
  } catch (e) {
    bundleSize = { raw: 0, gzip: 0, note: "run: node js/bundle.mjs" };
  }

  const sizes = {
    capnwasm_wasm: wasmSize,
    capnwasm_index_js: indexSize,
    capnwasm_tape_js: tapeSize,
    capnwasm_two_file_total_raw: wasmSize.raw + indexSize.raw + tapeSize.raw,
    capnwasm_bundle_inlined: bundleSize,
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
  console.log("SIZE  (single-file bundle, gzipped — the wire-transfer cost)");
  console.log(sep);
  console.log(`  capnwasm wasm only:        raw=${sizes.capnwasm_wasm.raw.toString().padStart(7)} gzip=${sizes.capnwasm_wasm.gzip.toString().padStart(7)}`);
  console.log(`  capnwasm js (index+tape):  raw=${(sizes.capnwasm_index_js.raw + sizes.capnwasm_tape_js.raw).toString().padStart(7)} gzip=${(sizes.capnwasm_index_js.gzip + sizes.capnwasm_tape_js.gzip).toString().padStart(7)}`);
  if (sizes.capnwasm_bundle_inlined && sizes.capnwasm_bundle_inlined.raw) {
    console.log(`  capnwasm INLINED bundle:   raw=${sizes.capnwasm_bundle_inlined.raw.toString().padStart(7)} gzip=${sizes.capnwasm_bundle_inlined.gzip.toString().padStart(7)}  ← single network fetch`);
  }
  console.log(`  capnweb:                   raw=${sizes.capnweb.raw.toString().padStart(7)} gzip=${sizes.capnweb.gzip.toString().padStart(7)}`);
  if (sizes.capnwasm_bundle_inlined && sizes.capnwasm_bundle_inlined.gzip) {
    const sizeRatio = (sizes.capnwasm_bundle_inlined.gzip / sizes.capnweb.gzip).toFixed(2);
    console.log(`  inlined gzip ratio: ${sizeRatio}x of capnweb`);
  }

  console.log("\n" + sep);
  console.log("PERF  (lower µs is better)");
  console.log(sep);
  if (browserResults.error) {
    console.log("BROWSER ERROR:", browserResults.error);
    if (browserResults.stack) console.log(browserResults.stack);
    return;
  }
  const head = ["fixture", "cw enc", "cwb enc", "x", "cw dec", "(GC)", "cwb dec", "x", "GCx"];
  console.log(head.map((c) => c.padStart(9)).join(""));
  for (const [name, p] of Object.entries(browserResults.perf ?? {})) {
    if (p.error) {
      console.log(`${name.padStart(9)} ERROR: ${p.error}`);
      continue;
    }
    const gcSpd = (p.capnweb_decode_us / p.capnwasm_gcdecode_us);
    const row = [
      name,
      p.capnwasm_encode_us?.toFixed(2),
      p.capnweb_encode_us?.toFixed(2),
      p.encode_speedup?.toFixed(2) + "x",
      p.capnwasm_decode_us?.toFixed(2),
      Number.isFinite(p.capnwasm_gcdecode_us) ? p.capnwasm_gcdecode_us.toFixed(2) : "-",
      p.capnweb_decode_us?.toFixed(2),
      p.decode_speedup?.toFixed(2) + "x",
      Number.isFinite(gcSpd) ? gcSpd.toFixed(2) + "x" : "-",
    ];
    console.log(row.map((c) => String(c ?? "-").padStart(9)).join(""));
  }
  console.log("\nlegend: GC = WasmGC externref decode path; GCx = capnweb_dec / GC speedup");

  // Lazy access (decode + access K fields)
  const lazyRows = Object.entries(browserResults.perf ?? {}).filter(([, p]) => p.lazy3_supported);
  if (lazyRows.length > 0) {
    console.log("\n" + sep);
    console.log("LAZY ACCESS  (decode + read 3 fields, lower µs is better)");
    console.log("This is the access pattern Cap'n Proto's wire format is designed for.");
    console.log(sep);
    const head2 = ["fixture", "cw lazy3", "cwb (full+access)", "speedup"];
    console.log(head2.map((c) => c.padStart(18)).join(""));
    for (const [name, p] of lazyRows) {
      const speedup = (p.capnweb_lazy3_us / p.capnwasm_lazy3_us).toFixed(2);
      const row = [name, p.capnwasm_lazy3_us.toFixed(2), p.capnweb_lazy3_us.toFixed(2), speedup + "x"];
      console.log(row.map((c) => String(c).padStart(18)).join(""));
    }
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
  const sizeRatioFmt = sizes.capnwasm_bundle_inlined?.gzip
    ? (sizes.capnwasm_bundle_inlined.gzip / sizes.capnweb.gzip).toFixed(2)
    : "n/a";
  console.log("\n" + sep);
  console.log(`SUMMARY  conformance: ${okCount}/${totalCount} fixtures round-trip`);
  console.log(`         bundle size: ${sizeRatioFmt}x of capnweb (inlined gzip)`);
  console.log(sep);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
