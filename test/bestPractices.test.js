import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllSources } from "../src/parseCss.js";
import { analyzeBestPractices } from "../src/analyze/bestPractices.js";

function rulesFor(css) {
  return parseAllSources([
    { id: "s1", type: "style", label: "<style> block #1", href: null, media: "", text: css, order: 0 },
  ]).rules;
}

test("flags selectors with 5+ compound parts as deeply nested", () => {
  const rules = rulesFor("body main section.card div.thing span.nested.deep { color: red; }");
  const findings = analyzeBestPractices(rules);
  assert.ok(findings.some((f) => f.message.includes("Deeply nested selector")));
});

test("does not flag a short selector chain", () => {
  const rules = rulesFor(".card .title { color: red; }");
  const findings = analyzeBestPractices(rules);
  assert.equal(findings.filter((f) => f.message.includes("Deeply nested")).length, 0);
});

test("flags mixed units for the same tracked property", () => {
  const rules = rulesFor(".a { font-size: 16px; } .b { font-size: 1rem; }");
  const findings = analyzeBestPractices(rules);
  const f = findings.find((f) => f.message.includes("Inconsistent units"));
  assert.ok(f);
  assert.equal(f.meta.property, "font-size");
});

test("does not flag a single consistent unit", () => {
  const rules = rulesFor(".a { font-size: 16px; } .b { font-size: 20px; }");
  const findings = analyzeBestPractices(rules);
  assert.equal(findings.filter((f) => f.message.includes("Inconsistent units")).length, 0);
});

test("flags a vendor-prefixed property with no standard fallback in the same rule", () => {
  const rules = rulesFor(".a { -webkit-transform: scale(1); }");
  const findings = analyzeBestPractices(rules);
  assert.ok(findings.some((f) => f.message.includes('"-webkit-transform"')));
});

test("does not flag a vendor prefix when the standard property is present too", () => {
  const rules = rulesFor(".a { -webkit-transform: scale(1); transform: scale(1); }");
  const findings = analyzeBestPractices(rules);
  assert.equal(findings.filter((f) => f.message.includes("-webkit-transform")).length, 0);
});

test("flags a suspiciously large z-index", () => {
  const rules = rulesFor(".modal { z-index: 99999; }");
  const findings = analyzeBestPractices(rules);
  assert.ok(findings.some((f) => f.message.includes("magic-number z-index")));
});

test("does not flag a reasonable z-index", () => {
  const rules = rulesFor(".modal { z-index: 10; }");
  const findings = analyzeBestPractices(rules);
  assert.equal(findings.filter((f) => f.message.includes("z-index")).length, 0);
});

test("flags repeated hardcoded colors when no CSS variables are used anywhere", () => {
  const rules = rulesFor(".a{color:#444444} .b{color:#444444} .c{color:#444444}");
  const findings = analyzeBestPractices(rules);
  const f = findings.find((f) => f.message.includes("custom properties"));
  assert.ok(f);
});

test("does not flag repeated colors when the stylesheet already uses var()", () => {
  const rules = rulesFor(":root{--c:#444444} .a{color:#444444} .b{color:#444444} .c{color:#444444}");
  const findings = analyzeBestPractices(rules);
  assert.equal(findings.filter((f) => f.message.includes("custom properties")).length, 0);
});
