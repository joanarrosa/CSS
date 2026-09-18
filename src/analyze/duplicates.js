import { makeFinding } from "../utils/finding.js";

const MERGE_THRESHOLD = 3; // same property:value repeated across >= N different selectors

/**
 * Finds:
 *  - identical selectors defined more than once (possibly with conflicting values)
 *  - the same property:value pair repeated across many different selectors,
 *    which could be merged into a shared class
 */
export function analyzeDuplicates(rules) {
  const findings = [];

  // --- Identical selector text defined multiple times ---
  const bySelector = new Map();
  for (const rule of rules) {
    const key = `${rule.media || ""}::${rule.selector}`;
    if (!bySelector.has(key)) bySelector.set(key, []);
    bySelector.get(key).push(rule);
  }

  for (const [, occurrences] of bySelector) {
    if (occurrences.length < 2) continue;
    const locations = occurrences.map((r) => `${r.source}${r.line ? `:${r.line}` : ""}`);
    const selector = occurrences[0].selector;

    // Check whether later occurrences redefine the same property with a
    // different value (true conflict) vs. just repeating/extending.
    const propValues = new Map(); // property -> Set of values seen
    for (const occ of occurrences) {
      for (const decl of occ.declarations) {
        if (!propValues.has(decl.property)) propValues.set(decl.property, new Set());
        propValues.get(decl.property).add(decl.value);
      }
    }
    const conflicting = [...propValues.entries()].filter(([, values]) => values.size > 1);

    findings.push(
      makeFinding({
        category: "duplicates",
        severity: conflicting.length > 0 ? "high" : "medium",
        type: conflicting.length > 0 ? "error" : "improvement",
        selector,
        source: occurrences[occurrences.length - 1].source,
        line: occurrences[occurrences.length - 1].line,
        message:
          conflicting.length > 0
            ? `Selector "${selector}" is defined ${occurrences.length} times at ${locations.join(
                ", "
              )}, with conflicting values for: ${conflicting.map(([p]) => p).join(", ")}.`
            : `Selector "${selector}" is defined ${occurrences.length} times at ${locations.join(", ")}.`,
        suggestion: `Merge these into a single "${selector}" rule to avoid relying on source order for which declarations win.`,
        meta: { occurrences: locations, conflicting: conflicting.map(([p]) => p) },
      })
    );
  }

  // --- Same property:value pair repeated across many different selectors ---
  const byPropValue = new Map();
  for (const rule of rules) {
    for (const decl of rule.declarations) {
      const key = `${decl.property}:${decl.value}`;
      if (!byPropValue.has(key)) byPropValue.set(key, []);
      byPropValue.get(key).push(rule.selector);
    }
  }

  for (const [key, selectors] of byPropValue) {
    const uniqueSelectors = [...new Set(selectors)];
    if (uniqueSelectors.length < MERGE_THRESHOLD) continue;
    const [property, ...valueParts] = key.split(":");
    const value = valueParts.join(":");
    findings.push(
      makeFinding({
        category: "duplicates",
        severity: "low",
        type: "improvement",
        selector: uniqueSelectors.slice(0, 6).join(", ") + (uniqueSelectors.length > 6 ? ", ..." : ""),
        source: null,
        line: null,
        message: `"${property}: ${value}" is repeated identically across ${uniqueSelectors.length} different selectors.`,
        suggestion: `Consider extracting a shared utility class (e.g. ".u-${property}") or a CSS custom property for "${property}: ${value}" to reduce repetition.`,
        meta: { property, value, selectors: uniqueSelectors },
      })
    );
  }

  return findings;
}
