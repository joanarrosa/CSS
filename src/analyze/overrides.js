import { makeFinding } from "../utils/finding.js";
import { specificityToString } from "../utils/specificity.js";

const MAX_FINDINGS = 200;

export function analyzeOverrides(domResult) {
  const { rules, overrides } = domResult;
  const findings = [];

  const sorted = [...overrides].sort((a, b) => b.count - a.count);

  for (const entry of sorted.slice(0, MAX_FINDINGS)) {
    const loser = rules[entry.loserRuleIdx];
    const winner = rules[entry.winnerRuleIdx];
    if (!loser || !winner) continue;
    if (loser.selector === winner.selector && loser.source === winner.source) continue;

    const winnerWhy =
      winner.declarations.find((d) => d.property === entry.property)?.important
        ? "!important"
        : `higher specificity ${specificityToString(winner.specificityObj)} vs ${specificityToString(loser.specificityObj)}`;
    const sameSpecificity =
      JSON.stringify(loser.specificityObj) === JSON.stringify(winner.specificityObj);

    const sampleDesc = entry.sample
      ? describeSample(entry.sample)
      : null;

    findings.push(
      makeFinding({
        category: "overrides",
        severity: entry.count > 5 ? "high" : "medium",
        type: "error",
        selector: loser.selector,
        source: loser.source,
        line: loser.line,
        message: `"${entry.property}: ${entry.loserValue}" in "${loser.selector}" (${loser.source}${
          loser.line ? `:${loser.line}` : ""
        }) never applies — it's overridden by "${entry.property}: ${entry.winnerValue}" from "${winner.selector}" (${
          winner.source
        }${winner.line ? `:${winner.line}` : ""}) on ${entry.count} matching element${entry.count > 1 ? "s" : ""}${
          sampleDesc ? `, e.g. ${sampleDesc}` : ""
        }.`,
        suggestion: sameSpecificity
          ? `Both rules have equal specificity, so the later rule (source order) wins. Either remove the dead declaration from "${loser.selector}" or reorder the rules.`
          : `The winning rule has ${winnerWhy}. Remove the dead "${entry.property}" declaration from "${loser.selector}", or intentionally increase its specificity if it should win instead.`,
        meta: {
          winnerSelector: winner.selector,
          winnerSource: winner.source,
          winnerLine: winner.line,
          property: entry.property,
          loserValue: entry.loserValue,
          winnerValue: entry.winnerValue,
          affectedElements: entry.count,
        },
      })
    );
  }

  if (overrides.length > MAX_FINDINGS) {
    findings.push(
      makeFinding({
        category: "overrides",
        severity: "low",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `${overrides.length - MAX_FINDINGS} additional overridden-declaration cases were found but omitted from this report for brevity.`,
        suggestion: `Address the top offenders first (sorted by how many elements they affect), then re-run the audit.`,
      })
    );
  }

  return findings;
}

function describeSample(sample) {
  let s = sample.tag || "element";
  if (sample.id) s += `#${sample.id}`;
  if (sample.classes && sample.classes.length) s += `.${sample.classes.join(".")}`;
  return `<${s}>`;
}
