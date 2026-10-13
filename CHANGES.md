# What changed

Your app already had code in `src/main.js` that tries to use a bundled
Chromium at `resources/playwright-browsers` when packaged — but nothing
was actually putting Chromium there. `npm install` downloads Playwright's
Chromium into your OS-wide cache folder by default, not into
`node_modules/playwright-core/.local-browsers`, which is the folder your
`package.json` build config copies into the app as an extra resource.
Result: the packaged dmg/exe shipped with an empty browser folder, so it
would try to download Chromium (or just fail) the first time someone ran
it — exactly what you don't want.

Fixes:

1. **`tools/install-browser.js`** — downloads Chromium into
   `node_modules/playwright-core/.local-browsers` (by setting
   `PLAYWRIGHT_BROWSERS_PATH=0` for that one command only).
2. **`package.json` scripts** — this now runs automatically after
   `npm install`, and again right before every `dist:*` script
   (`predist:win`, `predist:mac`, etc.), so the browser is always in
   place before electron-builder packages the app.
3. **`package.json` build config** — added a `zip` target alongside
   `dmg` (mac) and `nsis` (win), since you mentioned wanting either.

Nothing in `src/` needed to change — the packaged-vs-dev browser path
logic there was already correct.

# Build steps

```
npm install
npm run dist:mac        # Apple Silicon: dist/*.dmg and dist/*.zip
npm run dist:mac-intel   # Intel Mac
npm run dist:win         # Windows: dist/*.exe (installer) and dist/*.zip
```

`npm install` will take a while the first time — it's downloading
Chromium (~150–200MB) so it can be baked into the app. That's a one-time
cost on your build machine. The resulting dmg/zip/exe are fully
self-contained: whoever installs them does **not** need Node, npm,
Playwright, or a separate Chromium install. The only thing the app still
reaches out to the internet for at runtime is the actual Coway eTRUST
site it's checking — that's inherent to what the app does, not an extra
dependency.

# Verifying a build is self-contained

After `npm run dist:mac`, check that Chromium actually landed inside the
`.app`:

```
find dist/mac-arm64/Coway*.app/Contents/Resources/playwright-browsers -maxdepth 2
```

You should see a `chromium-<revision>` folder with real binaries inside
it, not an empty directory. If it's empty, `tools/install-browser.js`
didn't run or failed — re-run `npm install` and watch for its output.
