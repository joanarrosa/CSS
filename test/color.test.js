import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, flattenAlpha, contrastRatio, isLargeText, aaThreshold } from "../src/utils/color.js";

test("parseColor handles rgb()/rgba()", () => {
  assert.deepEqual(parseColor("rgb(255, 0, 0)"), [255, 0, 0, 1]);
  assert.deepEqual(parseColor("rgba(0, 128, 255, 0.5)"), [0, 128, 255, 0.5]);
});

test("parseColor handles modern space-separated syntax", () => {
  assert.deepEqual(parseColor("rgb(255 0 0 / 0.5)"), [255, 0, 0, 0.5]);
  assert.deepEqual(parseColor("rgb(255 0 0 / 50%)"), [255, 0, 0, 0.5]);
});

test("parseColor handles hex", () => {
  assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColor("#ff0000"), [255, 0, 0, 1]);
  assert.deepEqual(parseColor("#ff000080"), [255, 0, 0, 128 / 255]);
});

test("parseColor handles transparent and unknown input", () => {
  assert.deepEqual(parseColor("transparent"), [0, 0, 0, 0]);
  assert.equal(parseColor("not-a-color"), null);
  assert.equal(parseColor(""), null);
});

test("contrastRatio: black on white is 21:1", () => {
  const ratio = contrastRatio([0, 0, 0], [255, 255, 255]);
  assert.ok(Math.abs(ratio - 21) < 0.01);
});

test("contrastRatio: same color is 1:1", () => {
  const ratio = contrastRatio([128, 128, 128], [128, 128, 128]);
  assert.ok(Math.abs(ratio - 1) < 0.001);
});

test("contrastRatio is symmetric", () => {
  const a = contrastRatio([50, 50, 50], [200, 200, 200]);
  const b = contrastRatio([200, 200, 200], [50, 50, 50]);
  assert.ok(Math.abs(a - b) < 0.0001);
});

test("flattenAlpha composites a translucent foreground over background", () => {
  // 50% red over white should land at [255, 127.5, 127.5]
  const result = flattenAlpha([255, 0, 0, 0.5], [255, 255, 255]);
  assert.ok(Math.abs(result[0] - 255) < 0.01);
  assert.ok(Math.abs(result[1] - 127.5) < 0.01);
  assert.ok(Math.abs(result[2] - 127.5) < 0.01);
});

test("flattenAlpha is a no-op for opaque colors", () => {
  assert.deepEqual(flattenAlpha([10, 20, 30, 1], [0, 0, 0]), [10, 20, 30]);
});

test("isLargeText: normal weight needs >=24px, bold needs >=18.66px", () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(23.9, 400), false);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.66, "bold"), true);
  assert.equal(isLargeText(18, 700), false);
});

test("aaThreshold: 4.5 for normal text, 3 for large text", () => {
  assert.equal(aaThreshold(16, 400), 4.5);
  assert.equal(aaThreshold(32, 400), 3);
  assert.equal(aaThreshold(20, 700), 3);
});
