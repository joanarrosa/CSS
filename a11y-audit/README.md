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
| `-v, --verbose` | Print scan progress |

## Output

Every run writes `report.html`, `report.json`, and `report.csv` to
`./reports/<timestamp>/` (or `--out <dir>`), plus an `evidence/` folder of
numbered, color-coded screenshots — one per page/viewport/flow state,
boxing the actual elements behind each finding.

- **`report.html`** — a single self-contained file (CSS/JS inlined) you can
  double-click or email: overall score, counts by severity, a WCAG-SC bar
  chart, the manual verification checklist, and every finding — filterable
  by severity/source/WCAG criterion/page — each with its WCAG criterion,
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
