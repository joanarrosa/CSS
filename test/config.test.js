import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, partitionIgnored } from "../src/config.js";

test("partitionIgnored keeps everything when there are no rules", () => {
  const findings = [{ category: "unused", message: "a" }];
  const { kept, ignored } = partitionIgnored(findings, []);
  assert.equal(kept.length, 1);
  assert.equal(ignored.length, 0);
});

test("partitionIgnored matches by exact category", () => {
  const findings = [
    { category: "unused", message: "a" },
    { category: "duplicates", message: "b" },
  ];
  const { kept, ignored } = partitionIgnored(findings, [{ category: "unused" }]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].category, "duplicates");
  assert.equal(ignored.length, 1);
});

test("partitionIgnored matches selector with a glob pattern", () => {
  const findings = [{ category: "unused", selector: ".legacy-button", message: "x" }, { category: "unused", selector: ".btn", message: "x" }];
  const { kept, ignored } = partitionIgnored(findings, [{ selector: ".legacy-*" }]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].selector, ".btn");
  assert.equal(ignored.length, 1);
});

test("partitionIgnored matches message as a case-insensitive substring", () => {
  const findings = [{ category: "best-practices", message: "Suspicious magic-number z-index" }];
  const { ignored } = partitionIgnored(findings, [{ message: "magic-number" }]);
  assert.equal(ignored.length, 1);
});

test("partitionIgnored requires ALL fields on a rule to match (AND)", () => {
  const findings = [{ category: "unused", selector: ".btn", message: "x" }];
  const { kept } = partitionIgnored(findings, [{ category: "unused", selector: ".nonexistent" }]);
  assert.equal(kept.length, 1); // selector doesn't match, so this rule doesn't apply
});

test("partitionIgnored matches if ANY rule in the list applies (OR)", () => {
  const findings = [{ category: "performance", message: "x" }];
  const { ignored } = partitionIgnored(findings, [{ category: "unused" }, { category: "performance" }]);
  assert.equal(ignored.length, 1);
});

test("partitionIgnored matches axe-style findings by ruleId (via .id)", () => {
  const findings = [{ id: "region", help: "landmarks", description: "d" }];
  const { ignored } = partitionIgnored(findings, [{ ruleId: "region" }]);
  assert.equal(ignored.length, 1);
});

test("loadConfig returns an empty ignore list when no file exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "css-audit-test-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const config = loadConfig();
    assert.deepEqual(config.ignore, []);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig reads ignore rules from .css-auditrc.json in the cwd", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "css-audit-test-"));
  writeFileSync(path.join(dir, ".css-auditrc.json"), JSON.stringify({ ignore: [{ category: "unused" }] }));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const config = loadConfig();
    assert.equal(config.ignore.length, 1);
    assert.equal(config.ignore[0].category, "unused");
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig throws on a malformed explicit config path", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "css-audit-test-"));
  const badPath = path.join(dir, "bad.json");
  writeFileSync(badPath, "{ not valid json");
  try {
    assert.throws(() => loadConfig(badPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig throws when an explicit config path doesn't exist", () => {
  assert.throws(() => loadConfig("/nonexistent/path/.css-auditrc.json"));
});
