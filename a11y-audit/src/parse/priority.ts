import type { Finding, Severity } from "../types.js";

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };

// Rough per-rule dev-effort estimate (1 = one attribute/line, 5 = structural
// rework), for axe rules where the fix is well-known and consistent. Rules
// not listed fall back to a severity-based default in estimateAxeEffort —
// these are estimates for triage, not a quote.
const EFFORT_BY_AXE_RULE: Record<string, number> = {
  "image-alt": 1,
  "input-image-alt": 1,
  "area-alt": 1,
  "svg-img-alt": 1,
  "object-alt": 1,
  label: 2,
  "aria-required-attr": 1,
  "aria-valid-attr-value": 1,
  "aria-valid-attr": 1,
  "aria-allowed-attr": 1,
  "aria-hidden-body": 1,
  "button-name": 1,
  "link-name": 1,
  "document-title": 1,
  "html-has-lang": 1,
  "html-lang-valid": 1,
  "meta-viewport": 1,
  "color-contrast": 2,
  "duplicate-id": 2,
  "duplicate-id-active": 2,
  "duplicate-id-aria": 2,
  "heading-order": 2,
  "landmark-one-main": 2,
  region: 3,
  "landmark-unique": 2,
  "frame-title": 1,
  tabindex: 2,
  "focus-order-semantics": 3,
  "aria-command-name": 2,
  "aria-dialog-name": 1,
  "nested-interactive": 3,
  list: 2,
  listitem: 2,
  "definition-list": 2,
  "table-duplicate-name": 2,
  "td-headers-attr": 3,
  "th-has-data-cells": 3,
  "scrollable-region-focusable": 2,
};

function estimateAxeEffort(ruleId: string, severity: Severity): number {
  if (ruleId in EFFORT_BY_AXE_RULE) return EFFORT_BY_AXE_RULE[ruleId];
  // Unknown rule: assume roughly proportional to how bad axe considers it —
  // critical/serious issues are more often structural.
  return severity === "critical" || severity === "serious" ? 3 : 2;
}

function estimateAxeImpact(severity: Severity, occurrences: number): number {
  const base = { critical: 5, serious: 4, moderate: 3, minor: 2 }[severity];
  // More affected elements = more of the page/journey is unusable, nudge
  // impact up (capped at 5) without letting a single very-repeated minor
  // issue outrank a genuinely blocking one.
  return Math.min(5, base + (occurrences > 10 ? 1 : 0));
}

/** Fills in impact/effort for an axe-sourced finding that doesn't have them yet. */
export function scoreAxeFinding(finding: Finding): Finding {
  return {
    ...finding,
    impact: finding.impact || estimateAxeImpact(finding.severity, finding.occurrences),
    effort: finding.effort || estimateAxeEffort(finding.ruleId, finding.severity),
  };
}

/**
 * Priority sort: severity first (it's WCAG's own conformance judgment),
 * then estimated user impact, then — as a tiebreaker in the team's favor —
 * lower effort first, so "quick wins" surface before similarly-severe but
 * expensive fixes within the same severity/impact band.
 */
export function sortByPriority(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    const impact = b.impact - a.impact;
    if (impact !== 0) return impact;
    return a.effort - b.effort;
  });
}

const SCORE_PENALTY: Record<Severity, number> = { critical: 12, serious: 6, moderate: 2.5, minor: 0.8 };

export function computeScore(findings: Finding[]): { score: number; grade: "A" | "B" | "C" | "D" | "F" } {
  const penalty = findings.reduce((sum, f) => sum + (SCORE_PENALTY[f.severity] ?? 2), 0);
  const score = Math.round(100 / (1 + penalty / 30));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade };
}
