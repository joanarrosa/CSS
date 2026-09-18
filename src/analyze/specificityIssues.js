import { makeFinding } from "../utils/finding.js";
import { specificityToString } from "../utils/specificity.js";

const HIGH_SPECIFICITY_CLASS_THRESHOLD = 4; // e.g. .a.b.c.d
const IMPORTANT_COUNT_WARNING = 5;

export function analyzeSpecificity(rules) {
  const findings = [];
  let importantCount = 0;
  const importantSelectors = [];

  for (const rule of rules) {
    const spec = rule.specificityObj;

    const importantDecls = rule.declarations.filter((d) => d.important);
    if (importantDecls.length > 0) {
      importantCount += importantDecls.length;
      importantSelectors.push(rule.selector);
      findings.push(
        makeFinding({
          category: "specificity",
          severity: spec.id === 0 && spec.class <= 1 ? "high" : "medium",
          selector: rule.selector,
          source: rule.source,
          line: rule.line,
          message: `!important used on ${importantDecls
            .map((d) => d.property)
            .join(", ")} in "${rule.selector}" (specificity ${specificityToString(spec)}).`,
          suggestion:
            spec.id === 0 && spec.class <= 1
              ? `This selector has low specificity, so !important is likely masking a specificity fight elsewhere. Increase the selector's specificity or restructure the cascade instead of forcing it with !important.`
              : `Remove !important and let normal cascade rules (source order + specificity) decide the winner, or refactor the conflicting rule.`,
          meta: { properties: importantDecls.map((d) => d.property) },
        })
      );
    }

    if (spec.id > 0) {
      findings.push(
        makeFinding({
          category: "specificity",
          severity: spec.id > 1 ? "high" : "medium",
          selector: rule.selector,
          source: rule.source,
          line: rule.line,
          message: `ID selector used for styling in "${rule.selector}" (specificity ${specificityToString(
            spec
          )}). IDs are hard to override and hurt reusability.`,
          suggestion: buildIdSuggestion(rule.selector),
        })
      );
    }

    if (spec.class >= HIGH_SPECIFICITY_CLASS_THRESHOLD || spec.id + spec.class >= HIGH_SPECIFICITY_CLASS_THRESHOLD + 1) {
      findings.push(
        makeFinding({
          category: "specificity",
          severity: "medium",
          selector: rule.selector,
          source: rule.source,
          line: rule.line,
          message: `Overly specific selector "${rule.selector}" (specificity ${specificityToString(
            spec
          )}). High specificity makes future overrides harder.`,
          suggestion: `Simplify to a single well-named class, e.g. extract the combination into one class instead of chaining selectors.`,
        })
      );
    }
  }

  if (importantCount >= IMPORTANT_COUNT_WARNING) {
    findings.push(
      makeFinding({
        category: "specificity",
        severity: "high",
        selector: null,
        source: null,
        line: null,
        message: `!important is used ${importantCount} times across ${new Set(importantSelectors).size} selectors. Heavy !important use is a sign the cascade/specificity structure needs rethinking.`,
        suggestion: `Audit and reduce !important usage; prefer more specific but natural selectors or reorganize source order so overrides aren't needed.`,
        meta: { count: importantCount },
      })
    );
  }

  return findings;
}

function buildIdSuggestion(selector) {
  const idMatches = selector.match(/#[\w-]+/g) || [];
  if (idMatches.length === 0) return `Replace the ID selector with a class.`;
  const replaced = selector.replace(/#([\w-]+)/g, (_, name) => `.${name}`);
  return `Replace the ID selector${idMatches.length > 1 ? "s" : ""} with a class, e.g. "${replaced}".`;
}
