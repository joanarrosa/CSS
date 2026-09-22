import { REPORT_BODY_HTML } from "./bodyMarkup.js";

/** The live web app's page shell — scan form + the same results markup the static report uses. */
export function buildAppShellHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>a11y-audit</title>
<link rel="stylesheet" href="/assets/report.css" />
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>a11y-audit</h1>
    <div class="meta">Local accessibility scanner — paste a URL and click Analyze. This runs entirely on your machine; nothing is sent anywhere else.</div>
  </header>

  <div class="scan-panel">
    <form id="scan-form">
      <input type="url" id="url-input" placeholder="https://example.com" required />
      <div class="viewport-checks">
        <label><input type="checkbox" name="viewport" value="desktop" checked /> Desktop</label>
        <label><input type="checkbox" name="viewport" value="tablet" checked /> Tablet</label>
        <label><input type="checkbox" name="viewport" value="mobile" checked /> Mobile</label>
      </div>
      <label class="max-pages-field">Max pages
        <input type="number" id="max-pages-input" min="1" max="50" value="20" />
      </label>
      <button type="submit" id="analyze-btn" class="primary-btn">Analyze</button>
    </form>
    <div class="scan-hint">Looks for a sitemap at that URL's domain and scans every page it finds (up to "Max pages"). No sitemap? Falls back to just the one page you entered.</div>
    <div id="scan-status" class="scan-status hidden"></div>
  </div>

  ${REPORT_BODY_HTML}

  <div id="download-row" class="download-row hidden">
    <a id="download-html" class="secondary-btn" download>Download HTML report</a>
    <a id="download-json" class="secondary-btn" download>Download JSON</a>
    <a id="download-csv" class="secondary-btn" download>Download CSV</a>
  </div>
</div>

<script src="/assets/glossary.js"></script>
<script src="/assets/renderer.js"></script>
<script src="/assets/app.js"></script>
</body>
</html>
`;
}
