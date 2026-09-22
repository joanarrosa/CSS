import type { Page } from "playwright";
import type { Finding } from "../types.js";

/**
 * axe-core's color-contrast rule checks every element's *default* rendered
 * state. It does not check what happens to contrast when an interactive
 * element is focused or hovered — a component whose text is perfectly
 * legible at rest but goes low-contrast (or the focus ring itself is
 * low-contrast against its surroundings) on :focus is invisible to axe.
 * This samples interactive elements in their focused state using the same
 * WCAG/WebAIM relative-luminance formula axe itself uses, as the
 * component-level cross-check the brief asks for.
 */
export async function checkComponentContrast(
  page: Page,
  ctx: { pageName: string; url: string; viewport: string; flow?: string }
): Promise<Finding[]> {
  const failures = await page.evaluate(() => {
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

    function parseColor(str: string): [number, number, number, number] | null {
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
      const [r, g, b, a = 1] = parts;
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return [r, g, b, a];
    }

    function relLuminance([r, g, b]: [number, number, number]): number {
      const [rs, gs, bs] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
      const l1 = relLuminance(a);
      const l2 = relLuminance(b);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function flattenAlpha(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
      const [r, g, b, a] = fg;
      return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    }

    function effectiveBackground(el: Element): [number, number, number] {
      let cur: Element | null = el;
      while (cur) {
        const cs = getComputedStyle(cur);
        const parsed = parseColor(cs.backgroundColor);
        if (parsed && parsed[3] > 0 && !(parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0 && parsed[3] === 0)) {
          return [parsed[0], parsed[1], parsed[2]];
        }
        cur = cur.parentElement;
      }
      return [255, 255, 255];
    }

    function isVisible(el: Element): boolean {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    const candidates = Array.from(
      document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [role="button"], [role="link"], [role="tab"], [role="menuitem"]')
    ).filter(isVisible).slice(0, 300) as HTMLElement[];

    const out: { selector: string; outerHTML: string; ratio: number; threshold: number; color: string; backgroundColor: string; large: boolean }[] = [];

    for (const el of candidates) {
      const hasDirectText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0);
      if (!hasDirectText) continue;

      el.focus({ preventScroll: true });
      if (document.activeElement !== el) {
        el.blur();
        continue;
      }

      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      el.blur();
      if (!fg) continue;

      const bg = effectiveBackground(el);
      const flatFg = flattenAlpha(fg, bg);
      const ratio = contrastRatio(flatFg, bg);

      const fontSize = parseFloat(cs.fontSize);
      const weight = /^\d+$/.test(cs.fontWeight) ? Number(cs.fontWeight) : cs.fontWeight === "bold" ? 700 : 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const threshold = large ? 3 : 4.5;

      if (ratio < threshold) {
        out.push({ selector: cssPath(el), outerHTML: el.outerHTML.slice(0, 200), ratio, threshold, color: cs.color, backgroundColor: `rgb(${bg.join(", ")})`, large });
      }
    }
    return out;
  });

  if (failures.length === 0) return [];

  return failures.slice(0, 30).map((f, i) => ({
    source: "contrast" as const,
    id: `contrast-focus-${ctx.pageName}-${ctx.viewport}-${i}`,
    ruleId: "focus-state-color-contrast",
    wcagCriteria: ["1.4.3"],
    wcagLevel: "AA" as const,
    severity: (f.ratio < f.threshold * 0.7 ? "serious" : "moderate") as Finding["severity"],
    impact: 3,
    effort: 1,
    title: `Text contrast drops to ${f.ratio.toFixed(2)}:1 when focused`,
    description: `${f.selector} has a ${f.ratio.toFixed(2)}:1 contrast ratio (${f.color} on ${f.backgroundColor}) in its :focus state, below the WCAG AA minimum of ${f.threshold}:1 for ${f.large ? "large" : "normal"} text. This wasn't caught by a static page-level scan because it only appears once the element is actually focused.`,
    help: "Also check the focus *indicator itself* (the outline/ring, not just the text) against WCAG 1.4.11 Non-text Contrast (3:1 against the adjacent background).",
    target: [f.selector],
    snippet: f.outerHTML,
    fix: `Increase the focused-state text/background contrast to at least ${f.threshold}:1 — check any :focus or :focus-visible CSS rule that changes color/background-color on this selector.`,
    page: ctx.pageName,
    url: ctx.url,
    viewport: ctx.viewport,
    flow: ctx.flow,
    occurrences: 1,
  }));
}
