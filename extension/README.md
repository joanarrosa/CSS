# css-audit browser extension

A Chrome/Edge (Manifest V3) extension that runs the same analysis engine as
the CLI and web UI, directly against whatever page is open in the current
tab — no server, no URL to paste, no CORS problems.

## How it works

Unlike the CLI (which drives headless Chromium via Playwright), the
extension is *already inside the browser*, so it doesn't need Playwright at
all. `npm run build:extension` bundles the real analysis engine
(`src/parseCss.js`, every `src/analyze/*.js` analyzer, the accessibility
contrast checker, the auto-fix logic, the scoring) straight from the main
project's source into `extension/dist/engine.js` — one self-contained
script, via [esbuild](https://esbuild.github.io/). There's no separate,
duplicated "extension version" of the analysis logic to keep in sync; it's
the exact same code the CLI runs, just collected and executed differently:

1. `popup.js` injects `dist/engine.js` into the active tab
   (`chrome.scripting.executeScript`), which reads every `<style>` block,
   every `style=""` attribute, and the list of linked stylesheet URLs
   straight from the live DOM.
2. `popup.js` fetches each linked stylesheet's raw text itself, from the
   popup's own extension-page context — this is the one thing a content
   script genuinely can't do: a page's own CORS policy still applies to a
   content script's `fetch()`, but an extension page's `fetch()` is backed
   by the `host_permissions` grant instead, the same way Playwright's
   network interception bypasses CORS for the CLI.
3. `popup.js` injects the engine again, this time with the fetched CSS —
   it parses everything with css-tree, matches every selector against the
   live DOM, and runs every analyzer, right there in the page.
4. Results come back to the popup for rendering. Nothing is ever sent
   anywhere outside the browser.

## Install it (unpacked, for now)

The engine bundle (`dist/engine.js`) is already committed, so no build step
is required to try it:

1. `chrome://extensions` (or `edge://extensions`) → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Open any page, click the css-audit icon, click **Analyze this page**.

If you change anything under `src/` or `extension/src/engine-entry.js`,
rebuild the bundle and reload the extension:

```bash
npm run build:extension
```

## Limitations vs. the CLI

- No `@import` chain following (the CLI captures those via network
  interception; the extension only reads `<link rel="stylesheet">` and
  `<style>` blocks).
- No crawl mode, no `.css-auditrc.json` ignore rules, no CI/`--fail-on`
  gating — those are CLI-specific. The popup does have its own
  category/type filters, a JSON download, and (for the auto-fixable
  findings) a "download fixed CSS" button.
- A cross-origin stylesheet with no CORS headers is still fetchable (that's
  the whole point of `host_permissions`), but a stylesheet actually behind
  auth (cookies the fetch doesn't send, since it's issued with
  `credentials: "omit"` to avoid leaking session cookies to the CSS text
  the extension then displays/downloads) may fail to load — that failure
  shows up as a warning in the report rather than a silent gap.

## Publishing to the Chrome Web Store / Edge Add-ons

That step needs *your* developer account and can't be done from here.
Once you're happy with it:

1. `npm run build:extension` to make sure `dist/engine.js` is current.
2. Zip the `extension/` folder's contents (not the folder itself —
   `manifest.json` should be at the root of the zip).
3. Chrome Web Store: [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   → New item → upload the zip → fill in the listing → pay the one-time
   $5 developer registration fee if you haven't already → submit for review.
4. Edge Add-ons: [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
   → New extension → the same zip works as-is (Edge accepts Chrome MV3
   extensions largely unmodified) → submit for review.

The icons in `icons/` are placeholder solid squares in the app's accent
color — swap them for real artwork before submitting; store listings also
need at least one promotional screenshot.
