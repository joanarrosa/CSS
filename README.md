# css-audit

A CLI that loads a page in headless Chromium, collects every bit of CSS it
actually uses (linked stylesheets, `<style>` blocks, inline `style=""`
attributes, and anything injected by JavaScript), and reports:

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

## Setup

```bash
npm install
```

That's it — `npm install` pulls in `playwright` and `css-tree`, and
Playwright's postinstall step downloads a matching Chromium build
automatically.

## Usage

```bash
node bin/css-audit.js <url>
```

or, after `npm link` (or `npm install -g .`):

```bash
css-audit <url>
```

### Options

| Flag              | Description                                             |
| ----------------- | -------------------------------------------------------- |
| `--json`          | Print a machine-readable JSON report instead of text     |
| `--out <file>`    | Write the report to a file instead of stdout             |
| `--verbose`, `-v` | Print progress to stderr while it runs                   |
| `--help`, `-h`    | Show usage                                                |

### Example

```bash
node bin/css-audit.js https://example.com --verbose
```

Terminal output is grouped by category, with a summary (counts per category
+ top 3 priority fixes) at the top. Each finding includes the selector, the
source file/`<style>` block (and line number when available), what's wrong,
and a concrete suggested fix.

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
