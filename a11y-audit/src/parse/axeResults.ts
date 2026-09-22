import type { AxeResults, Result } from "axe-core";
import type { Finding, RawAxeRun, Severity } from "../types.js";
import { wcagCriteriaFromTags, wcagLevelFromTags, en301549FromWcag } from "./wcagMap.js";
import { scoreAxeFinding } from "./priority.js";

function targetToSelector(target: Result["nodes"][number]["target"]): string {
  // target entries are usually a single CSS selector string; for elements
  // inside iframes axe returns an array-of-arrays (frame chain) — join it
  // into one readable path rather than dropping the frame context.
  return target.map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" >>> ");
}

function toFinding(result: Result, needsReview: boolean, ctx: { pageName: string; url: string; viewport: string; flow?: string }): Finding {
  const wcagCriteria = wcagCriteriaFromTags(result.tags);
  const wcagLevel = wcagLevelFromTags(result.tags);
  const nodes = result.nodes;
  const first = nodes[0];
  const severity: Severity = needsReview ? "minor" : ((result.impact as Severity) ?? "moderate");

  const finding: Finding = {
    id: `axe-${result.id}-${ctx.pageName}-${ctx.viewport}${ctx.flow ? `-${ctx.flow}` : ""}`,
    source: "axe",
    ruleId: result.id,
    wcagCriteria,
    wcagLevel,
    en301549: en301549FromWcag(wcagCriteria, wcagLevel),
    severity,
    impact: 0, // filled by scoreAxeFinding
    effort: 0,
    title: needsReview ? `[Needs manual review] ${result.help}` : result.help,
    description: needsReview
      ? `axe-core flagged this as "incomplete" — it couldn't automatically determine pass/fail and needs a human check. ${result.description}`
      : result.description,
    help: result.help,
    helpUrl: result.helpUrl,
    target: nodes.slice(0, 15).map((n) => targetToSelector(n.target)),
    snippet: first?.html?.slice(0, 300),
    fix: first?.failureSummary?.replace(/^Fix (any|all) of the following:\s*/i, "").trim() || `See ${result.helpUrl} for the specific fix for "${result.id}".`,
    page: ctx.pageName,
    url: ctx.url,
    viewport: ctx.viewport,
    flow: ctx.flow,
    isBonusAAA: wcagLevel === "AAA",
    occurrences: nodes.length,
  };

  return scoreAxeFinding(finding);
}

/** Parses one page/viewport(/flow) axe-core run into our Finding shape. */
export function parseAxeRun(run: RawAxeRun): Finding[] {
  const ctx = { pageName: run.page, url: run.url, viewport: run.viewport, flow: run.flow };
  const findings: Finding[] = [];

  for (const result of run.axeResults.violations) {
    findings.push(toFinding(result, false, ctx));
  }
  for (const result of run.axeResults.incomplete) {
    findings.push(toFinding(result, true, ctx));
  }

  return findings;
}

export function saveRawAxeResults(runs: RawAxeRun[]): { page: string; url: string; viewport: string; flow?: string; results: AxeResults }[] {
  return runs.map((r) => ({ page: r.page, url: r.url, viewport: r.viewport, flow: r.flow, results: r.axeResults }));
}
