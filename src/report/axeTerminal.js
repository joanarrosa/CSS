import { color } from "../utils/logger.js";

const IMPACT_BADGE = {
  critical: () => color.red("[CRITICAL]"),
  serious: () => color.red("[SERIOUS]"),
  moderate: () => color.yellow("[MODERATE]"),
  minor: () => color.gray("[MINOR]"),
};

const GRADE_COLOR = {
  A: "green",
  B: "green",
  C: "yellow",
  D: "yellow",
  F: "red",
};

export function printAccessibilityReport({ url, finalUrl, title, warnings, summary, violations, incomplete, passes }) {
  const lines = [];

  lines.push("");
  lines.push(color.bold(color.cyan("Accessibility Report (axe-core, WCAG 2.1 A/AA)")));
  lines.push(color.dim(`URL:   ${url}${finalUrl && finalUrl !== url ? ` -> ${finalUrl}` : ""}`));
  if (title) lines.push(color.dim(`Title: ${title}`));
  lines.push("");

  if (warnings && warnings.length) {
    lines.push(color.yellow(color.bold("Warnings")));
    for (const w of warnings) lines.push(`  ${color.yellow("!")} ${w}`);
    lines.push("");
  }

  lines.push(color.bold("Summary"));
  lines.push(`  ${color.bold(color[GRADE_COLOR[summary.grade]](`Score: ${summary.score}/100 (${summary.grade})`))}`);
  lines.push(
    `  ${color.red(`${summary.violations} violations (need to fix)`)}   ${color.yellow(
      `${summary.incomplete} incomplete (needs manual review)`
    )}   ${color.green(`${summary.passes} passing`)}`
  );
  lines.push(
    color.dim(
      `  by impact — critical: ${summary.byImpact.critical}, serious: ${summary.byImpact.serious}, moderate: ${summary.byImpact.moderate}, minor: ${summary.byImpact.minor}`
    )
  );
  lines.push("");

  if (violations.length) {
    lines.push(color.bold(color.red(`Violations — need to fix (${violations.length})`)));
    lines.push(color.dim("-".repeat(60)));
    for (const rule of violations) printRule(lines, rule);
  }

  if (incomplete.length) {
    lines.push(color.bold(color.yellow(`Needs manual review (${incomplete.length})`)));
    lines.push(color.dim("-".repeat(60)));
    for (const rule of incomplete) printRule(lines, rule);
  }

  if (passes.length) {
    lines.push(color.bold(color.green(`Already passing (${passes.length})`)));
    lines.push(color.dim("-".repeat(60)));
    for (const rule of passes) {
      lines.push(`  ${color.green("✓")} ${rule.help} ${color.dim(`(${rule.nodeCount} element${rule.nodeCount !== 1 ? "s" : ""})`)}`);
    }
    lines.push("");
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function printRule(lines, rule) {
  const badge = rule.impact ? IMPACT_BADGE[rule.impact]?.() || "" : "";
  lines.push(`  ${badge} ${color.bold(rule.help)} ${color.dim(`[${rule.tags.join(", ")}]`)}`);
  lines.push(`      ${rule.description}`);
  for (const node of rule.nodes) {
    lines.push(`      ${color.dim("Where:")} ${node.target}`);
    lines.push(`      ${color.dim("Element:")} ${node.html}`);
    if (node.failureSummary) {
      lines.push(`      ${color.green("Fix:")} ${node.failureSummary.replace(/\n/g, "\n            ")}`);
    }
  }
  lines.push(`      ${color.dim("Learn more:")} ${rule.helpUrl}`);
  lines.push("");
}
