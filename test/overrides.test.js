import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeOverrides } from "../src/analyze/overrides.js";

function rule(overrides = {}) {
  return {
    selector: ".foo",
    specificityObj: { inline: 0, id: 0, class: 1, type: 0 },
    declarations: [],
    source: "styles.css",
    line: 1,
    ...overrides,
  };
}

test("reports a dead declaration overridden by a higher-specificity winner", () => {
  const loser = rule({ selector: ".title", line: 1, specificityObj: { inline: 0, id: 0, class: 1, type: 0 } });
  const winner = rule({
    selector: "#hero .title",
    line: 10,
    specificityObj: { inline: 0, id: 1, class: 1, type: 0 },
    declarations: [{ property: "color", value: "blue", important: false }],
  });
  const domResult = {
    rules: [loser, winner],
    overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1, sample: { tag: "h1" } }],
  };
  const findings = analyzeOverrides(domResult);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "error");
  assert.equal(findings[0].severity, "medium");
  assert.ok(findings[0].message.includes("never applies"));
  assert.ok(findings[0].message.includes("<h1>"));
});

test("escalates to high severity when many elements are affected", () => {
  const loser = rule();
  const winner = rule({ selector: ".bar" });
  const domResult = {
    rules: [loser, winner],
    overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 10 }],
  };
  const findings = analyzeOverrides(domResult);
  assert.equal(findings[0].severity, "high");
});

test("attributes the win to !important when the winning declaration has it", () => {
  const loser = rule();
  const winner = rule({
    selector: ".bar",
    declarations: [{ property: "color", value: "blue", important: true }],
  });
  const domResult = {
    rules: [loser, winner],
    overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1 }],
  };
  const findings = analyzeOverrides(domResult);
  assert.ok(findings[0].suggestion.includes("!important"));
});

test("skips a self-referencing entry (same selector and source)", () => {
  const r = rule();
  const domResult = {
    rules: [r, r],
    overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1 }],
  };
  const findings = analyzeOverrides(domResult);
  assert.equal(findings.length, 0);
});

test("adds a summary finding when overrides exceed the display cap", () => {
  const loser = rule();
  const winner = rule({ selector: ".bar" });
  const overrides = Array.from({ length: 205 }, (_, i) => ({
    loserRuleIdx: 0,
    winnerRuleIdx: 1,
    property: "color",
    loserValue: "red",
    winnerValue: "blue",
    count: 205 - i,
  }));
  const domResult = { rules: [loser, winner], overrides };
  const findings = analyzeOverrides(domResult);
  const summary = findings.find((f) => f.message.includes("omitted from this report"));
  assert.ok(summary);
});
