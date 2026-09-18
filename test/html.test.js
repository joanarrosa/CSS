import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHtmlReport } from "../src/report/html.js";

const sampleCssData = {
  url: "http://example.com",
  finalUrl: "http://example.com",
  title: "Example Site",
  httpStatus: 200,
  warnings: [],
  stats: { totalRules: 10, totalSources: 1, parseErrors: 0, ignored: 0 },
  categories: {},
  summary: {
    score: 80,
    grade: "B",
    total: 2,
    bySeverity: { high: 0, medium: 1, low: 1 },
    byType: { error: 0, improvement: 2 },
    counts: {},
    topPriorityFixes: [],
  },
  findings: {},
};

test("buildHtmlReport produces a full, self-contained HTML document", () => {
  const html = buildHtmlReport("css", sampleCssData);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  // No external references: no <link>, no external <script src>.
  assert.ok(!html.includes("<link"));
  assert.ok(!/<script\s+src=/.test(html));
});

test("buildHtmlReport embeds the report data and kind for app.js to pick up", () => {
  const html = buildHtmlReport("css", sampleCssData);
  assert.ok(html.includes("window.__CSS_AUDIT_EMBEDDED_REPORT__"));
  assert.ok(html.includes('"kind":"css"'));
  assert.ok(html.includes("Example Site"));
});

test("buildHtmlReport titles the page with the site name and report kind", () => {
  const html = buildHtmlReport("css", sampleCssData);
  assert.match(html, /<title>CSS Audit — Example Site \(CSS report\)<\/title>/);

  const a11yHtml = buildHtmlReport("a11y", { ...sampleCssData, title: "Example Site" });
  assert.match(a11yHtml, /\(Accessibility report\)<\/title>/);
});

test("buildHtmlReport escapes untrusted content to prevent script injection", () => {
  const malicious = { ...sampleCssData, title: '</script><script>alert(1)</script>' };
  const html = buildHtmlReport("css", malicious);
  // The literal "</script>" sequence must not appear inside our embedded JSON —
  // JSON.stringify + escaping "<" prevents the browser from ending our script early.
  const scriptStart = html.indexOf("__CSS_AUDIT_EMBEDDED_REPORT__");
  const scriptEnd = html.indexOf("</script>", scriptStart);
  const embeddedChunk = html.slice(scriptStart, scriptEnd);
  assert.ok(!embeddedChunk.includes("</script>"));
});

test("buildHtmlReport inlines the real stylesheet content", () => {
  const html = buildHtmlReport("css", sampleCssData);
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes(".summary-card"));
});
