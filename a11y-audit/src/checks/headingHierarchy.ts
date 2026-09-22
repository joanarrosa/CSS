import type { Page } from "playwright";
import type { Finding } from "../types.js";

interface RawHeading {
  level: number;
  text: string;
  selector: string;
  outerHTML: string;
}

/**
 * Validates document heading structure: exactly one <h1>, and no level
 * skipped going deeper (h2 -> h4 with no h3 in between). axe-core's
 * "heading-order" rule only catches skipped levels, not the "how many h1s"
 * question, and doesn't explain the skip in plain terms — this does both
 * from a single DOM walk.
 */
export async function checkHeadingHierarchy(page: Page, ctx: { pageName: string; url: string; viewport: string; flow?: string }): Promise<Finding[]> {
  const headings = await page.evaluate<RawHeading[]>(() => {
    function cssPath(el: Element): string {
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && depth < 4) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) {
          parts.unshift(`${part}#${cur.id}`);
          break;
        }
        if (cur.className && typeof cur.className === "string") {
          const cls = cur.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (cls) part += `.${cls}`;
        }
        parts.unshift(part);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }

    const nodes = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading'][aria-level]"));
    return nodes.map((el) => {
      const ariaLevel = el.getAttribute("aria-level");
      const level = ariaLevel ? parseInt(ariaLevel, 10) : parseInt(el.tagName.slice(1), 10);
      return {
        level,
        text: (el.textContent || "").trim().slice(0, 80),
        selector: cssPath(el),
        outerHTML: el.outerHTML.slice(0, 200),
      };
    });
  });

  const findings: Finding[] = [];
  const base = { page: ctx.pageName, url: ctx.url, viewport: ctx.viewport, flow: ctx.flow, source: "heading-hierarchy" as const };

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    findings.push({
      ...base,
      id: `heading-missing-h1-${ctx.pageName}-${ctx.viewport}`,
      ruleId: "heading-missing-h1",
      wcagCriteria: ["1.3.1", "2.4.6"],
      wcagLevel: "A",
      severity: "serious",
      impact: 3,
      effort: 1,
      title: "Page has no <h1>",
      description: "No top-level heading (<h1>) was found. Screen reader users rely on the h1 to confirm what page they've landed on and to jump straight to the main content via heading navigation.",
      target: ["body"],
      fix: `Add exactly one <h1> that describes the page's main content, e.g. <h1>${escapeForFix(ctx.pageName)}</h1>.`,
      occurrences: 1,
    });
  } else if (h1s.length > 1) {
    findings.push({
      ...base,
      id: `heading-multiple-h1-${ctx.pageName}-${ctx.viewport}`,
      ruleId: "heading-multiple-h1",
      wcagCriteria: ["1.3.1"],
      wcagLevel: "A",
      severity: "moderate",
      impact: 2,
      effort: 2,
      title: `Page has ${h1s.length} <h1> elements`,
      description: `Found ${h1s.length} <h1> elements: ${h1s.map((h) => `"${h.text}"`).join(", ")}. Multiple h1s make it unclear what the page's single main topic is when navigating by heading.`,
      target: h1s.map((h) => h.selector),
      snippet: h1s[1]?.outerHTML,
      fix: "Keep one <h1> for the page's main heading; change the others to <h2> or lower depending on their place in the outline.",
      occurrences: h1s.length,
    });
  }

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const cur = headings[i];
    if (cur.level > prev.level + 1) {
      findings.push({
        ...base,
        id: `heading-skip-${ctx.pageName}-${ctx.viewport}-${i}`,
        ruleId: "heading-skipped-level",
        wcagCriteria: ["1.3.1", "2.4.6"],
        wcagLevel: "A",
        severity: "moderate",
        impact: 2,
        effort: 2,
        title: `Heading level skipped: h${prev.level} → h${cur.level}`,
        description: `"${cur.text}" is an h${cur.level} directly after "${prev.text}" (h${prev.level}), skipping h${prev.level + 1}. Screen reader users navigating by heading level expect a step-by-step outline; a skip can make them think content is missing.`,
        target: [cur.selector],
        snippet: cur.outerHTML,
        fix: `Change this heading to h${prev.level + 1}, or add an intermediate h${prev.level + 1} heading before it if the outline genuinely needs one.`,
        occurrences: 1,
      });
    }
  }

  return findings;
}

function escapeForFix(str: string): string {
  return str.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
}
