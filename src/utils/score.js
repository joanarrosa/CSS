const GRADE_THRESHOLDS = [
  [90, "A"],
  [75, "B"],
  [60, "C"],
  [40, "D"],
];

/**
 * Shared 0-100 score curve: 0 penalty -> 100, approaching 0 asymptotically
 * as penalty grows (rational decay), so there's no clamping and no single
 * pass/fail cliff. Used by both the CSS audit score and the accessibility
 * audit score so "100" and "F" mean the same thing in both reports.
 */
export function scoreFromPenalty(penalty) {
  const score = Math.round(100 / (1 + penalty / 30));
  const grade = GRADE_THRESHOLDS.find(([min]) => score >= min)?.[1] ?? "F";
  return { score, grade };
}
