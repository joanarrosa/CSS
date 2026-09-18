import { color } from "../utils/logger.js";
import { buildSummary, CATEGORY_ORDER, CATEGORY_LABELS } from "./summary.js";

const SEVERITY_BADGE = {
  high: (s) => color.red(`[${s.toUpperCase()}]`),
  medium: (s) => color.yellow(`[${s.toUpperCase()}]`),
  low: (s) => color.gray(`[${s.toUpperCase()}]`),
};

export function printTerminalReport({ url, finalUrl, title, status, warnings, stats, findings }) {
  const summary = buildSummary(findings);
  const lines = [];

  lines.push("");
  lines.push(color.bold(color.cyan("CSS Audit Report")));
  lines.push(color.dim(`URL:      ${url}${finalUrl && finalUrl !== url ? ` -> ${finalUrl}` : ""}`));
  if (title) lines.push(color.dim(`Title:    ${title}`));
  if (status) lines.push(color.dim(`HTTP:     ${status}`));
  lines.push(
    color.dim(
      `Analyzed: ${stats.totalRules} rules across ${stats.totalSources} stylesheet source(s)${
        stats.parseErrors ? `, ${stats.parseErrors} parse error(s)` : ""
      }`
    )
  );
  lines.push("");

  if (warnings && warnings.length) {
    lines.push(color.yellow(color.bold("Warnings")));
    for (const w of warnings) lines.push(`  ${color.yellow("!")} ${w}`);
    lines.push("");
  }

  lines.push(color.bold("Summary"));
  lines.push(
    `  ${color.red(`${summary.bySeverity.high || 0} high`)}  ${color.yellow(
      `${summary.bySeverity.medium || 0} medium`
    )}  ${color.gray(`${summary.bySeverity.low || 0} low`)}  ${color.bold(`(${summary.total} total)`)}`
  );
  for (const cat of CATEGORY_ORDER) {
    const n = summary.counts[cat] || 0;
    lines.push(`  ${padLabel(CATEGORY_LABELS[cat])} ${n}`);
  }
  lines.push("");

  if (summary.topFixes.length) {
    lines.push(color.bold("Top priority fixes"));
    summary.topFixes.forEach((f, i) => {
      lines.push(`  ${i + 1}. ${SEVERITY_BADGE[f.severity](f.severity)} ${color.bold(CATEGORY_LABELS[f.category])} — ${f.message}`);
      if (f.suggestion) lines.push(`     ${color.dim("Fix:")} ${f.suggestion}`);
    });
    lines.push("");
  }

  for (const cat of CATEGORY_ORDER) {
    const catFindings = findings.filter((f) => f.category === cat);
    if (catFindings.length === 0) continue;
    lines.push(color.bold(color.cyan(`${CATEGORY_LABELS[cat]} (${catFindings.length})`)));
    lines.push(color.dim("-".repeat(60)));
    for (const f of catFindings) {
      const badge = SEVERITY_BADGE[f.severity](f.severity);
      const loc = formatLocation(f);
      lines.push(`  ${badge} ${f.selector ? color.bold(f.selector) : color.dim("(document-level)")}${loc ? color.dim(`  ${loc}`) : ""}`);
      lines.push(`      ${f.message}`);
      if (f.suggestion) lines.push(`      ${color.green("Fix:")} ${f.suggestion}`);
      lines.push("");
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function formatLocation(f) {
  if (!f.source) return "";
  return f.line ? `(${f.source}:${f.line})` : `(${f.source})`;
}

function padLabel(label) {
  return (label + " ".repeat(16)).slice(0, 16);
}
