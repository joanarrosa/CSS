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

Terminal output leads with an overall **0-100 score and letter grade**
(A-F) — a quick "is this getting better or worse" number derived from a
weighted count of findings (errors weigh more than improvements; high
severity weighs more than low) — then a summary (counts per category +
top 3 priority fixes). The accessibility report (`--a11y-report`) gets
its own score the same way, weighted by violation impact. Each finding
includes the selector, the
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

#### Ignoring findings

Drop a `.css-auditrc.json` in the directory you run css-audit from (or
point `--config <file>` at one anywhere) to permanently hide findings
you've already triaged and decided not to fix — e.g. third-party CSS you
don't control, or a false-positive "unused" selector you know is used on
another page:

```json
{
  "ignore": [
    { "category": "unused" },
    { "selector": ".legacy-*" },
    { "source": "vendor.css" },
    { "ruleId": "region" }
  ]
}
```

Each entry in `ignore` hides a finding if **every** field on that entry
matches (`category`/`type`/`severity`/`ruleId` are exact matches,
`selector` supports a `*` wildcard, `message`/`source` are
case-insensitive substring matches). A finding is hidden if **any** entry
matches. `ruleId` is for the accessibility report (matches axe-core's
rule id, e.g. `"color-contrast"`, `"region"`); the other fields work for
both reports. Applies automatically to the web UI too (it reads the same
`.css-auditrc.json` from wherever you ran `npm run serve`) — no restart
needed after editing it. The report always says how many findings were
hidden, so filtering is never silent.

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

## Tests

```bash
npm test
```

Unit tests (Node's built-in `node:test`, no extra dependency) for the
parser, specificity/contrast math, the score curve, and every analyzer
that doesn't need a live browser — including `overrides.js` and
`unused.js`, exercised with hand-built DOM-match fixtures rather than a
real page. `collect.js`/`domMatch.js`/`accessibility.js`/`axeAudit.js`
aren't unit tested (they need a real Chromium + DOM), but are covered by
the manual fixture-site smoke test above.
