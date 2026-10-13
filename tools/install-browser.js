#!/usr/bin/env node
/**
 * Ensures Chromium is downloaded into node_modules/playwright-core/.local-browsers
 * (instead of the OS-wide Playwright cache) so electron-builder's "extraResources"
 * config can bundle it straight into the dmg/zip/exe.
 *
 * Without this, `npm install` puts the browser in a global cache folder that
 * never gets packaged, and the built app has to download Chromium itself the
 * first time it runs (or fails outright if there's no internet).
 *
 * Runs automatically after `npm install` and before every `dist:*` script.
 */
const { execSync } = require("child_process");

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" };

console.log("[install-browser] Downloading Chromium into node_modules/playwright-core/.local-browsers ...");
try {
  execSync("npx playwright install chromium", { stdio: "inherit", env });
  console.log("[install-browser] Done. Chromium is ready to be bundled into the build.");
} catch (err) {
  console.error("[install-browser] Failed to download Chromium. Check your internet connection and try again.");
  process.exit(1);
}
