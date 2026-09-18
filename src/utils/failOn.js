const GRADE_RANK = { A: 4, B: 3, C: 2, D: 1, F: 0 };

/**
 * Parses a --fail-on value into a threshold: either a letter grade
 * ("B" -> fail if the result is worse than B, i.e. C/D/F) or a numeric
 * score out of 100 ("70" -> fail if score < 70). Using the same 0-100
 * score/grade the reports already show means one flag works identically
 * for both the CSS audit and the accessibility audit.
 */
export function parseFailOn(value) {
  if (/^[A-Fa-f]$/.test(value)) {
    return { kind: "grade", value: value.toUpperCase() };
  }
  if (/^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 100) {
    return { kind: "score", value: Number(value) };
  }
  throw new Error(`Invalid --fail-on value "${value}". Use a letter grade (A-F) or a number 0-100.`);
}

export function shouldFail({ score, grade }, threshold) {
  if (threshold.kind === "score") return score < threshold.value;
  return GRADE_RANK[grade] < GRADE_RANK[threshold.value];
}
