import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCssAnnotations, buildA11yAnnotations } from "../src/screenshot.js";
import { makeFinding } from "../src/utils/finding.js";

test("buildCssAnnotations only includes error-type findings with a selector", () => {
  const findings = [
    makeFinding({ category: "overrides", severity: "high", type: "error", selector: ".a", message: "x" }),
    makeFinding({ category: "unused", severity: "medium", type: "improvement", selector: ".b", message: "y" }),
    makeFinding({ category: "performance", severity: "high", type: "improvement", selector: null, message: "z" }),
  ];
  const annotations = buildCssAnnotations(findings);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].selector, ".a");
});

test("buildCssAnnotations sorts high severity before medium/low", () => {
  const findings = [
    makeFinding({ category: "overrides", severity: "medium", type: "error", selector: ".medium", message: "x" }),
    makeFinding({ category: "accessibility", severity: "high", type: "error", selector: ".high", message: "y" }),
  ];
  const annotations = buildCssAnnotations(findings);
  assert.equal(annotations[0].selector, ".high");
});

test("buildA11yAnnotations flattens each violation's node targets into its own entry", () => {
  const violations = [
    {
      impact: "serious",
      help: "contrast",
      nodes: [{ target: ".a" }, { target: ".b" }],
    },
    {
      impact: "critical",
      help: "alt-text",
      nodes: [{ target: "img.hero" }],
    },
  ];
  const annotations = buildA11yAnnotations(violations);
  assert.equal(annotations.length, 3);
  assert.deepEqual(
    annotations.map((a) => a.selector),
    [".a", ".b", "img.hero"]
  );
  assert.equal(annotations[2].severity, "critical");
});

test("buildA11yAnnotations returns an empty array for no violations", () => {
  assert.deepEqual(buildA11yAnnotations([]), []);
});
