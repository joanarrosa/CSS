import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { scoreFromPenalty } from "./utils/score.js";
import { partitionIgnored } from "./config.js";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// WCAG 2.x levels A and AA (the levels most sites are expected to meet),
// plus axe's curated "best-practice" rules that aren't strictly WCAG but
// catch real problems (e.g. empty headings, duplicate ids).
const RUN_ONLY_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/**
 * Injects axe-core into the given Playwright page and runs a full
 * accessibility audit, scoped to WCAG 2.x A/AA + best-practice rules.
 * Returns axe's raw result shape: { violations, incomplete, passes, ... }.
 */
export async function runAxeAudit(page) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(async (tags) => {
    return await window.axe.run(document, {
      resultTypes: ["violations", "incomplete", "passes"],
      runOnly: { type: "tag", values: tags },
    });
  }, RUN_ONLY_TAGS);
  return results;
}

const IMPACT_ORDER = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const VIOLATION_PENALTY = { critical: 10, serious: 6, moderate: 3, minor: 1 };
const INCOMPLETE_PENALTY_FACTOR = 0.5; // needs manual review, not a confirmed failure

/**
 * Transforms axe-core's raw output into a compact, UI-friendly shape:
 * summary counts + three lists (violations, incomplete, passes), each rule
 * carrying its WCAG tags, human-readable help, a doc link, and the specific
 * affected elements with axe's own per-node fix guidance.
 */
export function toAccessibilityReport(rawResults, { ignoreRules = [] } = {}) {
  let violations = rawResults.violations.map(mapRule);
  let incomplete = rawResults.incomplete.map(mapRule);
  const passes = rawResults.passes.map(mapRule);

  const violationsSplit = partitionIgnored(violations, ignoreRules);
  const incompleteSplit = partitionIgnored(incomplete, ignoreRules);
  violations = violationsSplit.kept;
  incomplete = incompleteSplit.kept;
  const ignoredCount = violationsSplit.ignored.length + incompleteSplit.ignored.length;

  violations.sort((a, b) => (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0));
  incomplete.sort((a, b) => (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0));

  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    if (byImpact[v.impact] !== undefined) byImpact[v.impact]++;
  }

  const penalty =
    violations.reduce((sum, v) => sum + (VIOLATION_PENALTY[v.impact] ?? VIOLATION_PENALTY.minor), 0) +
    incomplete.reduce((sum, v) => sum + (VIOLATION_PENALTY[v.impact] ?? VIOLATION_PENALTY.minor) * INCOMPLETE_PENALTY_FACTOR, 0);
  const { score, grade } = scoreFromPenalty(penalty);

  return {
    summary: {
      score,
      grade,
      violations: violations.length,
      incomplete: incomplete.length,
      passes: passes.length,
      byImpact,
      ignored: ignoredCount,
    },
    violations,
    incomplete,
    passes,
  };
}

function mapRule(rule) {
  return {
    id: rule.id,
    impact: rule.impact || null,
    description: rule.description,
    help: rule.help,
    helpUrl: rule.helpUrl,
    tags: rule.tags.filter((t) => /^wcag|best-practice|cat\./.test(t)),
    nodeCount: rule.nodes.length,
    nodes: rule.nodes.slice(0, 10).map((n) => ({
      target: Array.isArray(n.target) ? n.target.join(" ") : String(n.target),
      html: truncate(n.html, 200),
      failureSummary: n.failureSummary || null,
    })),
  };
}

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + "…" : str;
}
