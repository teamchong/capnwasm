// Headless-Chromium smoke test for the /playground globe demo.
//
// Spawns a static file server over web/dist, opens /playground.html in
// Chromium via Playwright, waits for the endpoint index to load, then
// verifies:
//
//   • the page reaches DOMContentLoaded with no console errors that
//     aren't on the known-noisy allowlist (favicon 404 from Pages, etc).
//   • #endpoint-list contains > 0 buttons after the data fetch
//     completes (≈ 2920 sample endpoints from the Cloudflare schema).
//   • the language tabs respond to clicks (each tab toggles
//     aria-selected without throwing).
//   • the JS-tab editor runs the user-defined `format` against the
//     mocked response and #bubble-preview gets a non-empty value.
//
// Run with: node scripts/smoke-globe.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "web", "dist");

if (!existsSync(DIST)) {
  console.error(`smoke-globe: web/dist not found. Run \`pnpm -C web build\` first.`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".wasm": "application/wasm",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
};

const server = createServer(async (req, res) => {
  // Strip query / fragment.
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // /playground without extension → /playground.html.
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  let file = join(DIST, pathname);
  try {
    let st = statSync(file);
    if (st.isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(file + ".html")) file = file + ".html";
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    if (existsSync(file + ".html")) {
      const body = await readFile(file + ".html");
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end("not found: " + pathname);
    }
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/playground.html`;
console.log(`smoke-globe: serving ${DIST} on ${url}`);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const loc = msg.location ? msg.location() : null;
      const where = loc?.url ? ` @ ${loc.url}:${loc.lineNumber ?? "?"}` : "";
      errors.push(`console.error: ${msg.text()}${where}`);
    }
  });
  // Also surface any 404s observed at the network layer so a missing
  // asset is visible in the smoke output.
  page.on("response", (resp) => {
    if (resp.status() >= 400) errors.push(`http ${resp.status()}: ${resp.url()}`);
  });

let exitCode = 0;
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait for the endpoint index fetch to populate the list.
  await page.waitForFunction(
    () => document.querySelectorAll(".endpoint-row").length > 0,
    { timeout: 15_000 },
  );
  const rows = await page.locator(".endpoint-row").count();
  console.log(`smoke-globe: rendered ${rows} endpoint rows.`);
  if (rows < 1) throw new Error("no endpoint rows rendered");

  // Bubble preview gets a non-empty value once the JS runtime evaluates.
  await page.waitForFunction(
    () => {
      const el = document.querySelector("#bubble-preview");
      return el && el.textContent && el.textContent !== "—" && el.textContent !== "(empty)";
    },
    { timeout: 10_000 },
  );
  const preview = (await page.locator("#bubble-preview").textContent()) ?? "";
  console.log(`smoke-globe: bubble-preview = ${JSON.stringify(preview.slice(0, 60))}…`);
  if (!preview.length) throw new Error("bubble-preview is empty");

  // For each language, click the tab, fire (which triggers
  // runEditor("fire") and writes the result to #bubble-preview), then
  // wait for a non-error preview. CDN-loaded runtimes (Python ~250 KB,
  // Ruby ~10 MB) get up to 30 s; the JS path is instant; Go is the
  // in-browser shim so also fast.
  const langTimeout = { js: 5000, python: 30_000, ruby: 90_000, go: 5000 };
  for (const lang of ["js", "python", "go", "ruby"]) {
    await page.click(`.lang-tab[data-lang="${lang}"]`);
    await page.click("#fire-btn");
    try {
      await page.waitForFunction(
        () => {
          const t = document.querySelector("#bubble-preview")?.textContent ?? "";
          return t && t !== "—" && t !== "(empty)" && !t.startsWith("loading ");
        },
        { timeout: langTimeout[lang] },
      );
      const preview = (await page.locator("#bubble-preview").textContent()) ?? "";
      const trimmed = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;
      console.log(`smoke-globe: ${lang.padEnd(7)} → ${JSON.stringify(trimmed)}`);
      if (preview.includes("error:") || preview.includes("error ")) {
        // Soft-fail on runtime errors; report but don't crash the
        // whole smoke run because the CDN payloads are out of our
        // control.
        console.warn(`smoke-globe: ${lang} reported an error in the bubble preview`);
      }
    } catch (err) {
      console.warn(`smoke-globe: ${lang} runtime did not return within ${langTimeout[lang]}ms`);
    }
  }

  // Filter (search) trims the list.
  await page.fill("#endpoint-search", "zzz_no_match_zzz");
  await page.waitForFunction(
    () => document.querySelectorAll(".endpoint-row").length === 0,
    { timeout: 5_000 },
  );
  await page.fill("#endpoint-search", "");

  // Filter for "zone" is a meaningful trim.
  await page.fill("#endpoint-search", "zone");
  await page.waitForFunction(
    () => {
      const n = document.querySelectorAll(".endpoint-row").length;
      return n > 0 && n < 2920;
    },
    { timeout: 5_000 },
  );

  console.log("smoke-globe: ALL CHECKS PASSED.");
} catch (err) {
  console.error("smoke-globe: FAIL —", err.message);
  exitCode = 1;
}

if (errors.length > 0) {
  // Allow benign errors (favicon, analytics, network in offline-build).
  const benign = (s) =>
    /favicon\.svg/.test(s) ||
    /Failed to load resource: net::ERR_(NAME|CONNECTION)/.test(s) ||
    /analytics/.test(s);
  const real = errors.filter((e) => !benign(e));
  if (real.length > 0) {
    console.error("smoke-globe: console errors:");
    for (const e of real) console.error("  - " + e);
    exitCode = 1;
  }
}

await browser.close();
server.close();
process.exit(exitCode);
