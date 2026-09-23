# a11y-audit

A WCAG 2.1/2.2 AA accessibility scanner: automated [axe-core](https://github.com/dequelabs/axe-core)
scans (via `@axe-core/playwright`) plus manual/semi-automated checks axe-core
can't do on its own, across every page/route you give it, multiple viewport
sizes, and scripted user flows (login, add-to-cart, search...) — not just
static page loads. Outputs a scored HTML dashboard, JSON, and CSV.

## What it checks

**Automated (axe-core):** every WCAG 2.1 A/AA and 2.2 AA rule axe ships,
plus its best-practice rule set. AAA-level rules are also scanned but kept
separate and labeled "bonus" in the report — they're not part of the AA
conformance target.

**Manual/semi-automated (axe-core doesn't do these):**

- **Keyboard navigation** — every focusable element gets a visible focus
  indicator on `:focus` (2.4.7); repeatedly pressing Tab keeps moving focus
  instead of getting stuck (2.1.2, keyboard trap detection); any open
  `role="dialog"`/`aria-modal` element can be dismissed with Escape (2.1.2).
- **Heading hierarchy** — exactly one `<h1>`, no skipped levels (1.3.1, 2.4.6).
- **Component-level contrast** — axe checks default-state text color; this
  additionally checks interactive elements' **`:focus`** state specifically
  (1.4.3), since a color that's fine at rest but low-contrast when focused
  is invisible to a static scan.
- **Reflow at 200% zoom** — horizontal scrolling and clipped/overflowing
  text at 200% zoom (1.4.10, 1.4.4).
- **Live regions** — inventories every `aria-live`/`role="alert"`/`role="status"`
  element, flags `aria-live="off"` as a no-op, and routes the rest to the
  manual checklist (announcement quality can only be judged by actually
  listening with a screen reader — see "Limitations" below).

Every finding includes which WCAG 2.1/2.2 success criterion it violates, a
structural EN 301 549 §9.{SC} reference (EN 301 549 clause 9 adopts WCAG 2.1
AA by direct reference), severity (axe's own critical/serious/moderate/minor
scale), the actual HTML snippet, and a concrete fix — not generic advice.

## Cookie/consent banners

A banner sitting on top of the real page can pollute a scan two ways: axe and
the manual checks end up testing the banner's own markup instead of (or on
top of) the page underneath, and the banner can physically block interaction
(keyboard-trap and focus checks especially). Before scanning each page (and
after each flow), this tool tries to dismiss one, two ways:

1. **Known vendors, zero configuration.** A short list of common
   consent-management-platform selectors (OneTrust, Cookiebot, Didomi,
   TrustArc, Quantcast, Osano, Usercentrics, Cookie Information) is tried
   first — covers a large share of sites automatically.
2. **Custom banners, via `--dismiss-text`** (CLI) or the "Cookie banner
   button text" field (web UI). Give it the visible text of the banner's own
   accept button (e.g. `Accepteer`, `Accept all`) and it'll click any
   button/link matching that text. This is generic by design — the
   mechanism is built in, the text is per-site configuration, the same
   pattern `--flows` already uses for site-specific interactions. Nothing is
   hardcoded to any one site.

Best-effort only: if no banner exists, or nothing matches, the scan just
proceeds against the page as-is.

## Setup

```bash
cd a11y-audit
npm install
npm run build
```

`npm install` also downloads a matching Chromium build (Playwright's
postinstall step).

## Web UI (no command line needed)

Prefer clicking things over typing commands? Double-click **`Start a11y-audit.vbs`**
in this folder (Windows). It starts the server invisibly in the background —
no command prompt window at all — and automatically opens
**http://localhost:4174** in your browser once it's ready. From there: paste
a URL, pick which viewports to test, click **Analyze**, and watch the same
dashboard the HTML report uses fill in live, with Download JSON/CSV/HTML
buttons once it's done.

It doesn't just scan the one page you paste in — it looks for that site's
sitemap first (`/sitemap.xml`, a sitemap index, or whatever `robots.txt`
points at) and scans every page it lists, up to the **Max pages** field
(default 20, cap 50). No sitemap found? It crawls the site's own links
instead, starting from the page you entered, breadth-first, same-origin only
— up to the same **Max pages** cap. Neither finds anything beyond the one
page? It falls back to just that page.

Only want the exact page you paste in, with no sitemap lookup or crawling at
all? Check **"Only this page (no sitemap/crawl)"** above the URL field.

If the site shows a cookie/consent banner, common vendors are dismissed
automatically; for a custom banner, type its accept button's exact visible
text into the "Cookie banner button text" field (see "Cookie/consent
banners" below).

The server keeps running in the background after you close the tab, so
opening the page again later is instant — no need to double-click Start
again. To actually stop it, double-click **`Stop a11y-audit.vbs`**, or just
restart your PC.

If your machine blocks `.vbs` scripts (some workplace policies do), use
**`start-a11y-audit-visible.bat`** instead — it works the same way but shows
a normal command-prompt window that you leave open while using the tool
(closing it stops the server).

Either way, the first launch takes a few extra seconds while it compiles —
after that it starts fast.

## CLI usage

```bash
node dist/cli.js -u https://example.com
# or, during development: npm run cli -- -u https://example.com
```

### Scanning multiple pages

```bash
node dist/cli.js -u https://example.com/ -u https://example.com/pricing -u https://example.com/about
```

For more than a couple of pages, or to give them readable names, use a
`--config` file instead:

```json
{
  "targets": [
    { "name": "home", "url": "https://example.com/" },
    { "name": "pricing", "url": "https://example.com/pricing" }
  ]
}
```

```bash
node dist/cli.js --config targets.json
```

### Testing user flows (not just static pages)

`--url`/`--config` only cover pages you can reach by navigating directly.
Flows describe an *interaction* (log in, add to cart, open a modal) that has
to happen first — the resulting state is what actually gets scanned.
`src/scan/flows.ts` ships reusable factories; point `--flows` at a plain
`.js` file that configures and default-exports them:

```js
// my-flows.js
import { loginFlow, addToCartFlow } from "./a11y-audit/dist/scan/flows.js";

export default [
  loginFlow({
    loginPath: "/login",
    usernameSelector: "#username",
    passwordSelector: "#password",
    submitSelector: "#login-submit",
    username: "demo",
    password: "demo",
    waitForSelector: "#dashboard",
  }),
  addToCartFlow({
    productPath: "/products/widget",
    addToCartSelector: "#add-to-cart",
  }),
];
```

```bash
node dist/cli.js -u https://example.com --flows my-flows.js --base-url https://example.com
```

A flow's `run(page, baseUrl)` is a plain Playwright function — write your own
directly (matching the `Flow` type in `src/types.ts`) for anything the
factories don't cover; you're not limited to the four shipped ones.

### Scanning a whole site (sitemap)

```bash
node dist/cli.js -u https://example.com --sitemap --max-pages 30
```

`--sitemap` replaces that single `--url` with every page listed in the
site's sitemap (found via `robots.txt`'s `Sitemap:` directive, `/sitemap.xml`,
or `/sitemap_index.xml`, including sitemap-of-sitemaps index files), capped
at `--max-pages` (default 20). If no sitemap exists, it falls back to
crawling the site's own same-origin links breadth-first from that `--url`,
up to the same cap. Only works with exactly one `--url` and no `--config` —
it's meant to expand one page into "the whole site," not layer onto a list
you already built yourself. Off by default for the CLI (the web UI does
this automatically instead — see "Web UI" above).

Pass `--dismiss-text "Accepteer"` (or whatever your target site's cookie
banner button says) alongside it if the site shows a custom consent banner
that would otherwise get in the way of crawling or scanning every page —
see "Cookie/consent banners" above.

### Viewports

Desktop (1440×900), tablet (768×1024), and mobile (375×812) are all scanned
by default. Narrow it down with `--viewport`:

```bash
node dist/cli.js -u https://example.com --viewport desktop --viewport mobile
```

### CI mode

```bash
node dist/cli.js -u https://example.com --fail-on serious
```

Exits 1 if the result is worse than `<value>`:

- a **severity** (`critical`/`serious`/`moderate`/`minor`) — fails if any
  finding at or above that severity exists;
- a **number 0-100** — fails if the overall score is below it.

### All options

| Flag | Description |
| --- | --- |
| `-u, --url <url>` | Page to scan (repeatable) |
| `--config <file>` | JSON file with `{ targets, viewports? }` for more control than `--url` |
| `--flows <file>` | Path to a `.js` module default-exporting a `Flow[]` |
| `--viewport <name>` | `desktop`, `tablet`, or `mobile` (repeatable; default: all three) |
| `--base-url <url>` | Base URL flows resolve relative paths against (default: first target's origin) |
| `-o, --out <dir>` | Output directory (default: `./reports/<timestamp>/`) |
| `--fail-on <value>` | Exit 1 if worse than `<value>` — see "CI mode" |
| `--no-screenshots` | Skip evidence screenshots (faster) |
| `--sitemap` | With a single `--url`, scan every page the site's sitemap lists (or, if none exists, every page found by crawling same-origin links) instead of just that one |
| `--max-pages <n>` | Max pages to scan with `--sitemap` (default: 20) |
| `--dismiss-text <text>` | Visible text of a cookie/consent banner's accept button to click before each scan (common vendors are handled automatically) |
| `-v, --verbose` | Print scan progress |

## Output

Every run writes `report.html`, `report.json`, and `report.csv` to
`./reports/<timestamp>/` (or `--out <dir>`), plus an `evidence/` folder of
numbered, color-coded screenshots — one per page/viewport/flow state,
boxing the actual elements behind each finding.

- **`report.html`** — a single self-contained file (CSS/JS inlined) you can
  double-click or email: overall score, counts by severity, a WCAG-SC bar
  chart, a plain-language glossary decoding every WCAG success criterion
  that showed up (name, level, POUR principle, what it means), the manual
  verification checklist, and every finding — filterable by
  severity/WCAG criterion/POUR principle — each with its WCAG criterion,
  severity, affected page(s), the actual HTML snippet, a concrete fix, and
  its evidence screenshot.
- **`report.json`** — the full structured data, for CI or your own tooling.
- **`report.csv`** — one row per finding, priority-sorted, for triage in a
  spreadsheet.

Findings are ranked by **severity → estimated user impact → estimated dev
effort**, so quick, high-impact wins surface first within each severity band.

## Limitations

- **Chromium only.** Automated tools are inherently Chromium-biased.
  Every report's "Manual verification still required" section always
  includes a Safari + VoiceOver pass and a Firefox + NVDA pass — those
  aren't optional extras, they're things this tool structurally cannot do
  and a real audit needs them.
- **Live-region announcement quality** can only be judged by actually
  listening with a screen reader. This tool inventories every live region
  and flags the dead `aria-live="off"` case, but routes genuine "is this
  announcement actually meaningful" judgment to the manual checklist.
- **Keyboard-trap detection is heuristic** (repeated Tab presses landing on
  the same element) — it catches real traps but won't catch every subtle
  focus-management bug; a human tab-through of complex custom widgets is
  still worth doing.
- Results reflect a single page load per viewport/flow. A selector or
  component behind further interaction (a second click, a hover-triggered
  submenu) beyond what a flow scripts won't be scanned.

## Local test fixture

`test-fixtures/index.html` has one deliberately planted issue of each kind
this tool checks (missing alt text, low contrast, unlabeled input, skipped
heading level, no focus indicator, a modal that ignores Escape, a dead
`aria-live="off"` region, a live `aria-live="polite"` region) — useful for
sanity-checking changes:

```bash
cd test-fixtures && python3 -m http.server 8940 &
cd .. && node dist/cli.js -u http://localhost:8940/index.html --viewport desktop
```

There's also `test-fixtures/sitemap.xml` (listing `index.html` and
`page2.html`) to sanity-check `--sitemap`:

```bash
node dist/cli.js -u http://localhost:8940/index.html --sitemap --viewport desktop
```

`index.html` also has a fake custom cookie banner (accept button labeled
"Accepteer") to sanity-check `--dismiss-text`:

```bash
node dist/cli.js -u http://localhost:8940/index.html --dismiss-text "Accepteer" --viewport desktop
```

And `test-fixtures/crawl/` (three pages linking to each other, deliberately
with no `sitemap.xml` of its own) to sanity-check the crawl fallback — serve
it as its own origin so it doesn't inherit the sitemap above:

```bash
cd test-fixtures/crawl && python3 -m http.server 8941 &
cd ../.. && node dist/cli.js -u http://localhost:8941/index.html --sitemap --viewport desktop --verbose
```
