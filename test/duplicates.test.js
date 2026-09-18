import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllSources } from "../src/parseCss.js";
import { analyzeDuplicates } from "../src/analyze/duplicates.js";

function rulesFor(css) {
  return parseAllSources([
    { id: "s1", type: "style", label: "<style> block #1", href: null, media: "", text: css, order: 0 },
  ]).rules;
}

test("flags a selector defined twice with conflicting values as high severity + error", () => {
  const rules = rulesFor(".title { color: red; } .title { color: blue; }");
  const findings = analyzeDuplicates(rules);
  const dup = findings.find((f) => f.selector === ".title");
  assert.ok(dup);
  assert.equal(dup.severity, "high");
  assert.equal(dup.type, "error");
  assert.ok(dup.message.includes("conflicting values"));
});

test("flags a selector defined twice with no conflict as medium severity + improvement", () => {
  const rules = rulesFor(".a { color: red; } .a { color: red; }");
  const findings = analyzeDuplicates(rules);
  const dup = findings.find((f) => f.selector === ".a" && f.category === "duplicates");
  assert.ok(dup);
  assert.equal(dup.severity, "medium");
  assert.equal(dup.type, "improvement");
});

test("does not flag a selector defined only once", () => {
  const rules = rulesFor(".a { color: red; } .b { color: blue; }");
  const findings = analyzeDuplicates(rules);
  assert.equal(findings.filter((f) => f.message.includes("is defined")).length, 0);
});

test("flags the same property:value repeated across >= 3 different selectors", () => {
  const rules = rulesFor(".a{color:red} .b{color:red} .c{color:red}");
  const findings = analyzeDuplicates(rules);
  const repeated = findings.find((f) => f.message.includes("repeated identically"));
  assert.ok(repeated);
  assert.equal(repeated.meta.selectors.length, 3);
});

test("does not flag the same property:value repeated only twice", () => {
  const rules = rulesFor(".a{color:red} .b{color:red}");
  const findings = analyzeDuplicates(rules);
  assert.equal(findings.filter((f) => f.message.includes("repeated identically")).length, 0);
});

test("treats rules in different @media contexts as distinct (not duplicates)", () => {
  const rules = rulesFor(`
    .a { color: red; }
    @media (max-width: 600px) { .a { color: red; } }
  `);
  const findings = analyzeDuplicates(rules);
  assert.equal(findings.filter((f) => f.message.includes("is defined")).length, 0);
});
