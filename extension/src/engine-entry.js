// Bundled by esbuild into extension/dist/engine.js (a single classic script,
// no ES module syntax survives) and injected into the inspected tab. Reuses
// the exact same parsing/analysis engine the CLI and web UI run — only the
// "collection" layer differs, because here we're already running inside the
// page instead of driving it through Playwright.
import { parseAllSources } from "../../src/parseCss.js";
import { buildRuleDescriptors, matchRulesInPage } from "../../src/domMatch.js";
import { analyzeDuplicates } from "../../src/analyze/duplicates.js";
import { analyzeOverrides } from "../../src/analyze/overrides.js";
import { analyzeSpecificity } from "../../src/analyze/specificityIssues.js";
import { analyzeUnused } from "../../src/analyze/unused.js";
import { analyzeBestPractices } from "../../src/analyze/bestPractices.js";
import { sampleAccessibilityInPage, buildAccessibilityFindings } from "../../src/analyze/accessibility.js";
import { analyzePerformance } from "../../src/analyze/performance.js";
import { atRuleBlocksAsRules, parseErrorFindings, buildSelectorMatches } from "../../src/analyze/helpers.js";
import { buildSummary } from "../../src/report/summary.js";
import { computeAutoFixes } from "../../src/autofix.js";
import { inlineStyleElementsToRules } from "../../src/utils/inlineStyle.js";
import { isThirdPartyAdOrTracking } from "../../src/utils/thirdParty.js";

const MAX_A11Y_SAMPLES = 1500;

// Step 1 (called from the popup via chrome.scripting.executeScript's `func`):
// gather everything readable straight from the live DOM without a network
// request — <style> text, inline style="" attributes, and the *list* of
// linked stylesheet URLs. Fetching those URLs has to happen from the popup's
// own extension-page context (see popup.js) — a content script's fetch() is
// still bound by the page's own CORS policy, only an extension page's fetch
// (backed by host_permissions) can read cross-origin stylesheets the page
// itself couldn't.
function collectRefs() {
  const styleBlocks = [...document.querySelectorAll("style")].map((n, i) => ({
    index: i,
    text: n.textContent || "",
    media: n.getAttribute("media") || "",
  }));

  const linkEls = [...document.querySelectorAll('link[rel~="stylesheet"]')]
    .filter((n) => !n.disabled && n.href)
    .map((n, i) => ({ index: i, href: n.href }));

  let excludedThirdParty = 0;
  const linksToFetch = linkEls.filter((l) => {
    let hostname = "";
    try {
      hostname = new URL(l.href).hostname;
    } catch {
      /* ignore */
    }
    if (isThirdPartyAdOrTracking(hostname)) {
      excludedThirdParty++;
      return false;
    }
    return true;
  });

  function cssPath(node) {
    const parts = [];
    let cur = node;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${cur.id}`;
        parts.unshift(part);
        break;
      } else if (cur.className && typeof cur.className === "string") {
        const cls = cur.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (cls) part += `.${cls}`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  const inlineStyleElements = [...document.querySelectorAll("[style]")]
    .map((el, i) => ({ index: i, selector: cssPath(el), style: el.getAttribute("style") || "" }))
    .filter((el) => el.style.trim());

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    pageHostname: location.hostname,
    styleBlocks,
    linksToFetch,
    inlineStyleElements,
    excludedThirdParty,
  };
}

// Step 2 (called from the popup after it has fetched every linked
// stylesheet's raw text): parse + analyze, exactly like the CLI does.
function runAnalysis(styleBlocks, fetchedLinks, inlineStyleElements, pageHostname) {
  const cssSources = [];
  const warnings = [];
  let order = 0;

  for (const block of styleBlocks) {
    if (!block.text.trim()) continue;
    cssSources.push({
      id: `style-${block.index}`,
      type: "style",
      label: `<style> block #${block.index + 1}`,
      href: null,
      media: block.media,
      text: block.text,
      order: order++,
    });
  }

  for (const link of fetchedLinks) {
    if (!link.ok) {
      warnings.push(`Could not fetch stylesheet: ${link.href}${link.error ? ` (${link.error})` : ""}`);
      continue;
    }
    let hostname = "";
    try {
      hostname = new URL(link.href).hostname;
    } catch {
      /* ignore */
    }
    cssSources.push({
      id: `link-${cssSources.length}`,
      type: "link",
      label: link.href,
      href: link.href,
      media: "",
      text: link.text,
      order: order++,
      crossOrigin: hostname && hostname !== pageHostname,
    });
  }

  if (cssSources.length === 0) {
    warnings.push("No CSS was found on this page (no <style> blocks or fetchable stylesheets).");
  }

  const { rules: parsedRules, parseErrors, atRuleBlocks } = parseAllSources(cssSources);
  const inlineRules = inlineStyleElementsToRules(inlineStyleElements, parsedRules.length);
  const rules = [...parsedRules, ...inlineRules];

  const { descriptors, usable, truncated } = buildRuleDescriptors(rules);
  const matched = matchRulesInPage(descriptors);
  const domResult = { matchCounts: matched.matchCounts, overrides: matched.overrides, rules: usable, truncated };

  const a11ySamples = sampleAccessibilityInPage(MAX_A11Y_SAMPLES);

  const findings = [
    ...analyzeDuplicates(rules),
    ...analyzeOverrides(domResult),
    ...analyzeSpecificity(rules),
    ...analyzeUnused(domResult),
    ...analyzeBestPractices([...rules, ...atRuleBlocksAsRules(atRuleBlocks)]),
    ...buildAccessibilityFindings(a11ySamples),
    ...analyzePerformance(cssSources, parsedRules),
    ...parseErrorFindings(parseErrors),
  ];

  const summary = buildSummary(findings);
  const autoFix = computeAutoFixes({ rules, domResult, cssSources });

  return {
    findings,
    summary,
    stats: { totalRules: rules.length, totalSources: cssSources.length, parseErrors: parseErrors.length },
    warnings,
    selectorMatches: buildSelectorMatches(domResult),
    autoFix: {
      applied: autoFix.applied,
      skipped: autoFix.skipped,
      // Fixed CSS text keyed by source label, for the popup's "download fixed CSS" button.
      fixedSources: autoFix.fixedSources.map((f) => ({ source: f.source, fixed: f.fixed })),
    },
  };
}

window.CssAuditEngine = { collectRefs, runAnalysis };
