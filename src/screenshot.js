const MAX_ANNOTATED_FINDINGS = 30;
const MAX_ELEMENTS_PER_FINDING = 5;

const CATEGORY_COLOR = {
  overrides: "#d1373f",
  accessibility: "#d1373f",
  specificity: "#b7791f",
  duplicates: "#b7791f",
  "best-practices": "#b7791f",
  unused: "#6b7280",
  performance: "#6b7280",
};

/**
 * Draws numbered outline boxes around the elements involved in a page's
 * most severe findings, then takes a full-page screenshot. Boxes are
 * injected as absolutely-positioned overlay <div>s (not real page content),
 * removed again after the screenshot so the page is left as it was found.
 *
 * @param {import('playwright').Page} page
 * @param {Array<{selector: string, category: string, severity: string, message: string}>} annotations
 *   pre-resolved list of {selector, category, severity, message} to highlight — the caller
 *   picks which findings qualify (see buildCssAnnotations/buildA11yAnnotations below).
 * @param {string} outPath
 * @returns {Promise<{path: string, annotated: number}>}
 */
export async function captureAnnotatedScreenshot(page, annotations, outPath) {
  const capped = annotations.slice(0, MAX_ANNOTATED_FINDINGS);

  const annotated = await page.evaluate(
    ({ items, categoryColor, maxPerFinding }) => {
      const overlay = document.createElement("div");
      overlay.id = "__css_audit_overlay__";
      overlay.style.position = "absolute";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "0";
      overlay.style.height = "0";
      overlay.style.zIndex = "2147483647";
      overlay.style.pointerEvents = "none";
      document.body.appendChild(overlay);

      let count = 0;
      items.forEach((item, idx) => {
        let matched;
        try {
          matched = document.querySelectorAll(item.selector);
        } catch {
          return;
        }
        const color = categoryColor[item.category] || "#3457d5";
        [...matched].slice(0, maxPerFinding).forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;

          const box = document.createElement("div");
          box.style.position = "absolute";
          box.style.left = `${rect.left + window.scrollX - 2}px`;
          box.style.top = `${rect.top + window.scrollY - 2}px`;
          box.style.width = `${rect.width + 4}px`;
          box.style.height = `${rect.height + 4}px`;
          box.style.border = `3px solid ${color}`;
          box.style.boxSizing = "border-box";
          box.style.borderRadius = "3px";

          const label = document.createElement("div");
          label.textContent = String(idx + 1);
          label.style.position = "absolute";
          label.style.top = "-10px";
          label.style.left = "-10px";
          label.style.background = color;
          label.style.color = "#fff";
          label.style.font = "bold 11px sans-serif";
          label.style.padding = "1px 5px";
          label.style.borderRadius = "999px";
          label.style.lineHeight = "1.4";
          box.appendChild(label);

          overlay.appendChild(box);
          count++;
        });
      });
      return count;
    },
    { items: capped, categoryColor: CATEGORY_COLOR, maxPerFinding: MAX_ELEMENTS_PER_FINDING }
  );

  await page.screenshot({ path: outPath, fullPage: true });

  await page.evaluate(() => {
    document.getElementById("__css_audit_overlay__")?.remove();
  });

  return { path: outPath, annotated };
}

/** Picks the CSS audit findings worth drawing a box around: errors, highest severity first. */
export function buildCssAnnotations(findings) {
  return findings
    .filter((f) => f.selector && f.type === "error")
    .sort((a, b) => (b.severity === "high") - (a.severity === "high"))
    .map((f) => ({ selector: f.selector, category: f.category, severity: f.severity, message: f.message }));
}

/** Picks accessibility violations to draw boxes around, using axe's own per-node target selectors (more precise than a re-derived one). */
export function buildA11yAnnotations(violations) {
  const items = [];
  for (const v of violations) {
    for (const node of v.nodes) {
      items.push({ selector: node.target, category: "accessibility", severity: v.impact, message: v.help });
    }
  }
  return items;
}
