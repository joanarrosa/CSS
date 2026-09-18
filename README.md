# css-audit

A CLI (and optional local web UI) that loads a page in headless Chromium,
collects every bit of CSS it actually uses (linked stylesheets, `<style>`
blocks, inline `style=""` attributes, and anything injected by JavaScript),
and reports:

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

Then open **http://localhost:4173**, paste a URL, and click "Analyze". It's
a single page — URL input, results grouped by category, same summary and
top-3-fixes as the CLI — served locally with no external dependencies beyond
what `npm install` already pulled in (the UI is plain HTML/CSS/JS in
`public/`, served by a small `node:http` server in `src/server.js` that
reuses the exact same analysis engine as the CLI).

The web UI adds a few things beyond what the terminal report shows:

- **Filters** — click a category chip (Duplicates, Overrides, …) and/or a
  type chip (Errors / Improvements) to narrow the results; both filters
  combine (e.g. "Overrides" + "Errors" shows only overrides that are
  objective bugs).
- **Error vs. Improvement** — every finding is badged as one or the other
  (see above), and the summary breaks out counts for each, so you can
  triage "what's actually broken" separately from "what's worth polishing."
- **Category tips** — each section opens with a one-line explanation of
  what that category checks and why it matters.
- **Clear location labels** — every finding shows *Where* (file/line),
  *Problem*, and *Fix* as distinct labeled lines.
- **Download JSON report** — one click saves the full report (same shape
  as `--json`) to a file.
- Your last-analyzed URL is remembered (browser `localStorage`) so you
  don't have to retype it.

Two more buttons sit above the results, independent of the main CSS audit:

- **Accessibility Guide — How to improve** — toggles a static panel
  summarizing the WCAG POUR principles (Perceivable, Operable,
  Understandable, Robust) and a practical checklist, with links to the
  [W3C WAI introduction](https://www.w3.org/WAI/fundamentals/accessibility-intro/)
  and [MDN's accessibility docs](https://developer.mozilla.org/en-US/docs/Web/Accessibility).
- **Full Accessibility Report** — runs a real WCAG 2.1 A/AA audit via
  [axe-core](https://github.com/dequelabs/axe-core) (the same engine behind
  Chrome DevTools' Lighthouse and countless other a11y tools) against the
  live rendered page — not just CSS contrast, but alt text, form labels,
  ARIA usage, heading structure, landmarks, and more. Results are grouped
  into **Violations** (need to fix, each with the specific offending
  elements and a fix suggestion), **Needs manual review** (axe can't be
  fully sure — needs a human check), and **Already passing** (what the
  page already gets right) — i.e. exactly "what you have vs. what you
  need," per rule, with a link to that rule's documentation.

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
