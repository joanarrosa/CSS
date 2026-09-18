import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFinding, SEVERITY_WEIGHT } from "../src/utils/finding.js";

test("defaults severity to medium and type to improvement", () => {
  const f = makeFinding({ category: "duplicates", message: "x" });
  assert.equal(f.severity, "medium");
  assert.equal(f.type, "improvement");
  assert.equal(f.selector, null);
  assert.equal(f.source, null);
  assert.equal(f.line, null);
  assert.deepEqual(f.meta, {});
});

test("assigns a unique id to each finding", () => {
  const a = makeFinding({ category: "duplicates", message: "a" });
  const b = makeFinding({ category: "duplicates", message: "b" });
  assert.notEqual(a.id, b.id);
});

test("preserves explicitly passed fields", () => {
  const f = makeFinding({
    category: "overrides",
    severity: "high",
    type: "error",
    selector: ".foo",
    source: "a.css",
    line: 5,
    message: "m",
    suggestion: "s",
    meta: { x: 1 },
  });
  assert.equal(f.severity, "high");
  assert.equal(f.type, "error");
  assert.equal(f.selector, ".foo");
  assert.equal(f.line, 5);
  assert.deepEqual(f.meta, { x: 1 });
});

test("SEVERITY_WEIGHT orders high > medium > low", () => {
  assert.ok(SEVERITY_WEIGHT.high > SEVERITY_WEIGHT.medium);
  assert.ok(SEVERITY_WEIGHT.medium > SEVERITY_WEIGHT.low);
});
