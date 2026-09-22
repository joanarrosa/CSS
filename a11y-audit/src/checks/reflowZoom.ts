import type { Page } from "playwright";
import type { Finding } from "../types.js";

/**
 * WCAG 1.4.10 (Reflow) and 1.4.4 (Resize Text): content must stay usable —
 * no horizontal scrolling, no clipped/overlapping text — when zoomed. This
 * simulates 200% zoom via the (non-standard but Chromium-supported) CSS
 * `zoom` property, checks for a horizontal scrollbar, and looks for text
 * elements that are now clipped by an `overflow: hidden` ancestor.
 */
export async function checkReflowAtZoom(
  page: Page,
  ctx: { pageName: string; url: string; viewport: string; flow?: string },
  zoomFactor = 2
): Promise<Finding[]> {
  const result = await page.evaluate((zoom) => {
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

    const html = document.documentElement;
    (html.style as any).zoom = String(zoom);

    // Force layout to settle.
    void html.offsetHeight;

    const hasHorizontalScroll = html.scrollWidth > html.clientWidth + 2;

    const clipped: { selector: string; outerHTML: string }[] = [];
    const textEls = Array.from(document.querySelectorAll("p, span, a, button, h1, h2, h3, h4, h5, h6, li, td, label")).slice(0, 600);
    for (const el of textEls) {
      const hasDirectText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0);
      if (!hasDirectText) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow !== "hidden" && cs.overflowX !== "hidden") continue;
      if (el.scrollWidth > el.clientWidth + 2) {
        clipped.push({ selector: cssPath(el), outerHTML: el.outerHTML.slice(0, 200) });
        if (clipped.length >= 20) break;
      }
    }

    (html.style as any).zoom = "1";
    void html.offsetHeight;

    return { hasHorizontalScroll, clipped };
  }, zoomFactor);

  const findings: Finding[] = [];
  const base = { page: ctx.pageName, url: ctx.url, viewport: ctx.viewport, flow: ctx.flow };

  if (result.hasHorizontalScroll) {
    findings.push({
      ...base,
      source: "reflow",
      id: `reflow-horizontal-scroll-${ctx.pageName}-${ctx.viewport}`,
      ruleId: "reflow-horizontal-scroll-at-zoom",
      wcagCriteria: ["1.4.10"],
      wcagLevel: "AA",
      severity: "serious",
      impact: 4,
      effort: 3,
      title: `Horizontal scrolling appears at ${zoomFactor * 100}% zoom`,
      description: `At ${zoomFactor * 100}% zoom, the page's content is wider than the viewport, forcing horizontal scrolling to read it. Low-vision users who rely on browser zoom shouldn't have to scroll in two directions to read content that scrolls in one at 100%.`,
      target: ["html"],
      fix: "Look for fixed pixel widths, non-wrapping flex/grid rows, or elements with `white-space: nowrap` on the widest section of the page; switch to relative units (%, rem, minmax()/auto in grid) so the layout can reflow to a single column at high zoom.",
      occurrences: 1,
    });
  }

  if (result.clipped.length > 0) {
    findings.push({
      ...base,
      source: "reflow",
      id: `reflow-clipped-content-${ctx.pageName}-${ctx.viewport}`,
      ruleId: "reflow-clipped-content-at-zoom",
      wcagCriteria: ["1.4.10", "1.4.4"],
      wcagLevel: "AA",
      severity: "moderate",
      impact: 3,
      effort: 2,
      title: `${result.clipped.length} text element(s) get clipped at ${zoomFactor * 100}% zoom`,
      description: `These elements have overflow: hidden and their text now overflows its own box at ${zoomFactor * 100}% zoom, e.g. ${result.clipped[0].selector} — the text is still "there" for a screen reader but visually cut off for a sighted low-vision user zooming in.`,
      target: result.clipped.map((c) => c.selector),
      snippet: result.clipped[0].outerHTML,
      fix: "Give these containers a min-height that grows with content (or remove the fixed height entirely) and let text wrap instead of clipping it with overflow: hidden.",
      occurrences: result.clipped.length,
    });
  }

  return findings;
}
