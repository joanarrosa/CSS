import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

/**
 * Builds a single, fully self-contained HTML file (no external requests —
 * no server, no CDN, no internet needed to view it) that renders a report
 * exactly like the web UI, from embedded data. Reuses the real page markup,
 * CSS, and rendering JS (public/index.html, styles.css, app.js) so the
 * shared file never visually drifts from the live app.
 *
 * @param {"css"|"a11y"} kind
 * @param {object} data the same JSON shape toJsonReport()/toAccessibilityReport() + url/title/etc. produce
 */
export function buildHtmlReport(kind, data) {
  const indexHtml = readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const css = readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  const appJs = readFileSync(path.join(PUBLIC_DIR, "app.js"), "utf8");

  const title = `CSS Audit — ${data.title || data.url} (${kind === "css" ? "CSS" : "Accessibility"} report)`;

  let html = indexHtml;
  html = html.replace(/<title>.*<\/title>/, `<title>${escapeForHtml(title)}</title>`);
  html = html.replace(/<link rel="icon"[^>]*>\s*/, "");
  html = html.replace(
    /<link rel="stylesheet" href="\/styles\.css" \/>/,
    `<style>\n${css}\n</style>`
  );
  html = html.replace(
    /<script src="\/app\.js"><\/script>/,
    `<script>window.__CSS_AUDIT_EMBEDDED_REPORT__ = ${JSON.stringify({ kind, data }).replace(/</g, "\\u003c")};</script>\n<script>\n${appJs}\n</script>`
  );

  return html;
}

function escapeForHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
