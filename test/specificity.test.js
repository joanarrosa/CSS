import { test } from "node:test";
import assert from "node:assert/strict";
import * as csstree from "css-tree";
import { selectorSpecificity, specificityTuple, compareSpecificity, specificityScore } from "../src/utils/specificity.js";

function specOf(selectorText) {
  const node = csstree.parse(selectorText, { context: "selector" });
  return selectorSpecificity(node);
}

test("type selector has specificity (0,0,0,1)", () => {
  assert.deepEqual(specificityTuple(specOf("div")), [0, 0, 0, 1]);
});

test("class selector has specificity (0,0,1,0)", () => {
  assert.deepEqual(specificityTuple(specOf(".foo")), [0, 0, 1, 0]);
});

test("id selector has specificity (0,1,0,0)", () => {
  assert.deepEqual(specificityTuple(specOf("#foo")), [0, 1, 0, 0]);
});

test("attribute selector counts as a class", () => {
  assert.deepEqual(specificityTuple(specOf("[data-foo]")), [0, 0, 1, 0]);
});

test("pseudo-class counts as a class", () => {
  assert.deepEqual(specificityTuple(specOf("a:hover")), [0, 0, 1, 1]);
});

test("pseudo-element counts as a type", () => {
  assert.deepEqual(specificityTuple(specOf("p::before")), [0, 0, 0, 2]);
});

test(":where() contributes zero specificity", () => {
  assert.deepEqual(specificityTuple(specOf(":where(.foo, #bar)")), [0, 0, 0, 0]);
});

test("universal selector contributes nothing", () => {
  assert.deepEqual(specificityTuple(specOf("*")), [0, 0, 0, 0]);
});

test("compound selectors accumulate", () => {
  assert.deepEqual(specificityTuple(specOf("#hero .title")), [0, 1, 1, 0]);
  assert.deepEqual(specificityTuple(specOf("div#hero#hero")), [0, 2, 0, 1]);
  assert.deepEqual(specificityTuple(specOf(".a.b.c.d")), [0, 0, 4, 0]);
});

test("compareSpecificity orders id > class > type", () => {
  const id = specOf("#foo");
  const cls = specOf(".foo");
  const type = specOf("div");
  assert.ok(compareSpecificity(id, cls) > 0);
  assert.ok(compareSpecificity(cls, type) > 0);
  assert.ok(compareSpecificity(type, type) === 0);
});

test("specificityScore is monotonic with tuple ordering", () => {
  const low = specOf("div");
  const high = specOf("#foo");
  assert.ok(specificityScore(high) > specificityScore(low));
});
