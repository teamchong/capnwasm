#!/usr/bin/env node
// Ensure Playwright's Chromium browser cache exists before browser tests.
// pnpm installs the `playwright` package, but not necessarily the browser
// binary cache. `pnpm test` includes browser tests, so make the hidden
// prerequisite explicit and self-healing.

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT_CLI = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));

try {
  const executablePath = chromium.executablePath();
  if (existsSync(executablePath)) process.exit(0);
} catch (err) {
  const msg = String(err?.message ?? err);
  if (!msg.includes("Executable doesn't exist")) throw err;
}

console.error("Playwright Chromium is not installed; installing it now...");
const result = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "install", "chromium"], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
