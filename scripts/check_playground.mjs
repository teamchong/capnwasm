#!/usr/bin/env node
// Smoke the live /playground UI in a real browser. This is intentionally
// end-to-end: the page must fetch fixtures, render the three protocol table,
// run the RPC bench, and display finished results.

import { chromium } from "playwright";

const url = process.env.PLAYGROUND_URL || "http://127.0.0.1:8787/playground";
const target = new URL(url);
target.searchParams.set("workload", process.env.PLAYGROUND_WORKLOAD || "small");
target.searchParams.set("count", process.env.PLAYGROUND_COUNT || "10");
target.searchParams.set("iters", process.env.PLAYGROUND_ITERS || "1");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
const errors = [];

page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console error: ${msg.text()}`);
});
page.on("pageerror", (err) => errors.push(`page error: ${err.message}`));

try {
  await page.goto(target.href, { waitUntil: "domcontentloaded" });

  // The page auto-runs shortly after DOMContentLoaded. Force the RPC selector
  // down to one iteration before that timer fires so CI stays quick while
  // still exercising the RPC UI path.
  await page.evaluate(() => {
    const rpcIters = document.getElementById("rpc-iters-selector");
    if (rpcIters) rpcIters.value = "1";
  });

  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent?.includes("done"),
    null,
    { timeout: 120_000 },
  );
  await page.waitForFunction(
    () => document.querySelector("#server-msg")?.textContent?.includes("bench complete"),
    null,
    { timeout: 180_000 },
  );
  await page.waitForFunction(
    () => document.querySelector("#general-status")?.textContent?.includes("general suite done"),
    null,
    { timeout: 180_000 },
  );

  const data = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || "";
    const idText = (id) => document.getElementById(id)?.textContent?.trim() || "";
    const cells = Object.fromEntries([
      "rest-total", "rest-bytes",
      "cwb-total", "cwb-bytes",
      "capnp-total", "capnp-bytes",
      "burst-capnp", "burst-cwb",
      "pipe-capnp", "pipe-cwb",
      "blob-capnp", "blob-cwb",
      "general-small-capnp", "general-small-json", "general-small-ratio", "general-small-bytes",
      "general-sparse-capnp", "general-sparse-json", "general-sparse-ratio", "general-sparse-bytes",
      "general-view-capnp", "general-view-json", "general-view-ratio", "general-view-bytes",
      "general-dynamic-capnp", "general-dynamic-json", "general-dynamic-ratio", "general-dynamic-bytes",
      "general-list-capnp", "general-list-json", "general-list-ratio", "general-list-bytes",
    ].map((id) => [id, idText(id)]));
    return {
      status: text("#status"),
      summary: text("#summary"),
      rpcStatus: text("#rpc-status"),
      rpcSummary: text("#rpc-summary"),
      generalStatus: text("#general-status"),
      generalSummary: text("#general-summary"),
      server: text("#server-msg"),
      cells,
    };
  });

  for (const [id, value] of Object.entries(data.cells)) {
    if (!value || value === "—" || value === "running…") {
      errors.push(`cell ${id} did not finish: ${JSON.stringify(value)}`);
    }
  }
  if (!data.summary.includes("wins this workload")) errors.push(`missing fetch summary: ${data.summary}`);
  if (!data.rpcSummary.includes("RPC workloads")) errors.push(`missing RPC summary: ${data.rpcSummary}`);
  if (!data.generalSummary.includes("General suite complete")) errors.push(`missing general summary: ${data.generalSummary}`);

  console.log(JSON.stringify(data, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
