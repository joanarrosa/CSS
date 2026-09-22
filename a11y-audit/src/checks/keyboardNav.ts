import type { Page } from "playwright";
import type { Finding } from "../types.js";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], audio[controls], video[controls], summary';

interface ElementDescriptor {
  selector: string;
  outerHTML: string;
}

/**
 * Everything here has to be observed live (focus state, actual Tab-key
 * behavior) — axe-core deliberately doesn't attempt any of it, since it
 * can't simulate real keyboard interaction:
 *  - visible focus indicator on every focusable element (2.4.7)
 *  - no keyboard trap: repeatedly pressing Tab must keep moving focus (2.1.2)
 *  - any currently-open modal/dialog can be dismissed with Escape (2.1.2)
 */
export async function checkKeyboardNav(
  page: Page,
  ctx: { pageName: string; url: string; viewport: string; flow?: string }
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = { page: ctx.pageName, url: ctx.url, viewport: ctx.viewport, flow: ctx.flow };

  findings.push(...(await checkFocusIndicators(page, base)));
  findings.push(...(await checkKeyboardTrap(page, base)));
  findings.push(...(await checkModalEscapeDismissal(page, base)));

  return findings;
}

async function checkFocusIndicators(
  page: Page,
  base: { page: string; url: string; viewport: string; flow?: string }
): Promise<Finding[]> {
  const noIndicator = await page.evaluate((selector: string): ElementDescriptor[] => {
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

    function isVisible(el: Element): boolean {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    const els = Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(0, 400) as HTMLElement[];
    const flagged: { selector: string; outerHTML: string }[] = [];

    for (const el of els) {
      const before = getComputedStyle(el);
      const beforeOutline = `${before.outlineStyle}|${before.outlineWidth}`;
      const beforeShadow = before.boxShadow;
      const beforeBorder = before.borderColor + before.borderWidth;

      el.focus({ preventScroll: true });
      if (document.activeElement !== el) continue; // not actually focusable, skip

      const after = getComputedStyle(el);
      const afterOutline = `${after.outlineStyle}|${after.outlineWidth}`;
      const outlineNone = after.outlineStyle === "none" || after.outlineWidth === "0px";
      const outlineChanged = afterOutline !== beforeOutline;
      const shadowChanged = after.boxShadow !== beforeShadow && after.boxShadow !== "none";
      const borderChanged = after.borderColor + after.borderWidth !== beforeBorder;

      el.blur();

      if (outlineNone && !outlineChanged && !shadowChanged && !borderChanged) {
        flagged.push({ selector: cssPath(el), outerHTML: el.outerHTML.slice(0, 200) });
      }
    }
    return flagged;
  }, FOCUSABLE_SELECTOR);

  if (noIndicator.length === 0) return [];

  return [
    {
      ...base,
      source: "keyboard",
      id: `keyboard-no-focus-indicator-${base.page}-${base.viewport}`,
      ruleId: "keyboard-no-focus-indicator",
      wcagCriteria: ["2.4.7"],
      wcagLevel: "AA",
      severity: noIndicator.length > 5 ? "serious" : "moderate",
      impact: 4,
      effort: 2,
      title: `${noIndicator.length} focusable element(s) have no visible focus indicator`,
      description: `These elements compute to outline: none with no box-shadow or border change on focus, so a keyboard user tabbing through the page can't see where focus currently is. Example: ${noIndicator[0].selector}.`,
      target: noIndicator.slice(0, 20).map((e) => e.selector),
      snippet: noIndicator[0].outerHTML,
      fix: `Don't remove the default focus outline without replacing it. Add a visible :focus-visible style, e.g.:\n  ${escapeForFix(noIndicator[0].selector)}:focus-visible {\n    outline: 2px solid #2563eb;\n    outline-offset: 2px;\n  }`,
      occurrences: noIndicator.length,
    },
  ];
}

async function checkKeyboardTrap(
  page: Page,
  base: { page: string; url: string; viewport: string; flow?: string }
): Promise<Finding[]> {
  const focusableCount = await page.evaluate((selector) => document.querySelectorAll(selector).length, FOCUSABLE_SELECTOR);
  if (focusableCount === 0) return [];

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab"); // enter the page

  const maxPresses = Math.min(focusableCount + 8, 250);
  let stuckAt: ElementDescriptor | null = null;
  let lastKey = "";

  for (let i = 0; i < maxPresses; i++) {
    const key = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "";
      return `${el.tagName}#${el.id}.${(el.className || "").toString().slice(0, 30)}:${el.getAttribute("data-a11y-trap-idx") ?? ""}`;
    });
    if (i > 0 && key && key === lastKey) {
      const desc = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        let sel = el.tagName.toLowerCase();
        if (el.id) sel += `#${el.id}`;
        return { selector: sel, outerHTML: el.outerHTML.slice(0, 200) };
      });
      stuckAt = desc;
      break;
    }
    lastKey = key;
    await page.keyboard.press("Tab");
  }

  if (!stuckAt) return [];

  return [
    {
      ...base,
      source: "keyboard",
      id: `keyboard-trap-${base.page}-${base.viewport}`,
      ruleId: "keyboard-trap",
      wcagCriteria: ["2.1.2"],
      wcagLevel: "A",
      severity: "critical",
      impact: 5,
      effort: 3,
      title: "Possible keyboard trap",
      description: `Repeatedly pressing Tab left focus stuck on the same element (${stuckAt.selector}) instead of continuing to the next focusable element — a keyboard-only user could get stuck here and be unable to reach the rest of the page.`,
      target: [stuckAt.selector],
      snippet: stuckAt.outerHTML,
      fix: "Check this element's own keydown/focus handlers for code that re-focuses itself or calls preventDefault on Tab. Custom widgets (rich text editors, date pickers, iframes) are the most common cause — make sure Tab/Shift+Tab are allowed to leave once the widget's own internal navigation is done.",
      occurrences: 1,
    },
  ];
}

async function checkModalEscapeDismissal(
  page: Page,
  base: { page: string; url: string; viewport: string; flow?: string }
): Promise<Finding[]> {
  const openModals = await page.evaluate<ElementDescriptor[]>(() => {
    function isVisible(el: Element): boolean {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    const candidates = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
    return candidates.filter(isVisible).map((el) => {
      let sel = el.tagName.toLowerCase();
      if (el.id) sel += `#${el.id}`;
      return { selector: sel, outerHTML: el.outerHTML.slice(0, 200) };
    });
  });

  if (openModals.length === 0) return []; // nothing open on this page state to test

  const findings: Finding[] = [];
  for (const modal of openModals) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const stillVisible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }, modal.selector);

    if (stillVisible) {
      findings.push({
        ...base,
        source: "keyboard",
        id: `keyboard-modal-no-escape-${base.page}-${base.viewport}-${modal.selector}`,
        ruleId: "modal-not-dismissible-by-escape",
        wcagCriteria: ["2.1.2"],
        wcagLevel: "A",
        severity: "serious",
        impact: 4,
        effort: 2,
        title: "Open dialog can't be dismissed with Escape",
        description: `${modal.selector} is a role="dialog"/aria-modal element that stayed open after pressing Escape. Keyboard and screen reader users expect Escape to close overlays without having to tab to a close button.`,
        target: [modal.selector],
        snippet: modal.outerHTML,
        fix: `Add a keydown listener on the dialog (or document, while it's open) that closes it on Escape:\n  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });`,
        occurrences: 1,
      });
    }
  }
  return findings;
}

function escapeForFix(str: string): string {
  return str.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
}
