import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportData } from "../types.js";
import { REPORT_BODY_HTML } from "./templates/bodyMarkup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");

/**
 * Builds one self-contained HTML file: CSS and JS are inlined (not
 * fetched separately) so the whole report is a single file a
 * non-technical stakeholder can open by double-clicking or an email
 * attachment can carry — no server needed. Evidence screenshots stay as
 * separate files next to it (see runner writes them to <outDir>/evidence/),
 * since inlining dozens of PNGs as data URIs would bloat the file badly;
 * the report references them with a plain relative <img src>.
 */
export function buildHtmlReport(data: ReportData): string {
  const css = readFileSync(path.join(TEMPLATES_DIR, "report.css"), "utf8");
  const rendererJs = readFileSync(path.join(TEMPLATES_DIR, "renderer.js"), "utf8");
  const bootstrapJs = readFileSync(path.join(TEMPLATES_DIR, "report.js"), "utf8");

  // Escape "</script" and stray "<" so nothing in scanned page content
  // (titles, snippets, messages) can break out of the embedded <script> or
  // inject markup into the report itself.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `Accessibility Report — ${escapeHtml(data.targets.map((t) => t.name).join(", ") || "scan")}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>Accessibility Report</h1>
    <div class="meta">
      Generated ${escapeHtml(new Date(data.generatedAt).toLocaleString())} ·
      Targets: ${data.targets.map((t) => escapeHtml(t.name)).join(", ") || "—"} ·
      Viewports: ${data.viewports.map((v) => escapeHtml(v.name)).join(", ") || "—"}
    </div>
  </header>

  ${REPORT_BODY_HTML}
</div>

<script>window.__A11Y_REPORT_DATA__ = ${json};</script>
<script>${rendererJs}</script>
<script>${bootstrapJs}</script>
</body>
</html>
`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
