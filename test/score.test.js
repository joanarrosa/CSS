import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreFromPenalty } from "../src/utils/score.js";
import { toAccessibilityReport } from "../src/axeAudit.js";

test("scoreFromPenalty: zero penalty is 100/A", () => {
  assert.deepEqual(scoreFromPenalty(0), { score: 100, grade: "A" });
});

test("scoreFromPenalty: score never negative and grade bottoms out at F", () => {
  const { score, grade } = scoreFromPenalty(100000);
  assert.ok(score >= 0);
  assert.equal(grade, "F");
});

test("scoreFromPenalty: monotonically decreasing in penalty", () => {
  const a = scoreFromPenalty(10).score;
  const b = scoreFromPenalty(20).score;
  assert.ok(b <= a);
});

function rawAxeResult({ violations = [], incomplete = [], passes = [] } = {}) {
  return { violations, incomplete, passes };
}

function axeRule(impact, overrides = {}) {
  return { id: "rule", impact, description: "d", help: "h", helpUrl: "u", tags: [], nodes: [], ...overrides };
}

test("accessibility report scores 100/A with no violations or incomplete", () => {
  const report = toAccessibilityReport(rawAxeResult({ passes: [axeRule(null)] }));
  assert.equal(report.summary.score, 100);
  assert.equal(report.summary.grade, "A");
});

test("accessibility report score drops more for a critical violation than a minor one", () => {
  const criticalReport = toAccessibilityReport(rawAxeResult({ violations: [axeRule("critical")] }));
  const minorReport = toAccessibilityReport(rawAxeResult({ violations: [axeRule("minor")] }));
  assert.ok(criticalReport.summary.score < minorReport.summary.score);
});

test("incomplete findings penalize less than a confirmed violation of the same impact", () => {
  const violationReport = toAccessibilityReport(rawAxeResult({ violations: [axeRule("serious")] }));
  const incompleteReport = toAccessibilityReport(rawAxeResult({ incomplete: [axeRule("serious")] }));
  assert.ok(incompleteReport.summary.score > violationReport.summary.score);
});
