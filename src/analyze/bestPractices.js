import { makeFinding } from "../utils/finding.js";

const UNIT_TRACKED_PROPERTIES = ["font-size", "line-height", "margin", "padding", "width", "height", "border-radius", "gap"];
const NESTING_DEPTH_WARNING = 5;
const VENDOR_PREFIXES = ["-webkit-", "-moz-", "-ms-", "-o-"];
const COLOR_VALUE_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))$/i;
const SIMPLE_LENGTH_RE = /^-?[\d.]+([a-z%]+)$/i;
const HARDCODED_COLOR_MIN_OCCURRENCES = 3;
const Z_INDEX_MAGIC_THRESHOLD = 1000;

export function analyzeBestPractices(rules) {
  const findings = [];

  findings.push(...checkDeepNesting(rules));
  findings.push(...checkInconsistentUnits(rules));
  findings.push(...checkVendorPrefixes(rules));
  findings.push(...checkMagicNumbers(rules));

  return findings;
}

function selectorDepth(selector) {
  // Count combinator-separated compound selectors, ignoring commas (already split) and pseudo args.
  const stripped = selector.replace(/\([^)]*\)/g, "");
  const parts = stripped.split(/\s+|(?=[>+~])|(?<=[>+~])/).map((s) => s.trim()).filter(Boolean);
  return parts.filter((p) => p !== ">" && p !== "+" && p !== "~").length;
}

function checkDeepNesting(rules) {
  const findings = [];
  for (const rule of rules) {
    const depth = selectorDepth(rule.selector);
    if (depth >= NESTING_DEPTH_WARNING) {
      findings.push(
        makeFinding({
          category: "best-practices",
          severity: "low",
          type: "improvement",
          selector: rule.selector,
          source: rule.source,
          line: rule.line,
          message: `Deeply nested selector "${rule.selector}" chains ${depth} compound selectors, making it fragile and hard to read.`,
          suggestion: `Flatten this by adding a dedicated class to the target element instead of relying on DOM structure.`,
        })
      );
    }
  }
  return findings;
}

function checkInconsistentUnits(rules) {
  const findings = [];
  const byProperty = new Map(); // property -> Map(unit -> count)

  for (const rule of rules) {
    for (const decl of rule.declarations) {
      if (!UNIT_TRACKED_PROPERTIES.includes(decl.property)) continue;
      const m = decl.value.match(SIMPLE_LENGTH_RE);
      if (!m) continue;
      const unit = m[1].toLowerCase();
      if (unit === "%") continue; // percentages are often intentionally distinct
      if (!byProperty.has(decl.property)) byProperty.set(decl.property, new Map());
      const unitMap = byProperty.get(decl.property);
      unitMap.set(unit, (unitMap.get(unit) || 0) + 1);
    }
  }

  for (const [property, unitMap] of byProperty) {
    if (unitMap.size < 2) continue;
    const summary = [...unitMap.entries()].map(([u, c]) => `${u} (${c}x)`).join(", ");
    findings.push(
      makeFinding({
        category: "best-practices",
        severity: "low",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `Inconsistent units for "${property}": ${summary}.`,
        suggestion: `Standardize on one unit (typically rem for typography, px or rem for spacing) for "${property}" across the stylesheet.`,
        meta: { property, units: Object.fromEntries(unitMap) },
      })
    );
  }

  return findings;
}

function checkVendorPrefixes(rules) {
  const findings = [];
  for (const rule of rules) {
    const props = new Set(rule.declarations.map((d) => d.property));
    for (const decl of rule.declarations) {
      const prefix = VENDOR_PREFIXES.find((p) => decl.property.startsWith(p));
      if (!prefix) continue;
      const standard = decl.property.slice(prefix.length);
      if (!props.has(standard)) {
        findings.push(
          makeFinding({
            category: "best-practices",
            severity: "low",
            type: "improvement",
            selector: rule.selector,
            source: rule.source,
            line: decl.line || rule.line,
            message: `"${decl.property}" is set in "${rule.selector}" without a standard "${standard}" fallback declaration in the same rule.`,
            suggestion: `Add the unprefixed "${standard}" declaration alongside "${decl.property}" (modern browsers rarely need the prefix, but omitting the standard property risks inconsistent rendering).`,
          })
        );
      }
    }
  }
  return findings;
}

function checkMagicNumbers(rules) {
  const findings = [];
  const colorCounts = new Map();
  let usesCustomProperties = false;

  for (const rule of rules) {
    for (const decl of rule.declarations) {
      if (decl.property.startsWith("--") || decl.value.includes("var(")) usesCustomProperties = true;
      if (COLOR_VALUE_RE.test(decl.value.trim())) {
        const key = decl.value.trim().toLowerCase();
        if (!colorCounts.has(key)) colorCounts.set(key, []);
        colorCounts.get(key).push(rule.selector);
      }
      if (decl.property === "z-index") {
        const n = Number(decl.value);
        if (!Number.isNaN(n) && Math.abs(n) >= Z_INDEX_MAGIC_THRESHOLD) {
          findings.push(
            makeFinding({
              category: "best-practices",
              severity: "low",
              type: "improvement",
              selector: rule.selector,
              source: rule.source,
              line: decl.line || rule.line,
              message: `Suspicious magic-number z-index "${decl.value}" on "${rule.selector}".`,
              suggestion: `Use a small, documented z-index scale (e.g. a set of CSS custom properties like --z-modal: 40) instead of arbitrary large numbers.`,
            })
          );
        }
      }
    }
  }

  if (!usesCustomProperties) {
    const repeated = [...colorCounts.entries()].filter(([, sels]) => sels.length >= HARDCODED_COLOR_MIN_OCCURRENCES);
    if (repeated.length > 0) {
      const totalUses = repeated.reduce((sum, [, sels]) => sum + sels.length, 0);
      findings.push(
        makeFinding({
          category: "best-practices",
          severity: "medium",
          type: "improvement",
          selector: null,
          source: null,
          line: null,
          message: `This stylesheet doesn't use CSS custom properties (variables) anywhere, yet ${repeated.length} distinct color values are hardcoded and repeated (${totalUses} total occurrences).`,
          suggestion: `Define reusable colors as custom properties on :root (e.g. --color-primary: ${repeated[0][0]};) and reference them with var(...) instead of repeating literal values.`,
          meta: { colors: repeated.map(([color, sels]) => ({ color, count: sels.length })) },
        })
      );
    }
  }

  return findings;
}
