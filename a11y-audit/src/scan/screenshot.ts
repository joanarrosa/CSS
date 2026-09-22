import type { Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Finding, Severity } from "../types.js";

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#d1373f",
  serious: "#e0792a",
  moderate: "#b7791f",
  minor: "#6b7280",
};

/**
 * Draws numbered, colored boxes around each finding's affected element and
 * takes one full-page screenshot — the "here's actually where the problem
 * is" evidence the brief asks for, instead of a selector the reader has to
 * go find by hand. Only findings whose first target selector resolves to a
 * real element on the current page get a box (iframe-chain selectors and
 * document-level findings are skipped); those findings get `screenshot` set
 * to the saved file's path, relative to the report folder.
 */
export async function captureEvidenceScreenshot(
  page: Page,
  findings: Finding[],
  outDir: string,
  baseName: string
): Promise<void> {
  const candidates = findings.filter((f) => f.target.length > 0 && !f.target[0].includes(">>>")).slice(0, 20);
  if (candidates.length === 0) return;

  const annotatedIds: string[] = await page.evaluate((items) => {
    const done: string[] = [];
    items.forEach((item, i) => {
      let el: Element | null = null;
      try {
        el = document.querySelector(item.selector);
      } catch {
        return;
      }
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const box = document.createElement("div");
      box.setAttribute("data-a11y-audit-overlay", "1");
      box.style.position = "absolute";
      box.style.left = `${rect.left + window.scrollX - 2}px`;
      box.style.top = `${rect.top + window.scrollY - 2}px`;
      box.style.width = `${rect.width + 4}px`;
      box.style.height = `${rect.height + 4}px`;
      box.style.border = `3px solid ${item.color}`;
      box.style.zIndex = "2147483647";
      box.style.pointerEvents = "none";
      box.style.boxSizing = "border-box";

      const label = document.createElement("div");
      label.textContent = String(i + 1);
      label.style.position = "absolute";
      label.style.top = "-11px";
      label.style.left = "-11px";
      label.style.width = "20px";
      label.style.height = "20px";
      label.style.lineHeight = "20px";
      label.style.textAlign = "center";
      label.style.fontSize = "12px";
      label.style.fontWeight = "700";
      label.style.color = "#fff";
      label.style.background = item.color;
      label.style.borderRadius = "50%";
      label.style.fontFamily = "sans-serif";
      box.appendChild(label);

      document.body.appendChild(box);
      done.push(item.id);
    });
    return done;
  }, candidates.map((f) => ({ id: f.id, selector: f.target[0], color: SEVERITY_COLOR[f.severity] })));

  if (annotatedIds.length === 0) return;

  const evidenceDir = path.join(outDir, "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const filename = `${sanitizeFilename(baseName)}.png`;
  await page.screenshot({ path: path.join(evidenceDir, filename), fullPage: true });

  await page.evaluate(() => {
    document.querySelectorAll('[data-a11y-audit-overlay]').forEach((el) => el.remove());
  });

  const relPath = `evidence/${filename}`;
  const annotatedSet = new Set(annotatedIds);
  for (const f of candidates) {
    if (annotatedSet.has(f.id)) f.screenshot = relPath;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "page";
}
