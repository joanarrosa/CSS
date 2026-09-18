import { buildSummary, CATEGORY_ORDER, CATEGORY_LABELS } from "./summary.js";

export function toJsonReport({ url, finalUrl, title, status, warnings, stats, findings }) {
  const summary = buildSummary(findings);

  const byCategory = {};
  for (const cat of CATEGORY_ORDER) {
    byCategory[cat] = findings
      .filter((f) => f.category === cat)
      .map((f) => ({
        id: f.id,
        severity: f.severity,
        selector: f.selector,
        source: f.source,
        line: f.line,
        message: f.message,
        suggestion: f.suggestion,
        meta: f.meta,
      }));
  }

  return {
    url,
    finalUrl,
    title,
    httpStatus: status,
    warnings,
    stats,
    summary: {
      total: summary.total,
      bySeverity: summary.bySeverity,
      counts: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, summary.counts[c] || 0])),
      topPriorityFixes: summary.topFixes.map((f) => ({
        category: f.category,
        categoryLabel: CATEGORY_LABELS[f.category],
        severity: f.severity,
        selector: f.selector,
        source: f.source,
        line: f.line,
        message: f.message,
        suggestion: f.suggestion,
      })),
    },
    findings: byCategory,
  };
}
