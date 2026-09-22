// Shared rendering logic for both the static, self-contained HTML report
// (report.js embeds the data once and calls this) and the live web app
// (app.js fetches data from /api/scan and calls this) — one implementation,
// so the two never drift apart.
window.A11yReportRenderer = (function () {
  const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];
  const SEVERITY_LABEL = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sortByPriority(findings) {
    const rank = { critical: 4, serious: 3, moderate: 2, minor: 1 };
    return [...findings].sort((a, b) => {
      const sev = rank[b.severity] - rank[a.severity];
      if (sev !== 0) return sev;
      const impact = b.impact - a.impact;
      if (impact !== 0) return impact;
      return a.effort - b.effort;
    });
  }

  function renderReport(data, opts) {
    const screenshotBase = (opts && opts.screenshotBase) || "";
    const state = { severity: "all", wcag: "all", source: "all", page: "all" };

    document.getElementById("report-root").classList.remove("hidden");

    function renderScore() {
      const s = data.summary;
      document.getElementById("score-value").textContent = String(s.score);
      document.getElementById("score-value").className = `score-big grade-${s.grade}`;
      document.getElementById("score-grade").textContent = `Grade ${s.grade}`;

      const tilesEl = document.getElementById("severity-tiles");
      tilesEl.innerHTML = SEVERITY_ORDER.map(
        (sev) => `
        <div class="stat-tile sev-${sev}">
          <div class="n">${s.bySeverity[sev] || 0}</div>
          <div class="l">${SEVERITY_LABEL[sev]}</div>
        </div>`
      ).join("");

      document.getElementById("scan-scope").textContent = `${s.pagesScanned} page(s) × ${s.viewportsScanned} viewport(s)${
        s.flowsScanned ? ` + ${s.flowsScanned} flow(s)` : ""
      } — ${s.total} finding(s) total`;
    }

    function renderWcagBars() {
      const entries = Object.entries(data.summary.byWcagCriterion).sort((a, b) => b[1] - a[1]);
      const max = entries.length ? entries[0][1] : 1;
      const el = document.getElementById("wcag-bars");
      if (entries.length === 0) {
        el.innerHTML = `<div class="empty-state">No WCAG success criteria violated 🎉</div>`;
        return;
      }
      el.innerHTML = entries
        .map(
          ([sc, count]) => `
          <div class="wcag-row">
            <span class="sc">${escapeHtml(sc)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${(count / max) * 100}%"></span></span>
            <span class="count">${count}</span>
          </div>`
        )
        .join("");
    }

    function renderChecklist() {
      const el = document.getElementById("manual-checklist");
      const section = el.closest("section");
      if (!data.manualChecklist.length) {
        section.classList.add("hidden");
        return;
      }
      section.classList.remove("hidden");
      el.innerHTML = data.manualChecklist
        .map((item) => `<li><strong>${escapeHtml(item.label)}</strong> — <span class="why">${escapeHtml(item.reason)}</span></li>`)
        .join("");
    }

    function uniqueValues(key) {
      return [...new Set(data.findings.map((f) => f[key]).filter(Boolean))];
    }

    function renderFilters() {
      const severityCounts = {};
      const sourceCounts = {};
      const pageCounts = {};
      for (const f of data.findings) {
        severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
        sourceCounts[f.source] = (sourceCounts[f.source] || 0) + 1;
        pageCounts[f.page] = (pageCounts[f.page] || 0) + 1;
      }

      renderChipGroup("severity-filters", "severity", ["all", ...SEVERITY_ORDER.filter((s) => severityCounts[s])], (v) =>
        v === "all" ? `All (${data.findings.length})` : `${SEVERITY_LABEL[v]} (${severityCounts[v]})`
      );
      renderChipGroup("source-filters", "source", ["all", ...uniqueValues("source")], (v) =>
        v === "all" ? "All" : `${v} (${sourceCounts[v]})`
      );
      renderChipGroup("page-filters", "page", ["all", ...uniqueValues("page")], (v) => (v === "all" ? "All" : `${v} (${pageCounts[v]})`));

      const wcagValues = [...new Set(data.findings.flatMap((f) => f.wcagCriteria))].sort();
      renderChipGroup("wcag-filters", "wcag", ["all", ...wcagValues], (v) => (v === "all" ? "All" : v));
    }

    function renderChipGroup(containerId, key, values, label) {
      const el = document.getElementById(containerId);
      el.innerHTML = values
        .map(
          (v) =>
            `<button class="chip ${state[key] === v ? "active" : ""}" data-key="${key}" data-value="${escapeHtml(v)}">${escapeHtml(
              label(v)
            )}</button>`
        )
        .join("");
      el.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          state[btn.dataset.key] = btn.dataset.value;
          renderFilters();
          renderFindings();
        });
      });
    }

    function matchesFilters(f) {
      if (state.severity !== "all" && f.severity !== state.severity) return false;
      if (state.source !== "all" && f.source !== state.source) return false;
      if (state.page !== "all" && f.page !== state.page) return false;
      if (state.wcag !== "all" && !f.wcagCriteria.includes(state.wcag)) return false;
      return true;
    }

    function findingHtml(f) {
      const wcagBadges = f.wcagCriteria.map((c) => `<span class="badge wcag">${escapeHtml(c)}</span>`).join(" ");
      const bonusBadge = f.isBonusAAA ? `<span class="badge bonus">AAA bonus</span>` : "";
      const hasShot = !!f.screenshot;
      const loc = [f.page, f.viewport, f.flow ? `flow: ${f.flow}` : null].filter(Boolean).join(" · ");

      return `
        <div class="finding sev-${f.severity} ${f.isBonusAAA ? "bonus-aaa" : ""}">
          <div class="finding-head">
            <span class="badge sev-${f.severity}">${f.severity}</span>
            ${wcagBadges}
            ${bonusBadge}
            <span class="finding-title">${escapeHtml(f.title)}</span>
          </div>
          <div class="finding-meta">${escapeHtml(loc)} · ${escapeHtml(f.url)} · impact ${f.impact}/5 · effort ${f.effort}/5 · ${
        f.occurrences
      } occurrence${f.occurrences === 1 ? "" : "s"}${f.en301549 ? ` · ${escapeHtml(f.en301549)}` : ""}</div>
          <div class="finding-body ${hasShot ? "has-shot" : ""}">
            <div>
              <div class="finding-desc">${escapeHtml(f.description)}</div>
              ${f.target.length ? `<div class="finding-snippet"><span class="label">Where:</span> ${f.target.slice(0, 5).map(escapeHtml).join(", ")}</div>` : ""}
              ${f.snippet ? `<div class="finding-snippet"><code>${escapeHtml(f.snippet)}</code></div>` : ""}
              <div class="finding-fix"><span class="label">Fix:</span><code>${escapeHtml(f.fix)}</code></div>
              ${f.helpUrl ? `<div class="finding-meta" style="margin-top:6px"><a href="${escapeHtml(f.helpUrl)}" target="_blank" rel="noopener">Reference ↗</a></div>` : ""}
            </div>
            ${
              hasShot
                ? `<div class="finding-shot"><img src="${escapeHtml(screenshotBase + f.screenshot)}" data-full="${escapeHtml(
                    screenshotBase + f.screenshot
                  )}" alt="Evidence screenshot for ${escapeHtml(f.title)}" /></div>`
                : ""
            }
          </div>
        </div>`;
    }

    function renderFindings() {
      const filtered = sortByPriority(data.findings.filter(matchesFilters));
      document.getElementById("result-count").textContent = `${filtered.length} of ${data.findings.length} finding(s)`;
      const listEl = document.getElementById("finding-list");
      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="empty-state">No findings match this filter.</div>`;
        return;
      }
      listEl.innerHTML = filtered.map(findingHtml).join("");
      listEl.querySelectorAll("img[data-full]").forEach((img) => {
        img.addEventListener("click", () => openLightbox(img.dataset.full));
      });
    }

    function openLightbox(src) {
      const box = document.getElementById("lightbox");
      document.getElementById("lightbox-img").src = src;
      box.classList.add("open");
    }

    const lightbox = document.getElementById("lightbox");
    if (lightbox && !lightbox.dataset.wired) {
      lightbox.addEventListener("click", () => lightbox.classList.remove("open"));
      lightbox.dataset.wired = "1";
    }

    renderScore();
    renderWcagBars();
    renderChecklist();
    renderFilters();
    renderFindings();
  }

  return { renderReport };
})();
