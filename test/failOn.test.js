import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFailOn, shouldFail } from "../src/utils/failOn.js";

test("parseFailOn accepts a letter grade", () => {
  assert.deepEqual(parseFailOn("B"), { kind: "grade", value: "B" });
  assert.deepEqual(parseFailOn("b"), { kind: "grade", value: "B" });
});

test("parseFailOn accepts a numeric score", () => {
  assert.deepEqual(parseFailOn("70"), { kind: "score", value: 70 });
  assert.deepEqual(parseFailOn("0"), { kind: "score", value: 0 });
  assert.deepEqual(parseFailOn("100"), { kind: "score", value: 100 });
});

test("parseFailOn rejects invalid values", () => {
  assert.throws(() => parseFailOn("Z"));
  assert.throws(() => parseFailOn("101"));
  assert.throws(() => parseFailOn("high"));
  assert.throws(() => parseFailOn(""));
});

test("shouldFail (grade): fails when the result is worse than the threshold", () => {
  const threshold = parseFailOn("B");
  assert.equal(shouldFail({ score: 50, grade: "C" }, threshold), true);
  assert.equal(shouldFail({ score: 80, grade: "B" }, threshold), false);
  assert.equal(shouldFail({ score: 95, grade: "A" }, threshold), false);
});

test("shouldFail (score): fails when score is strictly below the threshold", () => {
  const threshold = parseFailOn("70");
  assert.equal(shouldFail({ score: 69, grade: "D" }, threshold), true);
  assert.equal(shouldFail({ score: 70, grade: "C" }, threshold), false);
  assert.equal(shouldFail({ score: 100, grade: "A" }, threshold), false);
});
