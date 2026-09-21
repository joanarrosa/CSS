import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAutoFixes } from "../src/autofix.js";

function source(label, text) {
  return { label, text };
}

test("removes a dead declaration proven overridden by the DOM pass", () => {
  const css = `.title {\n  color: red;\n  font-size: 14px;\n}\n#hero .title {\n  color: blue;\n}\n`;
  const colorStart = css.indexOf("color: red");
  const loser = {
    selector: ".title",
    source: "styles.css",
    sourceType: "link",
    line: 2,
    soleSelectorInBlock: true,
    ruleStartOffset: 0,
    ruleEndOffset: css.indexOf("#hero"),
    declarations: [
      { property: "color", value: "red", important: false, startOffset: colorStart, endOffset: colorStart + "color: red".length },
      { property: "font-size", value: "14px", important: false, startOffset: css.indexOf("font-size"), endOffset: css.indexOf("font-size") + "font-size: 14px".length },
    ],
  };
  const winner = { selector: "#hero .title", source: "styles.css", sourceType: "link", line: 5, declarations: [{ property: "color", value: "blue", important: false }] };

  const result = computeAutoFixes({
    rules: [],
    domResult: {
      rules: [loser, winner],
      overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1 }],
    },
    cssSources: [source("styles.css", css)],
  });

  assert.equal(result.fixedSources.length, 1);
  const fixed = result.fixedSources[0].fixed;
  assert.ok(!fixed.includes("color: red"));
  assert.ok(fixed.includes("font-size: 14px"));
  assert.equal(result.applied.length, 1);
  assert.ok(result.applied[0].description.includes("Removed dead"));
});

test("skips a dead declaration inside an inline style attribute", () => {
  const loser = { selector: "[inline style]", source: "inline style attribute", sourceType: "inline", line: null, declarations: [{ property: "color", value: "red", important: false }] };
  const winner = { selector: ".x", source: "styles.css", sourceType: "link", line: 1, declarations: [] };

  const result = computeAutoFixes({
    rules: [],
    domResult: { rules: [loser, winner], overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1 }] },
    cssSources: [],
  });

  assert.equal(result.fixedSources.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes("inline"));
});

test("skips a dead declaration when the rule is shared by a comma-separated selector list", () => {
  const css = `.a, .b {\n  color: red;\n}\n#hero .a {\n  color: blue;\n}\n`;
  const colorStart = css.indexOf("color: red");
  const shared = [{ property: "color", value: "red", important: false, startOffset: colorStart, endOffset: colorStart + "color: red".length }];
  // .a and .b share the exact same declarations array, as they do coming out of parseCss.js.
  const loserA = { selector: ".a", source: "styles.css", sourceType: "link", line: 1, soleSelectorInBlock: false, ruleStartOffset: 0, ruleEndOffset: css.indexOf("#hero"), declarations: shared };
  const winner = { selector: "#hero .a", source: "styles.css", sourceType: "link", line: 4, declarations: [{ property: "color", value: "blue", important: false }] };

  const result = computeAutoFixes({
    rules: [],
    domResult: { rules: [loserA, winner], overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1 }] },
    cssSources: [source("styles.css", css)],
  });

  assert.equal(result.fixedSources.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes("comma-separated"));
});

test("removes the whole rule when every declaration in it is proven dead", () => {
  const css = `.title {\n  color: red;\n}\n#hero .title {\n  color: blue;\n}\n.after { padding: 0; }\n`;
  const colorStart = css.indexOf("color: red");
  const ruleEnd = css.indexOf("#hero");
  const loser = {
    selector: ".title",
    source: "styles.css",
    sourceType: "link",
    line: 1,
    soleSelectorInBlock: true,
    ruleStartOffset: 0,
    ruleEndOffset: ruleEnd,
    declarations: [{ property: "color", value: "red", important: false, startOffset: colorStart, endOffset: colorStart + "color: red".length }],
  };
  const winner = { selector: "#hero .title", source: "styles.css", sourceType: "link", line: 4, declarations: [{ property: "color", value: "blue", important: false }] };

  const result = computeAutoFixes({
    rules: [],
    domResult: { rules: [loser, winner], overrides: [{ loserRuleIdx: 0, winnerRuleIdx: 1, property: "color", loserValue: "red", winnerValue: "blue", count: 1 }] },
    cssSources: [source("styles.css", css)],
  });

  assert.equal(result.fixedSources.length, 1);
  const fixed = result.fixedSources[0].fixed;
  assert.ok(fixed.trimStart().startsWith("#hero .title"), `expected the dead .title rule gone, got:\n${fixed}`);
  assert.ok(!fixed.includes("color: red"));
  assert.ok(fixed.includes("#hero .title"));
  assert.ok(fixed.includes(".after"));
  assert.ok(result.applied[0].description.includes("now-empty rule"));
});

function declAt(css, needle, property, value, important = false) {
  const idx = css.indexOf(needle);
  return { property, value, important, startOffset: idx, endOffset: idx + needle.length };
}

test("merges two non-conflicting duplicate single-selector rules into one", () => {
  const css = `.banner {\n  color: red;\n}\n\n.other { color: green; }\n\n.banner {\n  padding: 10px;\n}\n`;
  const firstStart = css.indexOf(".banner {");
  const firstEnd = css.indexOf("}\n\n.other") + 1;
  const secondStart = css.lastIndexOf(".banner {");
  const secondEnd = css.lastIndexOf("}") + 1;

  const rule1 = {
    selector: ".banner",
    source: "styles.css",
    sourceType: "link",
    media: null,
    line: 1,
    soleSelectorInBlock: true,
    ruleStartOffset: firstStart,
    ruleEndOffset: firstEnd,
    declarations: [declAt(css, "color: red", "color", "red")],
  };
  const rule2 = {
    selector: ".banner",
    source: "styles.css",
    sourceType: "link",
    media: null,
    line: 7,
    soleSelectorInBlock: true,
    ruleStartOffset: secondStart,
    ruleEndOffset: secondEnd,
    declarations: [declAt(css, "padding: 10px", "padding", "10px")],
  };

  const result = computeAutoFixes({
    rules: [rule1, rule2],
    domResult: { rules: [], overrides: [] },
    cssSources: [source("styles.css", css)],
  });

  assert.equal(result.fixedSources.length, 1);
  const fixed = result.fixedSources[0].fixed;
  // Only one .banner block should remain, and it should carry both declarations.
  assert.equal((fixed.match(/\.banner/g) || []).length, 1);
  assert.ok(fixed.includes("color: red"));
  assert.ok(fixed.includes("padding: 10px"));
  assert.ok(fixed.includes(".other"));
  assert.equal(result.applied.length, 1);
  assert.ok(result.applied[0].description.includes("Merged 2 duplicate"));
});

test("skips merging duplicate selectors when values actually conflict", () => {
  const css = `.banner { color: red; }\n.banner { color: blue; }\n`;
  const firstStart = css.indexOf(".banner {");
  const firstEnd = css.indexOf("}\n.banner") + 1;
  const secondStart = css.lastIndexOf(".banner {");
  const secondEnd = css.length;

  const rule1 = {
    selector: ".banner",
    source: "styles.css",
    sourceType: "link",
    media: null,
    line: 1,
    soleSelectorInBlock: true,
    ruleStartOffset: firstStart,
    ruleEndOffset: firstEnd,
    declarations: [declAt(css, "color: red", "color", "red")],
  };
  const rule2 = {
    selector: ".banner",
    source: "styles.css",
    sourceType: "link",
    media: null,
    line: 2,
    soleSelectorInBlock: true,
    ruleStartOffset: secondStart,
    ruleEndOffset: secondEnd,
    declarations: [declAt(css, "color: blue", "color", "blue")],
  };

  const result = computeAutoFixes({
    rules: [rule1, rule2],
    domResult: { rules: [], overrides: [] },
    cssSources: [source("styles.css", css)],
  });

  assert.equal(result.fixedSources.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.ok(result.skipped[0].reason.includes("conflict") || result.skipped[0].reason.includes("differ"));
});

test("does not merge a selector that's part of a comma-separated group", () => {
  const css = `.a, .b {\n  color: red;\n}\n.a {\n  padding: 1px;\n}\n`;
  const rule1 = {
    selector: ".a",
    source: "styles.css",
    sourceType: "link",
    media: null,
    line: 1,
    soleSelectorInBlock: false, // part of ".a, .b"
    ruleStartOffset: 0,
    ruleEndOffset: css.indexOf("}\n.a") + 1,
    declarations: [declAt(css, "color: red", "color", "red")],
  };
  const rule2 = {
    selector: ".a",
    source: "styles.css",
    sourceType: "link",
    media: null,
    line: 4,
    soleSelectorInBlock: true,
    ruleStartOffset: css.lastIndexOf(".a {"),
    ruleEndOffset: css.length,
    declarations: [declAt(css, "padding: 1px", "padding", "1px")],
  };

  const result = computeAutoFixes({
    rules: [rule1, rule2],
    domResult: { rules: [], overrides: [] },
    cssSources: [source("styles.css", css)],
  });

  assert.equal(result.fixedSources.length, 0);
  assert.equal(result.applied.length, 0);
});

test("returns no fixes and no skips for clean input", () => {
  const result = computeAutoFixes({ rules: [], domResult: { rules: [], overrides: [] }, cssSources: [] });
  assert.deepEqual(result.fixedSources, []);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, []);
});
