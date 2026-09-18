let counter = 0;

/**
 * Shared finding shape used by every analyzer and by both report renderers.
 *
 * @param {object} f
 * @param {string} f.category one of: duplicates, overrides, specificity, unused, best-practices, accessibility, performance
 * @param {'high'|'medium'|'low'} f.severity
 * @param {string} f.selector the selector/rule involved
 * @param {string} f.source file/<style> block label
 * @param {number|null} [f.line]
 * @param {string} f.message what's wrong
 * @param {string} f.suggestion concrete suggested fix
 * @param {object} [f.meta] extra structured data (kept out of default terminal output)
 */
export function makeFinding(f) {
  return {
    id: `f${counter++}`,
    category: f.category,
    severity: f.severity || "medium",
    selector: f.selector || null,
    source: f.source || null,
    line: f.line ?? null,
    message: f.message,
    suggestion: f.suggestion || null,
    meta: f.meta || {},
  };
}

export const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };
