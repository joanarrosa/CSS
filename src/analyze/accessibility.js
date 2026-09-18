import { makeFinding } from "../utils/finding.js";
import { parseColor, flattenAlpha, contrastRatio, aaThreshold, isLargeText } from "../utils/color.js";

const MAX_SAMPLES = 1500;

/**
 * Samples rendered text nodes and their effective foreground/background
 * colors, then checks WCAG AA contrast (4.5:1 normal text, 3:1 large text).
 * Also flags a best-effort heuristic for "color alone conveys meaning".
 */
export async function analyzeAccessibility(page) {
  const findings = [];

  const samples = await page.evaluate((max) => {
    function isVisible(el) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function effectiveBackground(el) {
      let cur = el;
      while (cur) {
        const cs = getComputedStyle(cur);
        const bg = cs.backgroundColor;
        if (bg && bg !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) {
          return bg;
        }
        cur = cur.parentElement;
      }
      return "rgb(255, 255, 255)";
    }

    function describeEl(el) {
      let s = el.tagName.toLowerCase();
      if (el.id) s += `#${el.id}`;
      const cls = el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2) : [];
      if (cls.length) s += `.${cls.join(".")}`;
      return s;
    }

    const out = [];
    const colorMeaningCandidates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.currentNode;
    let count = 0;

    const MEANING_CLASS_RE = /^(error|success|warning|danger|invalid|valid|alert-(danger|success|warning))$/i;

    while (node && count < max) {
      const el = node;
      node = walker.nextNode();

      const hasDirectText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      if (hasDirectText && isVisible(el)) {
        const cs = getComputedStyle(el);
        out.push({
          desc: describeEl(el),
          color: cs.color,
          backgroundColor: effectiveBackground(el),
          fontSize: parseFloat(cs.fontSize),
          fontWeight: cs.fontWeight,
          text: el.textContent.trim().slice(0, 40),
        });
        count++;
      }

      if (el.classList) {
        for (const cls of el.classList) {
          if (MEANING_CLASS_RE.test(cls)) {
            const hasIcon = !!el.querySelector("svg, img, [class*='icon']");
            const hasAriaLabel = el.hasAttribute("aria-label") || el.hasAttribute("aria-describedby") || el.hasAttribute("role");
            const hasVisibleText = el.textContent.trim().length > 0;
            if (!hasIcon && !hasAriaLabel && hasVisibleText) {
              colorMeaningCandidates.push({ desc: describeEl(el), cls, text: el.textContent.trim().slice(0, 40) });
            }
            break;
          }
        }
      }
    }

    return { samples: out, colorMeaningCandidates: colorMeaningCandidates.slice(0, 20) };
  }, MAX_SAMPLES);

  const seen = new Map(); // dedupe identical color/bg/fontSize combos
  let checked = 0;
  let failures = 0;

  for (const s of samples.samples) {
    const fg = parseColor(s.color);
    const bgRaw = parseColor(s.backgroundColor);
    if (!fg || !bgRaw) continue;
    checked++;

    const bg = [bgRaw[0], bgRaw[1], bgRaw[2]];
    const flattenedFg = flattenAlpha(fg, bg);
    const ratio = contrastRatio(flattenedFg, bg);
    const weight = /^\d+$/.test(s.fontWeight) ? Number(s.fontWeight) : s.fontWeight === "bold" ? 700 : 400;
    const threshold = aaThreshold(s.fontSize, weight);

    if (ratio < threshold) {
      failures++;
      const key = `${s.color}|${s.backgroundColor}|${Math.round(s.fontSize)}|${weight}`;
      if (seen.has(key)) {
        seen.get(key).count++;
        continue;
      }
      seen.set(key, {
        count: 1,
        desc: s.desc,
        text: s.text,
        ratio,
        threshold,
        large: isLargeText(s.fontSize, weight),
        color: s.color,
        backgroundColor: s.backgroundColor,
      });
    }
  }

  for (const entry of seen.values()) {
    findings.push(
      makeFinding({
        category: "accessibility",
        severity: entry.ratio < entry.threshold * 0.7 ? "high" : "medium",
        type: "error",
        selector: entry.desc,
        source: "rendered page",
        line: null,
        message: `Text color ${entry.color} on background ${entry.backgroundColor} has a contrast ratio of ${entry.ratio.toFixed(
          2
        )}:1, below the WCAG AA minimum of ${entry.threshold}:1 for ${entry.large ? "large" : "normal"} text (e.g. "${
          entry.text
        }"${entry.count > 1 ? `, and ${entry.count - 1} other element${entry.count > 2 ? "s" : ""} with the same colors` : ""}).`,
        suggestion: `Increase contrast between text and background to at least ${entry.threshold}:1 — darken the text, lighten/darken the background, or increase font size/weight to qualify as large text.`,
        meta: { ratio: entry.ratio, threshold: entry.threshold, count: entry.count },
      })
    );
  }

  for (const c of samples.colorMeaningCandidates) {
    findings.push(
      makeFinding({
        category: "accessibility",
        severity: "low",
        type: "improvement",
        selector: c.desc,
        source: "rendered page",
        line: null,
        message: `Element with class "${c.cls}" (text: "${c.text}") appears to convey status via color alone, with no icon, aria-label, or role to reinforce it for non-color-perceiving users.`,
        suggestion: `Add an icon, text label (e.g. "Error: ..."), or aria-live/role annotation alongside the color so meaning doesn't depend on color perception.`,
      })
    );
  }

  if (checked === 0) {
    findings.push(
      makeFinding({
        category: "accessibility",
        severity: "low",
        type: "improvement",
        selector: null,
        source: null,
        line: null,
        message: `Could not sample any text elements for contrast checking.`,
        suggestion: `This can happen on pages with little visible text content, or where text renders via canvas/SVG/shadow DOM this tool doesn't inspect.`,
      })
    );
  }

  return findings;
}
