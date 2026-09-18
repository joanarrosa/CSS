import { SEVERITY_WEIGHT } from "../utils/finding.js";

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

export function buildSummary(findings) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const f of findings) {
    if (counts[f.category] === undefined) counts[f.category] = 0;
    counts[f.category]++;
  }

  const ranked = [...findings].sort((a, b) => {
    const w = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (w !== 0) return w;
    // Prefer findings that affect more elements/occurrences when available.
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

  return { total, counts, bySeverity, topFixes };
}
