/**
 * The results markup shared between the static, self-contained HTML report
 * (visible immediately — data is embedded and rendered on load) and the
 * live web app (starts hidden — renderer.js's renderReport() un-hides it
 * once a scan actually completes). Kept in one place so the two never
 * drift out of sync with the ids renderer.js expects.
 */
export const REPORT_BODY_HTML = `
<div id="report-root" class="hidden">
  <div class="score-row">
    <div class="score-card">
      <div id="score-value" class="score-big">—</div>
      <div id="score-grade" class="score-label"></div>
    </div>
    <div id="severity-tiles" class="stat-grid"></div>
  </div>
  <div class="meta" id="scan-scope" style="margin-bottom: 20px;"></div>

  <section>
    <h2>Findings by WCAG success criterion</h2>
    <div id="wcag-bars" class="wcag-bars"></div>
  </section>

  <section>
    <h2>WCAG criteria in this report, decoded</h2>
    <div id="wcag-glossary" class="glossary"></div>
  </section>

  <section>
    <h2>Manual verification still required</h2>
    <div class="checklist">
      <ul id="manual-checklist"></ul>
    </div>
  </section>

  <section>
    <h2>Findings, ranked by priority (severity → impact → effort)</h2>
    <div class="filter-panel">
      <div class="filter-group"><span class="flabel">Severity</span><span id="severity-filters"></span></div>
      <div class="filter-group"><span class="flabel">WCAG SC</span><span id="wcag-filters"></span></div>
      <div class="filter-group"><span class="flabel">Principle</span><span id="principle-filters"></span></div>
    </div>
    <div id="result-count" class="result-count"></div>
    <div id="finding-list" class="finding-list"></div>
  </section>
</div>

<div id="lightbox" class="lightbox"><img id="lightbox-img" src="" alt="" /></div>
`;
