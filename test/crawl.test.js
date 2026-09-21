import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFindings } from "../src/crawl.js";
import { makeFinding } from "../src/utils/finding.js";

function page(url, findings, selectorMatches = []) {
  return { url, findings, selectorMatches };
}

test("mergeFindings drops an 'unused' finding if the selector matched on another crawled page", () => {
  const unusedFinding = makeFinding({
    category: "unused",
    severity: "medium",
    type: "improvement",
    selector: ".nav-link",
    source: "styles.css",
    message: "unused on page A",
  });
  const pages = [
    page("http://x/a", [unusedFinding], [{ source: "styles.css", selector: ".nav-link", matched: false }]),
    page("http://x/b", [], [{ source: "styles.css", selector: ".nav-link", matched: true }]),
  ];
  const merged = mergeFindings(pages);
  assert.equal(merged.filter((f) => f.category === "unused").length, 0);
});

test("mergeFindings keeps an 'unused' finding when the selector never matched on any crawled page", () => {
  const unusedFinding = makeFinding({
    category: "unused",
    severity: "medium",
    type: "improvement",
    selector: ".dead-class",
    source: "styles.css",
    message: "unused everywhere",
  });
  const pages = [
    page("http://x/a", [unusedFinding], [{ source: "styles.css", selector: ".dead-class", matched: false }]),
    page("http://x/b", [unusedFinding], [{ source: "styles.css", selector: ".dead-class", matched: false }]),
  ];
  const merged = mergeFindings(pages);
  assert.equal(merged.filter((f) => f.category === "unused").length, 1);
});

test("mergeFindings keeps an 'unused' finding for a selector never even checked elsewhere (no false 'used' signal)", () => {
  // Page B doesn't load styles.css at all, so it has no opinion on .dead-class.
  const unusedFinding = makeFinding({
    category: "unused",
    severity: "medium",
    type: "improvement",
    selector: ".dead-class",
    source: "styles.css",
    message: "unused",
  });
  const pages = [
    page("http://x/a", [unusedFinding], [{ source: "styles.css", selector: ".dead-class", matched: false }]),
    page("http://x/b", [], []),
  ];
  const merged = mergeFindings(pages);
  assert.equal(merged.filter((f) => f.category === "unused").length, 1);
});

test("mergeFindings dedupes an identical finding appearing on multiple pages, tracking pageCount", () => {
  const shared = makeFinding({
    category: "specificity",
    severity: "medium",
    type: "improvement",
    selector: "#header",
    source: "vendor.css",
    message: "ID selector used for styling",
  });
  const pages = [page("http://x/a", [shared]), page("http://x/b", [shared]), page("http://x/c", [shared])];
  const merged = mergeFindings(pages);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].meta.pageCount, 3);
  assert.deepEqual(merged[0].meta.pages.sort(), ["http://x/a", "http://x/b", "http://x/c"]);
});

test("mergeFindings keeps findings unique to a single page as pageCount 1", () => {
  const onlyOnA = makeFinding({ category: "duplicates", severity: "low", type: "improvement", selector: ".a", message: "x" });
  const pages = [page("http://x/a", [onlyOnA]), page("http://x/b", [])];
  const merged = mergeFindings(pages);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].meta.pageCount, 1);
});

test("mergeFindings with a single page behaves like a no-op pass-through", () => {
  const f = makeFinding({ category: "performance", severity: "low", type: "improvement", message: "x" });
  const merged = mergeFindings([page("http://x/a", [f])]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].message, "x");
});
