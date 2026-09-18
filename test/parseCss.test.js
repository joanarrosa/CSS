import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllSources } from "../src/parseCss.js";

function parseOne(css, overrides = {}) {
  return parseAllSources([
    { id: "s1", type: "style", label: "<style> block #1", href: null, media: "", text: css, order: 0, ...overrides },
  ]);
}

test("parses a simple rule with declarations", () => {
  const { rules } = parseOne(".foo { color: red; margin: 10px; }");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, ".foo");
  assert.equal(rules[0].declarations.length, 2);
  assert.deepEqual(
    rules[0].declarations.map((d) => d.property),
    ["color", "margin"]
  );
});

test("splits comma-separated selector lists into separate rules", () => {
  const { rules } = parseOne(".a, .b, .c { color: red; }");
  assert.equal(rules.length, 3);
  assert.deepEqual(
    rules.map((r) => r.selector),
    [".a", ".b", ".c"]
  );
});

test("captures !important on declarations", () => {
  const { rules } = parseOne(".foo { color: red !important; margin: 5px; }");
  const [colorDecl, marginDecl] = rules[0].declarations;
  assert.equal(colorDecl.important, true);
  assert.equal(marginDecl.important, false);
});

test("tracks @media nesting on rules inside it", () => {
  const { rules } = parseOne(`
    .a { color: red; }
    @media (max-width: 600px) {
      .b { color: blue; }
    }
  `);
  const a = rules.find((r) => r.selector === ".a");
  const b = rules.find((r) => r.selector === ".b");
  assert.equal(a.media, null);
  assert.equal(b.media, "(max-width:600px)");
});

test("records line numbers", () => {
  const { rules } = parseOne("\n\n.foo {\n  color: red;\n}\n");
  assert.equal(rules[0].line, 3);
});

test("recovers from a syntax error and reports it without throwing", () => {
  const { rules, parseErrors } = parseOne(".broken {{{ color: ; } .after { color: red; }");
  assert.ok(parseErrors.length >= 1);
  assert.equal(parseErrors[0].source, "<style> block #1");
  // Parsing continues rather than aborting entirely.
  assert.ok(Array.isArray(rules));
});

test("extracts @font-face/@keyframes as atRuleBlocks, not as selectable rules", () => {
  const { rules, atRuleBlocks } = parseOne(`
    @font-face { font-family: "Foo"; src: url(foo.woff); }
    .a { color: red; }
  `);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, ".a");
  assert.equal(atRuleBlocks.length, 1);
  assert.equal(atRuleBlocks[0].name, "font-face");
});

test("assigns increasing global order across sources", () => {
  const { rules } = parseAllSources([
    { id: "s1", type: "style", label: "a", href: null, media: "", text: ".a{color:red}", order: 0 },
    { id: "s2", type: "style", label: "b", href: null, media: "", text: ".b{color:blue}", order: 1 },
  ]);
  assert.ok(rules[0].order < rules[1].order);
});
