#!/usr/bin/env node
// Smoke the live /playground UI (Cloudflare-API-on-a-globe demo) in a
// real browser. The bench-style page that used to live here moved to
// /render-bench when /playground was redesigned; that page is checked
// by scripts/check_render_bench.mjs.
//
// Asserts:
//   * the endpoint index loads (≈ 2920 dots from the Cloudflare schema).
//   * the SVG-only globe renders endpoint dots.
//   * search filters the endpoint rail.
//   * hover shows a clickable chat bubble; clicking opens the dialog.

import { chromium } from "playwright";

const url = process.env.PLAYGROUND_URL || "http://127.0.0.1:8787/playground";

const browser = await chromium.launch({
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];

page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  // Filter benign / out-of-our-control noise:
  //  - jsDelivr / unpkg flakes for the runtime CDNs (Python / Ruby
  //    are lazy-loaded; only fail if the user clicks the tab).
  //  - favicon 404s if the CI server doesn't ship one.
  //  - generic 'Failed to load resource' lines (Chromium logs these
  //    for any non-2xx; the network-layer listener below catches the
  //    real ones we should fail on).
  if (/favicon/.test(text)) return;
  if (/cdn\.jsdelivr\.net/.test(text) || /unpkg\.com/.test(text)) return;
  if (/Failed to load resource/.test(text)) return;
  errors.push(`console error: ${text}`);
});
page.on("response", (resp) => {
  // Hard-fail on 5xx for any same-origin asset; tolerate 404s on the
  // data files because the build now falls back to a built-in sample
  // when the cloudflare-openapi schema is unreachable.
  if (resp.status() < 500) return;
  errors.push(`http ${resp.status()} on ${resp.url()}`);
});
page.on("pageerror", (err) => errors.push(`page error: ${err.message}`));

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Endpoint index loaded and painted as SVG dots.
  await page.waitForFunction(
    () => document.querySelectorAll(".globe-dots circle").length > 0,
    null,
    { timeout: 30_000 },
  );
  const dots = await page.locator(".globe-dots circle").count();
  if (dots < 1) errors.push(`globe rendered ${dots} endpoint dots`);
  const countryAssetOk = await page.evaluate(async () => {
    const r = await fetch("/data/countries.json");
    return r.ok;
  });
  if (!countryAssetOk) errors.push("/data/countries.json did not load");
  const rows = await page.locator(".endpoint-row").count();
  if (rows !== dots) errors.push(`endpoint rail rendered ${rows} rows for ${dots} dots`);
  const globeTagline = await page.locator("#globe-tagline").count();
  if (globeTagline !== 0) errors.push("globe still has the tagline overlay");

  await page.fill("#endpoint-search", "GET /accounts");
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll(".endpoint-row").length;
      return rows > 0 && rows < document.querySelectorAll(".globe-dots circle").length;
    },
    null,
    { timeout: 5_000 },
  );
  await page.locator(".endpoint-row").first().hover();
  await page.waitForFunction(
    () => /click this bubble/i.test(document.querySelector(".globe-bubble.is-hover")?.textContent ?? ""),
    null,
    { timeout: 5_000 },
  );
  await page.locator(".globe-bubble.is-hover").click();
  await page.waitForSelector("#endpoint-dialog[open]", { timeout: 5_000 });
  await page.click("#run-endpoint");
  await page.waitForFunction(
    () => /Worker replied|Run failed/.test(document.querySelector("#run-status")?.textContent ?? ""),
    null,
    { timeout: 15_000 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.move(20, 20);
  await page.fill("#endpoint-search", "");
  await page.waitForFunction(
    () => document.querySelectorAll(".endpoint-row").length === document.querySelectorAll(".globe-dots circle").length,
    null,
    { timeout: 5_000 },
  );

  const summary = await page.evaluate(() => ({
    dots:       document.querySelectorAll(".globe-dots circle").length,
    rows:       document.querySelectorAll(".endpoint-row").length,
    status:     document.querySelector("#globe-status")?.textContent?.trim(),
    bubble:     document.querySelector(".globe-bubble")?.textContent?.slice(0, 120),
    dialogCode: document.querySelector("#language-code")?.textContent?.slice(0, 80),
    wireStats:  document.querySelector("#wire-stats")?.textContent?.trim(),
  }));
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
