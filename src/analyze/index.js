import { parseAllSources } from "../parseCss.js";
import { matchRulesAgainstDom } from "../domMatch.js";
import { analyzeDuplicates } from "./duplicates.js";
import { analyzeOverrides } from "./overrides.js";
import { analyzeSpecificity } from "./specificityIssues.js";
import { analyzeUnused } from "./unused.js";
import { analyzeBestPractices } from "./bestPractices.js";
import { analyzeAccessibility } from "./accessibility.js";
import { analyzePerformance } from "./performance.js";
import { makeFinding } from "../utils/finding.js";
import { info } from "../utils/logger.js";
import { partitionIgnored } from "../config.js";

export async function runFullAnalysis({ page, cssSources, inlineStyleElements }, { verbose = false, ignoreRules = [] } = {}) {
  if (verbose) info("Parsing CSS...");
  const { rules: parsedRules, parseErrors, atRuleBlocks } = parseAllSources(cssSources);

  const inlineRules = inlineStyleElementsToRules(inlineStyleElements, parsedRules.length);
  const rules = [...parsedRules, ...inlineRules];

  if (verbose) info(`Parsed ${rules.length} rules (${inlineRules.length} inline style attributes). Matching against live DOM...`);
  const domResult = await matchRulesAgainstDom(page, rules);

  if (verbose) info("Running analyzers...");
  const allFindings = [
    ...analyzeDuplicates(rules),
    ...analyzeOverrides(domResult),
    ...analyzeSpecificity(rules),
    ...analyzeUnused(domResult),
    ...analyzeBestPractices([...rules, ...atRuleBlocksAsRules(atRuleBlocks)]),
    ...(await analyzeAccessibility(page)),
    ...analyzePerformance(cssSources, parsedRules),
    ...parseErrorFindings(parseErrors),
  ];

  const { kept: findings, ignored } = partitionIgnored(allFindings, ignoreRules);
  if (verbose && ignored.length) info(`${ignored.length} finding(s) hidden by ignore rules in the config.`);

  return {
    findings,
    stats: { totalRules: rules.length, totalSources: cssSources.length, parseErrors: parseErrors.length, ignored: ignored.length },
  };
}

// Inline style="" attributes behave like a rule with maximal specificity that
// always wins over any stylesheet rule (barring !important elsewhere).
function inlineStyleElementsToRules(inlineStyleElements, orderStart) {
  return inlineStyleElements.map((el, i) => ({
    id: `inline-${i}`,
    selector: el.selector || "[inline style]",
    specificityObj: { inline: 1, id: 0, class: 0, type: 0 },
    declarations: parseInlineDeclarations(el.style),
    source: "inline style attribute",
    sourceType: "inline",
    href: null,
    media: null,
    line: null,
    order: orderStart + i,
    sourceOrder: 1e9,
  }));
}

function parseInlineDeclarations(styleText) {
  const decls = [];
  const parts = styleText.split(";");
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const property = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    if (!property || !value) continue;
    const important = /!important\s*$/i.test(value);
    if (important) value = value.replace(/!important\s*$/i, "").trim();
    decls.push({ property, value, important, line: null });
  }
  return decls;
}

function atRuleBlocksAsRules(atRuleBlocks) {
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

function parseErrorFindings(parseErrors) {
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
