import type { WcagLevel } from "../types.js";

/**
 * axe-core tags encode WCAG success criteria as "wcag" + the SC number with
 * dots removed (1.4.3 -> "wcag143", 2.4.11 -> "wcag2411", 4.1.2 -> "wcag412").
 * The pattern is unambiguous: 1 digit principle, 1 digit guideline, then a
 * 1-2 digit criterion number. Parsing this directly off axe's own tags is
 * far more reliable than hand-maintaining a rule-id -> SC lookup table for
 * axe's 90+ rules (and stays correct as axe adds rules).
 */
export function wcagCriteriaFromTags(tags: string[]): string[] {
  const found = new Set<string>();
  for (const tag of tags) {
    const m = tag.match(/^wcag(\d)(\d)(\d{1,2})$/);
    if (m) found.add(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...found].sort();
}

export function wcagLevelFromTags(tags: string[]): WcagLevel {
  if (tags.includes("wcag2aaa") || tags.includes("wcag21aaa") || tags.includes("wcag22aaa")) return "AAA";
  if (tags.includes("wcag2aa") || tags.includes("wcag21aa") || tags.includes("wcag22aa")) return "AA";
  return "A";
}

/**
 * EN 301 549 clause 9 ("Web") adopts WCAG 2.1 A/AA by direct reference, with
 * clause numbers of the form 9.{WCAG SC}. axe-core doesn't ship EN 301 549
 * tags itself (that mapping is a paid Deque add-on), so this derives the
 * clause number structurally from the WCAG SC — accurate for the common
 * case (EN 301 549 doesn't add its own extra SCs beyond WCAG 2.1 AA), not a
 * substitute for a compliance lawyer's sign-off on edge cases.
 */
export function en301549FromWcag(criteria: string[], level: WcagLevel): string | undefined {
  if (level === "AAA" || criteria.length === 0) return undefined;
  return `EN 301 549 §9.${criteria[0]}`;
}
