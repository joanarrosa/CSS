import { makeFinding } from "../utils/finding.js";
import { PSEUDO_ELEMENT_RE } from "../domMatch.js";

// Selectors that are inherently state/JS-driven and won't match in a static
// snapshot even when they're actively used (:hover, :focus, [aria-expanded=true], ...).
const DYNAMIC_PSEUDO_RE = /:(hover|focus|focus-visible|focus-within|active|visited|target|checked|indeterminate|disabled|enabled|invalid|valid|required|optional|placeholder-shown|empty|in-range|out-of-range)\b/i;

export function analyzeUnused(domResult) {
  const findings = [];
  const { rules, matchCounts, truncated } = domResult;

  let unusedCount = 0;
  let checkedCount = 0;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.sourceType === "inline") continue; // inline style="" always "matches" its own element by definition
    const count = matchCounts[i];
    if (count === null || count === undefined) continue; // couldn't evaluate (invalid selector or inactive media)
    checkedCount++;
    if (count > 0) continue;

    const isDynamic = DYNAMIC_PSEUDO_RE.test(rule.selector);
    PSEUDO_ELEMENT_RE.lastIndex = 0;
    const isPseudoEl = PSEUDO_ELEMENT_RE.test(rule.selector);
    PSEUDO_ELEMENT_RE.lastIndex = 0;
    unusedCount++;

    findings.push(
      makeFinding({
        category: "unused",
        severity: isDynamic || isPseudoEl ? "low" : "medium",
        type: "improvement",
        selector: rule.selector,
        source: rule.source,
        line: rule.line,
        message: isDynamic
          ? `"${rule.selector}" doesn't match any element in the current DOM state (it targets a dynamic state, so this may be a false positive if that state is reachable via user interaction).`
          : isPseudoEl
          ? `"${rule.selector}" targets a pseudo-element whose base selector doesn't match any element in the DOM.`
          : `"${rule.selector}" doesn't match any element currently rendered on the page.`,
        suggestion: isDynamic
          ? `Verify manually by triggering the state (hover/focus/etc.); if truly unreachable, remove it.`
          : `Remove this selector if it's dead code, or double check it's not a typo (e.g. mismatched class name) for an element that does exist.`,
      })
    );
  }

  if (truncated) {
    findings.push(
      makeFinding({
        category: "unused",
        severity: "low",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `The stylesheet has more rules than this tool checks in one pass; unused-CSS detection was run on a subset of rules.`,
        suggestion: `Consider splitting very large stylesheets or re-running with a narrower scope for full coverage.`,
      })
    );
  }

  if (unusedCount > 0 && checkedCount > 0) {
    findings.push(
      makeFinding({
        category: "unused",
        severity: unusedCount > checkedCount * 0.3 ? "high" : "medium",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `${unusedCount} of ${checkedCount} checked selectors (${Math.round(
          (unusedCount / checkedCount) * 100
        )}%) don't match anything on this page.`,
        suggestion: `Note this snapshot only reflects one page/viewport/state — a selector unused here may still be used on other pages or states of this site. Cross-check before deleting broadly, or use a coverage tool across your full site.`,
        meta: { unusedCount, totalChecked: checkedCount },
      })
    );
  }

  return findings;
}
