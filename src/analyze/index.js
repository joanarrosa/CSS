import { parseAllSources } from "../parseCss.js";
import { matchRulesAgainstDom } from "../domMatch.js";
import { analyzeDuplicates } from "./duplicates.js";
import { analyzeOverrides } from "./overrides.js";
import { analyzeSpecificity } from "./specificityIssues.js";
import { analyzeUnused } from "./unused.js";
import { analyzeBestPractices } from "./bestPractices.js";
import { analyzeAccessibility } from "./accessibility.js";
import { analyzePerformance } from "./performance.js";
import { info } from "../utils/logger.js";
import { partitionIgnored } from "../config.js";
import { computeAutoFixes } from "../autofix.js";
import { inlineStyleElementsToRules } from "../utils/inlineStyle.js";
import { buildSelectorMatches, atRuleBlocksAsRules, parseErrorFindings } from "./helpers.js";

export { buildSelectorMatches, atRuleBlocksAsRules, parseErrorFindings };

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
    // Per-selector match data (not just the findings derived from it) — used by
    // crawl.js to correctly reconcile "unused" across multiple pages: a finding
    // alone can't tell you a selector matched, since a used selector with no
    // other issues produces no finding at all.
    selectorMatches: buildSelectorMatches(domResult),
    autoFix: computeAutoFixes({ rules, domResult, cssSources }),
  };
}
