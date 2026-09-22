import type { Finding, ManualChecklistItem, ReportData, ScanConfig, Severity } from "../types.js";
import { computeScore } from "../parse/priority.js";

export function buildReportData(
  findings: Finding[],
  config: ScanConfig,
  scope: { pagesScanned: number; viewportsScanned: number; flowsScanned: number }
): ReportData {
  const bySeverity: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byWcagCriterion: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    for (const c of f.wcagCriteria) byWcagCriterion[c] = (byWcagCriterion[c] || 0) + 1;
  }
  const { score, grade } = computeScore(findings);

  return {
    generatedAt: new Date().toISOString(),
    targets: config.targets,
    flows: config.flows.map((f) => ({ name: f.name, description: f.description })),
    viewports: config.viewports,
    findings,
    summary: {
      score,
      grade,
      total: findings.length,
      bySeverity,
      byWcagCriterion,
      pagesScanned: scope.pagesScanned,
      viewportsScanned: scope.viewportsScanned,
      flowsScanned: scope.flowsScanned,
    },
    manualChecklist: buildManualChecklist(findings),
  };
}

/**
 * Per the brief's technical constraints: automated tools (this one included)
 * are Chromium-biased, and a real Safari/VoiceOver + Firefox/NVDA pass is
 * something no script can substitute for — these always appear, regardless
 * of what the automated scan found.
 */
function buildManualChecklist(findings: Finding[]): ManualChecklistItem[] {
  const items: ManualChecklistItem[] = [
    {
      label: "Safari + VoiceOver pass (macOS/iOS)",
      reason:
        "This scan only drives Chromium. Automated accessibility tools are inherently Chromium-biased, and VoiceOver's announcement behavior — especially for ARIA widgets — can differ meaningfully from what Chromium's accessibility tree reports.",
    },
    {
      label: "Firefox + NVDA pass (Windows)",
      reason:
        "NVDA + Firefox is one of the most common real-world screen reader/browser pairings and isn't exercised by this Chromium-only scan.",
    },
    {
      label: "Full keyboard walkthrough by a human, on the real device/OS",
      reason:
        "The automated keyboard checks (focus indicators, keyboard-trap detection, modal Escape dismissal) catch common patterns, but a real tab-through — especially of custom widgets like comboboxes, date pickers, and carousels — surfaces issues a script's heuristics can't.",
    },
  ];

  if (findings.some((f) => f.source === "live-region")) {
    items.push({
      label: "Listen to each aria-live region with a real screen reader",
      reason: "Confirm dynamic updates announce as complete, meaningful sentences — this scan flagged where live regions exist, but announcement quality can only be judged by actually listening.",
    });
  }

  return items;
}
