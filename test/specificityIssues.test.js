import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllSources } from "../src/parseCss.js";
import { analyzeSpecificity } from "../src/analyze/specificityIssues.js";

function rulesFor(css) {
  return parseAllSources([
    { id: "s1", type: "style", label: "<style> block #1", href: null, media: "", text: css, order: 0 },
  ]).rules;
}

test("flags !important on a low-specificity selector as an error", () => {
  const rules = rulesFor(".a { color: red !important; }");
  const findings = analyzeSpecificity(rules);
  const f = findings.find((f) => f.message.includes("!important used"));
  assert.ok(f);
  assert.equal(f.type, "error");
  assert.equal(f.severity, "high");
});

test("flags !important on a high-specificity selector as an improvement, not an error", () => {
  const rules = rulesFor("#hero.foo.bar.baz { color: red !important; }");
  const findings = analyzeSpecificity(rules);
  const f = findings.find((f) => f.message.includes("!important used"));
  assert.ok(f);
  assert.equal(f.type, "improvement");
});

test("flags ID selectors used for styling, with class-conversion suggestion", () => {
  const rules = rulesFor("#header { color: red; }");
  const findings = analyzeSpecificity(rules);
  const f = findings.find((f) => f.message.includes("ID selector used for styling"));
  assert.ok(f);
  assert.ok(f.suggestion.includes(".header"));
});

test("does not flag a plain class selector for ID usage", () => {
  const rules = rulesFor(".header { color: red; }");
  const findings = analyzeSpecificity(rules);
  assert.equal(findings.filter((f) => f.message.includes("ID selector")).length, 0);
});

test("flags overly specific selectors with 4+ classes", () => {
  const rules = rulesFor(".a.b.c.d { color: red; }");
  const findings = analyzeSpecificity(rules);
  const f = findings.find((f) => f.message.includes("Overly specific selector"));
  assert.ok(f);
});

test("aggregates a high-severity warning once !important count crosses the threshold", () => {
  const css = Array.from({ length: 6 }, (_, i) => `.s${i} { color: red !important; }`).join(" ");
  const rules = rulesFor(css);
  const findings = analyzeSpecificity(rules);
  const aggregate = findings.find((f) => f.message.includes("Heavy !important use"));
  assert.ok(aggregate);
  assert.equal(aggregate.severity, "high");
});
