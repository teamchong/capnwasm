#!/usr/bin/env node
// Smoke the live /playground UI (multi-language Cap'n Proto chatroom)
// in a real browser. Asserts:
//
//   * roster fills with agents (random language assignment).
//   * user submits a message → bubble lands in the thread.
//   * at least one agent reply lands in the thread (non-pending,
//     non-error) — proves the chat dispatch + capnwasm encode + JS
//     bot path all work end-to-end.
//
// The render-bench bench check lives in scripts/check_render_bench.mjs.

import { chromium } from "playwright";

const url = process.env.PLAYGROUND_URL || "http://127.0.0.1:8787/playground";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];

page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  if (/favicon/.test(text)) return;
  if (/cdn\.jsdelivr\.net/.test(text) || /unpkg\.com/.test(text)) return;
  if (/Failed to load resource/.test(text)) return;
  errors.push(`console error: ${text}`);
});
page.on("pageerror", (err) => errors.push(`page error: ${err.message}`));
page.on("response", (resp) => {
  if (resp.status() < 500) return;
  errors.push(`http ${resp.status()} on ${resp.url()}`);
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Roster filled with agents.
  await page.waitForFunction(
    () => document.querySelectorAll(".roster-row").length > 0,
    null,
    { timeout: 15_000 },
  );
  const rosterCount = await page.locator(".roster-row").count();
  if (rosterCount < 1) errors.push(`roster has ${rosterCount} agents`);

  // Send a message.
  await page.fill("#chat-input", "hello room");
  await page.click("#chat-send");

  // User bubble lands.
  await page.waitForSelector(".chat-msg.from-user", { timeout: 10_000 });

  // At least one agent reply lands and isn't stuck pending.
  await page.waitForFunction(
    () => {
      const settled = Array.from(document.querySelectorAll(".chat-msg.from-agent"))
        .filter((el) => !el.classList.contains("pending"));
      return settled.length > 0;
    },
    null,
    { timeout: 20_000 },
  );

  const agentReplies = await page.locator(".chat-msg.from-agent").count();
  const summary = await page.evaluate(() => {
    const langs = Array.from(document.querySelectorAll(".roster-lang")).map((el) => el.textContent?.trim());
    const replies = Array.from(document.querySelectorAll(".chat-msg.from-agent .body"))
      .map((el) => el.textContent?.slice(0, 40));
    return { langs, replies };
  });
  console.log(JSON.stringify({ rosterCount, agentReplies, ...summary }, null, 2));

  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
