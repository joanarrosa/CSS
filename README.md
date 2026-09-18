# css-audit

A CLI, local web UI, and Windows desktop app that loads a page in headless
Chromium, collects every bit of CSS it actually uses (linked stylesheets,
`<style>` blocks, inline `style=""` attributes, and anything injected by
JavaScript), and reports:

- **Duplicates** — identical selectors defined more than once, and
  identical `property: value` pairs repeated across many selectors.
- **Overrides** — declarations that are set but never actually apply
  because a later, more specific, or `!important` rule wins the cascade.
  Shows which rule wins and which are dead.
- **Specificity** — `!important` overuse, ID selectors used for styling,
  overly specific selectors.
- **Unused CSS** — selectors that don't match any element rendered on the
  page.
- **Best Practices** — magic numbers instead of CSS variables, inconsistent
  units, vendor-prefix inconsistencies, deeply nested selectors, CSS syntax
  errors.
- **Accessibility** — WCAG AA color-contrast failures, and a best-effort
  check for status conveyed by color alone.
- **Performance** — oversized stylesheets, render-blocking stylesheets,
  excessive selector counts.

Every finding is tagged **Error** (objectively broken — dead code, invalid
CSS, a WCAG contrast failure) or **Improvement** (works today, but a
maintainability/style suggestion), and includes exactly where it came from
(source file/`<style>` block + line number, when available), what's wrong,
and a concrete fix.

## Setup

```bash
npm install
```

That's it — `npm install` pulls in `playwright`, `css-tree`, and
`axe-core`, and Playwright's postinstall step downloads a matching
Chromium build automatically.

## Usage

### CLI

```bash
node bin/css-audit.js <url>
```

or, after `npm link` (or `npm install -g .`):

```bash
css-audit <url>
```

#### Options

| Flag              | Description                                             |
| ----------------- | -------------------------------------------------------- |
| `--json`          | Print a machine-readable JSON report instead of text     |
| `--out <file>`    | Write the report to a file instead of stdout             |
| `--a11y-report`   | Run a full WCAG 2.1 A/AA accessibility audit (axe-core) instead of the CSS audit |
| `--verbose`, `-v` | Print progress to stderr while it runs                   |
| `--help`, `-h`    | Show usage                                                |

#### Example

```bash
node bin/css-audit.js https://example.com --verbose
```

Terminal output is grouped by category, with a summary (counts per category
+ top 3 priority fixes) at the top. Each finding includes the selector, the
source file/`<style>` block (and line number when available), what's wrong,
and a concrete suggested fix.

```bash
node bin/css-audit.js https://example.com --a11y-report
```

Runs a full WCAG 2.1 A/AA + best-practice audit via
[axe-core](https://github.com/dequelabs/axe-core) instead of the CSS audit,
printing three sections: **violations** (need to fix, with the specific
elements and axe's own fix guidance), **incomplete** (needs a human to
verify — e.g. something only checkable by eye), and **passes** (rules the
page already satisfies). Combine with `--json` for the machine-readable
shape.

### Web UI

Prefer a browser? Start the local server:

```bash
npm run serve
# or: node bin/css-audit-web.js [port]   (defaults to 4173)
```

Then open **http://localhost:4173**. There's one shared URL field at the
top, and two independent tabs below it — analyzing one never touches the
other, and switching tabs doesn't lose either report:

- **CSS Audit tab** — same 7-category audit as the CLI, with:
  - **Filters** — a labeled "Filter results" panel with a *Category* row
    (Duplicates, Overrides, …) and a *Type* row (Errors / Improvements);
    click a chip to narrow the results (they combine — "Overrides" +
    "Errors" shows only overrides that are objective bugs), click it again
    or pick "All" to reset. Active chips get a filled background and a
    checkmark so it's clear they're toggles, not just buttons.
  - **Error vs. Improvement** — every finding is badged as one or the other
    (Error = objectively broken; Improvement = works today, worth
    polishing), with counts broken out in the summary.
  - **Category tips**, **Where/Problem/Fix** labels, **Download JSON**,
    and a remembered last URL (`localStorage`) — as before.
- **Accessibility tab** — a real WCAG 2.1 A/AA audit via
  [axe-core](https://github.com/dequelabs/axe-core) (the engine behind
  Chrome DevTools' Lighthouse) against the live rendered page: alt text,
  form labels, ARIA usage, heading structure, landmarks, contrast, and
  more — not just CSS. One button, no explainer text first. Results are
  filterable the same way as the CSS tab:
  - **Show** — All / Need to fix / Needs review / Already passing.
  - **Impact** — All / Critical / Serious / Moderate / Minor; click an
    impact chip (e.g. "Serious") to filter violations/incomplete down to
    just that impact level and jump straight to them.
  - Each violation/incomplete item shows the specific offending element(s),
    axe's own fix guidance, the WCAG tags it maps to, and a link to that
    rule's documentation. "Already passing" lists what the page already
    gets right. Also has its own **Download JSON**.

### Desktop app (Windows)

For zero terminal/Node.js/npm involvement: a double-click desktop app,
built with Electron, that wraps the exact same server and UI as above.

**Using it:** run the `.exe` (it's portable — no installer, no admin
rights). A window opens showing the same CSS Audit / Accessibility tabs.
Close the window to quit; there's no separate server process to manage.
The very first launch downloads Chromium (~150 MB, one-time, needs
internet) with a progress screen; every launch after that is instant.
Since the app isn't code-signed, Windows SmartScreen will likely warn
"Windows protected your PC" on first run — click **More info → Run
anyway**. That warning is expected for an unsigned indie app, not a sign
anything is wrong.

**Building it yourself** (needs Node.js + `npm install` as above):

```bash
npm run app         # launch it directly with Electron, for development
npm run dist:win     # build release/CSS Audit <version>.exe (portable, x64)
```

`electron/main.js` is the whole desktop wrapper: it starts `src/server.js`
in-process, checks whether Playwright's Chromium is installed and
downloads it if not (via Electron's bundled Node, so no PowerShell/`npx`
execution-policy issues), then opens a `BrowserWindow` pointed at the
local server. Everything else — analysis, filters, both tabs — is the
identical code the web UI and CLI use.

## How it works

1. **Collect** (`src/collect.js`): Playwright launches headless Chromium,
   navigates to the URL, and waits for the network to go idle. It captures
   the raw response body of every stylesheet request (bypassing any CORS
   restrictions that would block `fetch()` from page JS, since this reads
   the network response directly), every `<style>` block's text, and every
   `style=""` attribute in the rendered DOM — so CSS injected by
   client-side JS is included too. Stylesheets from known ad/tracking
   domains are excluded.
2. **Parse** (`src/parseCss.js`): each CSS source is parsed with
   [`css-tree`](https://github.com/csstree/csstree) into a flat list of
   `{selector, declarations, specificity, source, line}` records, tracking
   `@media`/`@supports` nesting.
3. **Match against the live DOM** (`src/domMatch.js`): a single
   `page.evaluate()` call runs every selector against the real page,
   counting matches (for unused-CSS) and determining, for elements matched
   by multiple rules, which declaration wins the cascade (for overrides).
4. **Analyze** (`src/analyze/*.js`): one module per category turns the
   parsed rules + DOM-match results into findings.
5. **Report** (`src/report/*.js`): findings are grouped, summarized, and
   printed as colored terminal text or JSON.

## Limitations

- Results reflect a single page load, viewport, and DOM state. A selector
  that looks "unused" here may be used on other pages, other viewports, or
  behind interactive states (`:hover`, `:focus`, JS-toggled classes) —
  these are flagged as lower-severity, with a note to verify manually.
- Pages that require authentication will either fail with a clear error
  (401/403) or, if they redirect to a login page, print a warning that
  results may reflect the login page rather than the real content.
- Accessibility contrast checks approximate the effective background color
  by walking up the DOM for the first non-transparent `background-color`;
  it doesn't fully composite stacked translucent layers or background
  images.
- Specificity for `:not()`/`:is()`/`:has()` is approximated by counting
  everything inside them, which is slightly more generous than the spec in
  rare cases.

## Local test fixture

`test-fixtures/` contains a small HTML+CSS page with intentionally planted
issues (duplicate selectors, dead overridden declarations, ID selectors,
low-contrast text, unused selectors, etc.) — useful for sanity-checking
changes:

```bash
cd test-fixtures && python3 -m http.server 8934 &
node ../bin/css-audit.js http://localhost:8934/index.html
```
