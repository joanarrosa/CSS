import { makeFinding } from "../utils/finding.js";

const LARGE_STYLESHEET_BYTES = 150 * 1024;
const VERY_LARGE_STYLESHEET_BYTES = 300 * 1024;
const RENDER_BLOCKING_WARNING_COUNT = 3;
const HIGH_SELECTOR_COUNT = 4000;

// TextEncoder (not Buffer) so this works unmodified in a browser too — this
// module is bundled as-is into the browser extension.
const encoder = new TextEncoder();
function byteLength(str) {
  return encoder.encode(str).length;
}

export function analyzePerformance(cssSources, rules) {
  const findings = [];

  const totalBytes = cssSources.reduce((sum, s) => sum + byteLength(s.text), 0);
  if (totalBytes >= LARGE_STYLESHEET_BYTES) {
    findings.push(
      makeFinding({
        category: "performance",
        severity: totalBytes >= VERY_LARGE_STYLESHEET_BYTES ? "high" : "medium",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `Total CSS payload is ${(totalBytes / 1024).toFixed(1)} KB across ${cssSources.length} source${
          cssSources.length !== 1 ? "s" : ""
        }, which is large and will delay first paint.`,
        suggestion: `Remove unused CSS (see the Unused section), split into critical vs. non-critical CSS, and consider minifying/compressing stylesheets.`,
        meta: { totalBytes },
      })
    );
  }

  for (const s of cssSources) {
    const bytes = byteLength(s.text);
    if (bytes >= VERY_LARGE_STYLESHEET_BYTES) {
      findings.push(
        makeFinding({
          category: "performance",
          severity: "medium",
          type: "improvement",
          selector: null,
          source: s.label,
          line: null,
          message: `"${s.label}" alone is ${(bytes / 1024).toFixed(1)} KB.`,
          suggestion: `Consider splitting this stylesheet by route/component so pages only load the CSS they need.`,
        })
      );
    }
  }

  const renderBlocking = cssSources.filter(
    (s) => s.type === "link" && (!s.media || s.media === "all" || s.media === "screen")
  );
  if (renderBlocking.length >= RENDER_BLOCKING_WARNING_COUNT) {
    findings.push(
      makeFinding({
        category: "performance",
        severity: "medium",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `${renderBlocking.length} linked stylesheets load render-blocking (no "print" or non-matching media restricting them).`,
        suggestion: `Combine stylesheets where practical, inline critical above-the-fold CSS, and defer non-critical stylesheets with the media="print" onload swap pattern or <link rel="preload" as="style">.`,
        meta: { hrefs: renderBlocking.map((s) => s.href) },
      })
    );
  }

  if (rules.length >= HIGH_SELECTOR_COUNT) {
    findings.push(
      makeFinding({
        category: "performance",
        severity: "medium",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `${rules.length} selectors were found across all stylesheets — an unusually high count that increases parse/match cost and maintenance burden.`,
        suggestion: `Audit for unused and duplicate rules (see those sections) to shrink the effective selector count.`,
      })
    );
  }

  const crossOriginCount = cssSources.filter((s) => s.crossOrigin).length;
  if (crossOriginCount >= 3) {
    findings.push(
      makeFinding({
        category: "performance",
        severity: "low",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `${crossOriginCount} stylesheets are loaded from third-party origins, each requiring its own DNS/TLS connection setup.`,
        suggestion: `Use <link rel="preconnect"> for critical third-party CSS origins, or self-host frequently used third-party stylesheets/fonts.`,
      })
    );
  }

  return findings;
}
