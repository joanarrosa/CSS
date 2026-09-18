import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, CATEGORY_ORDER } from "../src/report/summary.js";
import { makeFinding } from "../src/utils/finding.js";

test("counts findings per category and severity", () => {
  const findings = [
    makeFinding({ category: "duplicates", severity: "high", message: "a" }),
    makeFinding({ category: "duplicates", severity: "low", message: "b" }),
    makeFinding({ category: "overrides", severity: "medium", type: "error", message: "c" }),
  ];
  const summary = buildSummary(findings);
  assert.equal(summary.total, 3);
  assert.equal(summary.counts.duplicates, 2);
  assert.equal(summary.counts.overrides, 1);
  assert.equal(summary.bySeverity.high, 1);
  assert.equal(summary.bySeverity.low, 1);
  assert.equal(summary.byType.error, 1);
  assert.equal(summary.byType.improvement, 2);
});

test("every category in CATEGORY_ORDER is represented even with zero findings", () => {
  const summary = buildSummary([]);
  for (const cat of CATEGORY_ORDER) {
    assert.equal(summary.counts[cat], 0);
  }
});

test("topFixes ranks errors above improvements of equal severity", () => {
  const findings = [
    makeFinding({ category: "best-practices", severity: "high", type: "improvement", selector: ".a", message: "improvement one" }),
    makeFinding({ category: "overrides", severity: "high", type: "error", selector: ".b", message: "error one" }),
  ];
  const summary = buildSummary(findings);
  assert.equal(summary.topFixes[0].type, "error");
});

test("topFixes ranks higher severity above lower severity", () => {
  const findings = [
    makeFinding({ category: "unused", severity: "low", type: "improvement", selector: ".a", message: "low one" }),
    makeFinding({ category: "unused", severity: "high", type: "improvement", selector: ".b", message: "high one" }),
  ];
  const summary = buildSummary(findings);
  assert.equal(summary.topFixes[0].severity, "high");
});

test("topFixes caps at 3 and de-duplicates by category+selector", () => {
  const findings = Array.from({ length: 5 }, (_, i) =>
    makeFinding({ category: "unused", severity: "high", type: "error", selector: ".dup", message: `m${i}` })
  );
  const summary = buildSummary(findings);
  assert.equal(summary.topFixes.length, 1);
});
