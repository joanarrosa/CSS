import { makeFinding } from "../utils/finding.js";

// Pure helpers shared between the Node/Playwright orchestrator
// (analyze/index.js) and the browser extension's in-page bundle. Kept in
// their own module, separate from analyze/index.js, specifically so the
// extension bundle doesn't also pull in analyze/index.js's other imports
// (config.js uses node:fs/node:path, which don't exist in a browser bundle).

export function buildSelectorMatches(domResult) {
  const { rules, matchCounts } = domResult;
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.sourceType === "inline") continue;
    const count = matchCounts[i];
    if (count === null || count === undefined) continue;
    out.push({ source: rule.source, selector: rule.selector, matched: count > 0 });
  }
  return out;
}

export function atRuleBlocksAsRules(atRuleBlocks) {
  return atRuleBlocks.map((b, i) => ({
    id: `atrule-${i}`,
    selector: `@${b.name} ${b.prelude}`.trim(),
    specificityObj: { inline: 0, id: 0, class: 0, type: 0 },
    declarations: b.declarations,
    source: b.source,
    sourceType: b.sourceType,
    href: b.href,
    media: null,
    line: b.line,
    order: -1,
    sourceOrder: -1,
  }));
}

export function parseErrorFindings(parseErrors) {
  return parseErrors.map((e) =>
    makeFinding({
      category: "best-practices",
      severity: "medium",
      type: "error",
      selector: null,
      source: e.source,
      line: e.line,
      message: `CSS syntax error in ${e.source}${e.line ? `:${e.line}` : ""}: ${e.message}`,
      suggestion: `Fix the invalid syntax — browsers typically drop the offending declaration/rule, silently losing whatever style was intended.`,
    })
  );
}
