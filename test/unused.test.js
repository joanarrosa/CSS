import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeUnused } from "../src/analyze/unused.js";

function rule(overrides = {}) {
  return { selector: ".foo", source: "styles.css", line: 1, sourceType: "link", ...overrides };
}

test("flags a selector with zero matches as medium severity", () => {
  const domResult = {
    rules: [rule({ selector: ".gone" })],
    matchCounts: [0],
    truncated: false,
  };
  const findings = analyzeUnused(domResult);
  const f = findings.find((f) => f.selector === ".gone");
  assert.ok(f);
  assert.equal(f.severity, "medium");
});

test("does not flag a selector that matched at least one element", () => {
  const domResult = {
    rules: [rule({ selector: ".present" })],
    matchCounts: [3],
    truncated: false,
  };
  const findings = analyzeUnused(domResult);
  assert.equal(findings.filter((f) => f.selector === ".present").length, 0);
});

test("treats an unmatched dynamic-pseudo selector as low severity with a caveat", () => {
  const domResult = {
    rules: [rule({ selector: "a:hover" })],
    matchCounts: [0],
    truncated: false,
  };
  const findings = analyzeUnused(domResult);
  const f = findings.find((f) => f.selector === "a:hover");
  assert.equal(f.severity, "low");
  assert.ok(f.message.includes("dynamic state"));
});

test("skips rules that could not be evaluated (null match count)", () => {
  const domResult = {
    rules: [rule({ selector: ":not(valid" })],
    matchCounts: [null],
    truncated: false,
  };
  const findings = analyzeUnused(domResult);
  assert.equal(findings.length, 0);
});

test("never flags inline style rules as unused", () => {
  const domResult = {
    rules: [rule({ selector: "body > h2", sourceType: "inline" })],
    matchCounts: [0],
    truncated: false,
  };
  const findings = analyzeUnused(domResult);
  assert.equal(findings.length, 0);
});

test("adds an aggregate summary with the correct percentage", () => {
  const domResult = {
    rules: [rule({ selector: ".a" }), rule({ selector: ".b" }), rule({ selector: ".c" })],
    matchCounts: [0, 1, 1],
    truncated: false,
  };
  const findings = analyzeUnused(domResult);
  const summary = findings.find((f) => f.message.includes("checked selectors"));
  assert.ok(summary);
  assert.ok(summary.message.includes("1 of 3"));
  assert.ok(summary.message.includes("33%"));
});

test("adds a truncation notice when domResult.truncated is true", () => {
  const domResult = { rules: [], matchCounts: [], truncated: true };
  const findings = analyzeUnused(domResult);
  assert.ok(findings.some((f) => f.message.includes("more rules than this tool checks")));
});
