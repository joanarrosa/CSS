import type { ReportData } from "../types.js";
import { sortByPriority } from "../parse/priority.js";

const COLUMNS = [
  "severity",
  "wcagCriteria",
  "wcagLevel",
  "en301549",
  "isBonusAAA",
  "ruleId",
  "source",
  "title",
  "page",
  "url",
  "viewport",
  "flow",
  "target",
  "occurrences",
  "impact",
  "effort",
  "description",
  "fix",
  "snippet",
  "helpUrl",
  "screenshot",
] as const;

function csvCell(value: unknown): string {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvReport(data: ReportData): string {
  const rows = [COLUMNS.join(",")];
  for (const f of sortByPriority(data.findings)) {
    const row = [
      f.severity,
      f.wcagCriteria.join("; "),
      f.wcagLevel,
      f.en301549 ?? "",
      f.isBonusAAA ? "yes" : "no",
      f.ruleId,
      f.source,
      f.title,
      f.page,
      f.url,
      f.viewport,
      f.flow ?? "",
      f.target.slice(0, 5).join("; "),
      f.occurrences,
      f.impact,
      f.effort,
      f.description,
      f.fix,
      f.snippet ?? "",
      f.helpUrl ?? "",
      f.screenshot ?? "",
    ];
    rows.push(row.map(csvCell).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}
