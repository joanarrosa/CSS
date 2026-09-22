import type { Page } from "playwright";
import type { Finding } from "../types.js";

interface LiveRegionInfo {
  selector: string;
  outerHTML: string;
  ariaLive: string | null;
  role: string | null;
  ariaAtomic: string | null;
  isEmpty: boolean;
}

/**
 * axe-core validates that aria-live/role="alert"/role="status" attribute
 * *values* are valid, but it can't tell you whether the content they'll
 * announce is actually meaningful — that requires a screen reader actually
 * reading it aloud while the app runs. This inventories every live region
 * found and flags the specific static-analysis smells that make a wrong
 * announcement likely, then routes the rest to the manual checklist.
 */
export async function checkLiveRegions(
  page: Page,
  ctx: { pageName: string; url: string; viewport: string; flow?: string }
): Promise<Finding[]> {
  const regions = await page.evaluate<LiveRegionInfo[]>(() => {
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

    const els = Array.from(document.querySelectorAll('[aria-live], [role="alert"], [role="status"], [role="log"]'));
    return els.map((el) => ({
      selector: cssPath(el),
      outerHTML: el.outerHTML.slice(0, 250),
      ariaLive: el.getAttribute("aria-live"),
      role: el.getAttribute("role"),
      ariaAtomic: el.getAttribute("aria-atomic"),
      isEmpty: (el.textContent || "").trim().length === 0,
    }));
  });

  const findings: Finding[] = [];
  const base = { page: ctx.pageName, url: ctx.url, viewport: ctx.viewport, flow: ctx.flow, source: "live-region" as const };

  for (const r of regions) {
    if (r.ariaLive === "off") {
      findings.push({
        ...base,
        id: `live-region-off-${ctx.pageName}-${ctx.viewport}-${r.selector}`,
        ruleId: "live-region-aria-live-off",
        wcagCriteria: ["4.1.3"],
        wcagLevel: "AA",
        severity: "minor",
        impact: 1,
        effort: 1,
        title: `aria-live="off" on ${r.selector} makes it a no-op`,
        description: `This element has aria-live="off", which is the default anyway — as written it will never announce anything to screen reader users. If it's meant to announce dynamic updates, this is effectively silencing it.`,
        target: [r.selector],
        snippet: r.outerHTML,
        fix: `Remove the aria-live attribute if this region should never announce (that's the default and this is redundant), or change it to aria-live="polite" (or "assertive" for urgent/error messages) if updates here should be announced.`,
        occurrences: 1,
      });
      continue;
    }

    findings.push({
      ...base,
      id: `live-region-review-${ctx.pageName}-${ctx.viewport}-${r.selector}`,
      ruleId: "live-region-needs-manual-review",
      wcagCriteria: ["4.1.3"],
      wcagLevel: "AA",
      severity: "minor",
      impact: 2,
      effort: 1,
      isBonusAAA: false,
      title: `Live region found — verify announcement quality manually: ${r.selector}`,
      description:
        `${r.role ? `role="${r.role}"` : `aria-live="${r.ariaLive}"`} on ${r.selector}` +
        `${r.isEmpty ? " is empty at page load (expected if it only fills in after an interaction — trigger that interaction and listen with a screen reader to confirm what gets announced)." : `, currently contains: "${r.outerHTML.replace(/<[^>]+>/g, "").trim().slice(0, 80)}".`}` +
        `${r.ariaAtomic !== "true" ? " No aria-atomic=\"true\" — if only part of this region's text changes, a screen reader may only announce the changed fragment out of context." : ""}`,
      target: [r.selector],
      snippet: r.outerHTML,
      fix: r.isEmpty
        ? "Trigger the interaction that populates this region, then verify with a real screen reader (VoiceOver/NVDA) that the announcement is complete and makes sense out of context — not just a fragment like a changed number with no label."
        : "Read the current content aloud (or with a screen reader) and confirm it's a complete, meaningful sentence — not just a bare status word or number. Add aria-atomic=\"true\" if partial updates could otherwise be announced without their context.",
      occurrences: 1,
    });
  }

  return findings;
}
