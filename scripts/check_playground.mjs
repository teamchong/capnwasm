#!/usr/bin/env node
// Smoke the live /playground UI (Cloudflare-API-on-a-globe demo) in a
// real browser. The bench-style page that used to live here moved to
// /render-bench when /playground was redesigned; that page is checked
// by scripts/check_render_bench.mjs.
//
// Asserts:
//   * the endpoint index loads (≈ 2920 dots from the Cloudflare schema,
//     or a small set of sample endpoints when the gitignored fixture
//     is missing).
//   * the JS tab executes the live editor and writes a non-error
//     value to #bubble-preview.
//   * each language tab can be selected without throwing (we only
//     verify the JS tab actually executes — Python/Ruby cold-loads
//     are too slow for a CI gate; their dedicated smoke is
//     scripts/smoke-globe.mjs).

import { chromium } from "playwright";

const url = process.env.PLAYGROUND_URL || "http://127.0.0.1:8787/playground";

// Headless Chromium has the GPU disabled by default. The globe-renderer
// (three.js / globe.gl) needs a WebGL context, so swap to SwiftShader
// to give the test a software-rendered context. Without this the page
// errors out with "Failed to acquire WebGL context" before the
// inspector / editor finish loading.
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-webgl"],
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

  // Endpoint index loaded.
  await page.waitForFunction(
    () => document.querySelectorAll(".endpoint-row").length > 0,
    null,
    { timeout: 30_000 },
  );
  const rows = await page.locator(".endpoint-row").count();
  if (rows < 1) errors.push(`#endpoint-list rendered ${rows} rows`);

  // JS tab is the default; the editor runs `format(response)` on every
  // selection / keystroke and writes to #bubble-preview. A non-error
  // value means JS-runtime + endpoint-mock plumbing both work.
  await page.waitForFunction(
    () => {
      const t = document.querySelector("#bubble-preview")?.textContent ?? "";
      return t && t !== "—" && t !== "(empty)" && !t.toLowerCase().startsWith("error");
    },
    null,
    { timeout: 15_000 },
  );

  // Verify each language tab can be selected. Stops short of waiting
  // for the runtime to load (Ruby is ~10 MB cold) but does require the
  // tab switch to happen without throwing — runtime-{lang}.ts is
  // dynamically imported and a syntax error there would surface.
  for (const lang of ["python", "ruby", "go", "js"]) {
    await page.click(`.lang-tab[data-lang="${lang}"]`);
    await page.waitForFunction(
      (l) => document.querySelector(`.lang-tab[data-lang="${l}"]`)?.getAttribute("aria-selected") === "true",
      lang,
      { timeout: 5_000 },
    );
  }

  const summary = await page.evaluate(() => ({
    endpointCount: document.querySelector("#endpoint-count")?.textContent?.trim(),
    runtimeStatus: document.querySelector("#runtime-status")?.textContent?.trim(),
    bubble:        document.querySelector("#bubble-preview")?.textContent?.slice(0, 80),
    detailVerb:    document.querySelector("#detail-verb")?.textContent?.trim(),
    detailPath:    document.querySelector("#detail-path")?.textContent?.trim(),
  }));
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
