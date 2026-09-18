import { SEVERITY_WEIGHT } from "../utils/finding.js";
import { scoreFromPenalty } from "../utils/score.js";

export const CATEGORY_ORDER = [
  "duplicates",
  "overrides",
  "specificity",
  "unused",
  "best-practices",
  "accessibility",
  "performance",
];

export const CATEGORY_LABELS = {
  duplicates: "Duplicates",
  overrides: "Overrides",
  specificity: "Specificity",
  unused: "Unused CSS",
  "best-practices": "Best Practices",
  accessibility: "Accessibility",
  performance: "Performance",
};

export const CATEGORY_DESCRIPTIONS = {
  duplicates:
    "Selectors defined more than once, or the same property/value repeated across many selectors. Wastes bytes and makes it unclear which definition is authoritative.",
  overrides:
    "Declarations that are set but never actually apply, because a later, more specific, or !important rule wins the cascade. The dead declaration is effectively silent code.",
  specificity:
    "!important overuse, ID selectors, and overly specific selector chains — these make the cascade harder to reason about and future overrides harder to write.",
  unused:
    "Selectors that don't match any element on this page/state. May be dead code, or may only apply on other pages, viewports, or interactive states — verify before deleting.",
  "best-practices":
    "Maintainability and consistency issues: magic numbers instead of variables, mixed units, vendor-prefix gaps, deep selector nesting, and invalid CSS syntax.",
  accessibility:
    "WCAG AA color-contrast failures and status conveyed by color alone — these affect real users, particularly people with low vision or color-vision deficiencies.",
  performance:
    "Stylesheet size, render-blocking loads, and selector counts that can delay first paint or slow down style recalculation.",
};

// Penalty per finding, by type+severity. Errors weigh more than improvements
// at the same severity, matching the error/improvement framing elsewhere.
const PENALTY = {
  error: { high: 10, medium: 5, low: 2 },
  improvement: { high: 4, medium: 2, low: 0.5 },
};

/**
 * A single 0-100 "health" number, and a letter grade (see scoreFromPenalty
 * for the curve). A handful of high-severity errors drops it fast; a long
 * tail of low-severity improvements drags it down slowly.
 */
export function computeScore(findings) {
  const penalty = findings.reduce((sum, f) => sum + (PENALTY[f.type]?.[f.severity] ?? PENALTY.improvement.low), 0);
  return scoreFromPenalty(penalty);
}

export function buildSummary(findings) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const f of findings) {
    if (counts[f.category] === undefined) counts[f.category] = 0;
    counts[f.category]++;
  }

  const ranked = [...findings].sort((a, b) => {
    // Objective errors first, then severity, then impact (how many elements/occurrences affected).
    if (a.type !== b.type) return a.type === "error" ? -1 : 1;
    const w = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (w !== 0) return w;
    const aImpact = a.meta?.count || a.meta?.affectedElements || a.meta?.occurrences?.length || 1;
    const bImpact = b.meta?.count || b.meta?.affectedElements || b.meta?.occurrences?.length || 1;
    return bImpact - aImpact;
  });

  const topFixes = [];
  const seenSelectors = new Set();
  for (const f of ranked) {
    const key = `${f.category}:${f.selector || f.message.slice(0, 40)}`;
    if (seenSelectors.has(key)) continue;
    seenSelectors.add(key);
    topFixes.push(f);
    if (topFixes.length >= 3) break;
  }

  const total = findings.length;
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  const byType = { error: 0, improvement: 0 };
  for (const f of findings) byType[f.type] = (byType[f.type] || 0) + 1;

  const { score, grade } = computeScore(findings);

  return { total, counts, bySeverity, byType, topFixes, score, grade };
}
