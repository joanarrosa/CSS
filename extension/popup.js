const CATEGORY_ORDER = ["duplicates", "overrides", "specificity", "unused", "best-practices", "accessibility", "performance"];
const CATEGORY_LABELS = {
  duplicates: "Duplicates",
  overrides: "Overrides",
  specificity: "Specificity",
  unused: "Unused CSS",
  "best-practices": "Best Practices",
  accessibility: "Accessibility",
  performance: "Performance",
};

const UNSUPPORTED_SCHEMES = /^(chrome|edge|chrome-extension|extension|about|devtools|view-source|chrome-error):/i;
const UNSUPPORTED_HOSTS = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i;

const els = {
  pageHost: document.getElementById("page-host"),
  unsupported: document.getElementById("unsupported"),
  idle: document.getElementById("idle"),
  analyzeBtn: document.getElementById("analyze-btn"),
  loading: document.getElementById("loading"),
  loadingText: document.getElementById("loading-text"),
  errorPanel: document.getElementById("error-panel"),
  errorText: document.getElementById("error-text"),
  retryBtn: document.getElementById("retry-btn"),
  report: document.getElementById("report"),
  scoreBadge: document.getElementById("score-badge"),
  severityCounts: document.getElementById("severity-counts"),
  typeCounts: document.getElementById("type-counts"),
  warnings: document.getElementById("warnings"),
  categoryFilters: document.getElementById("category-filters"),
  typeFilters: document.getElementById("type-filters"),
  findings: document.getElementById("findings"),
  reanalyzeBtn: document.getElementById("reanalyze-btn"),
  downloadJsonBtn: document.getElementById("download-json-btn"),
  downloadFixBtn: document.getElementById("download-fix-btn"),
  autofixNote: document.getElementById("autofix-note"),
};

let activeTabId = null;
let lastResult = null;
let activeCategory = "all";
let activeType = "all";

function showPanel(name) {
  for (const key of ["idle", "loading", "errorPanel", "report"]) {
    els[key].classList.toggle("hidden", key !== name);
  }
}

function setLoading(text) {
  els.loadingText.textContent = text;
  showPanel("loading");
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    els.pageHost.textContent = "—";
    els.unsupported.classList.remove("hidden");
    els.idle.classList.add("hidden");
    return;
  }
  activeTabId = tab.id;
  let hostname = tab.url;
  try {
    hostname = new URL(tab.url).hostname || tab.url;
  } catch {
    /* keep raw url */
  }
  els.pageHost.textContent = hostname;

  if (UNSUPPORTED_SCHEMES.test(tab.url) || UNSUPPORTED_HOSTS.test(tab.url)) {
    els.unsupported.classList.remove("hidden");
    els.idle.classList.add("hidden");
    return;
  }

  showPanel("idle");
}

async function fetchLinkedStylesheets(links) {
  const results = [];
  for (const link of links) {
    try {
      const res = await fetch(link.href, { credentials: "omit" });
      if (!res.ok) {
        results.push({ href: link.href, ok: false, error: `HTTP ${res.status}` });
        continue;
      }
      const text = await res.text();
      results.push({ href: link.href, ok: true, text });
    } catch (err) {
      results.push({ href: link.href, ok: false, error: err.message });
    }
  }
  return results;
}

async function runAnalysis() {
  if (activeTabId == null) return;
  setLoading("Injecting the analysis engine…");

  try {
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["dist/engine.js"] });

    setLoading("Reading stylesheets from the page…");
    const [{ result: refs }] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.CssAuditEngine.collectRefs(),
    });

    setLoading(
      refs.linksToFetch.length
        ? `Fetching ${refs.linksToFetch.length} stylesheet(s)…`
        : "Analyzing…"
    );
    const fetchedLinks = await fetchLinkedStylesheets(refs.linksToFetch);

    setLoading("Parsing CSS and matching against the live page…");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (styleBlocks, fetchedLinks, inlineStyleElements, pageHostname) =>
        window.CssAuditEngine.runAnalysis(styleBlocks, fetchedLinks, inlineStyleElements, pageHostname),
      args: [refs.styleBlocks, fetchedLinks, refs.inlineStyleElements, refs.pageHostname],
    });

    lastResult = { ...result, pageUrl: refs.pageUrl, pageTitle: refs.pageTitle };
    if (refs.excludedThirdParty) {
      lastResult.warnings = [
        ...lastResult.warnings,
        `Excluded ${refs.excludedThirdParty} stylesheet(s) from known ad/tracking domains.`,
      ];
    }
    activeCategory = "all";
    activeType = "all";
    renderReport(lastResult);
  } catch (err) {
    showError(
      err && err.message
        ? err.message
        : "Something went wrong analyzing this page."
    );
  }
}

function showError(message) {
  els.errorText.textContent = message;
  showPanel("errorPanel");
}

function scoreGradeClass(grade) {
  return `grade-${grade}`;
}

function renderReport(data) {
  const { summary, findings, warnings } = data;

  els.scoreBadge.textContent = `${summary.score}/100 (${summary.grade})`;
  els.scoreBadge.className = `score-badge ${scoreGradeClass(summary.grade)}`;

  els.severityCounts.innerHTML =
    `<span style="color:var(--high)">${summary.bySeverity.high || 0} high</span> · ` +
    `<span style="color:var(--medium)">${summary.bySeverity.medium || 0} medium</span> · ` +
    `<span style="color:var(--low)">${summary.bySeverity.low || 0} low</span>`;
  els.typeCounts.innerHTML = `${summary.byType.error || 0} errors, ${summary.byType.improvement || 0} improvements (${summary.total} total)`;

  if (warnings && warnings.length) {
    els.warnings.innerHTML = warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join("");
    els.warnings.classList.remove("hidden");
  } else {
    els.warnings.classList.add("hidden");
  }

  renderCategoryChips(findings);
  renderTypeChips();
  renderFindings(findings);
  renderAutoFix(data.autoFix);

  showPanel("report");
}

function renderCategoryChips(findings) {
  const counts = {};
  for (const f of findings) counts[f.category] = (counts[f.category] || 0) + 1;

  const present = CATEGORY_ORDER.filter((c) => counts[c]);
  const chips = [`<button class="chip ${activeCategory === "all" ? "active" : ""}" data-cat="all">All (${findings.length})</button>`];
  for (const cat of present) {
    chips.push(
      `<button class="chip ${activeCategory === cat ? "active" : ""}" data-cat="${cat}">${CATEGORY_LABELS[cat]} (${counts[cat]})</button>`
    );
  }
  els.categoryFilters.innerHTML = chips.join("");
  els.categoryFilters.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderFindings(lastResult.findings);
      renderCategoryChips(lastResult.findings);
    });
  });
}

function renderTypeChips() {
  const opts = [
    ["all", "All"],
    ["error", "Errors"],
    ["improvement", "Improvements"],
  ];
  els.typeFilters.innerHTML = opts
    .map(([val, label]) => `<button class="chip ${activeType === val ? "active" : ""}" data-type="${val}">${label}</button>`)
    .join("");
  els.typeFilters.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeType = btn.dataset.type;
      renderFindings(lastResult.findings);
      renderTypeChips();
    });
  });
}

function renderFindings(findings) {
  const filtered = findings.filter(
    (f) => (activeCategory === "all" || f.category === activeCategory) && (activeType === "all" || f.type === activeType)
  );

  if (filtered.length === 0) {
    els.findings.innerHTML = `<div class="empty-state">No findings match this filter.</div>`;
    return;
  }

  const ranked = [...filtered].sort((a, b) => {
    if (a.type !== b.type) return a.type === "error" ? -1 : 1;
    const w = { high: 3, medium: 2, low: 1 };
    return (w[b.severity] || 0) - (w[a.severity] || 0);
  });

  els.findings.innerHTML = ranked
    .slice(0, 200)
    .map((f) => {
      const loc = f.source ? `${escapeHtml(f.source)}${f.line ? `:${f.line}` : ""}` : "";
      return `
        <div class="finding">
          <div class="finding-top">
            <span class="badge sev-${f.severity}">${f.severity}</span>
            <span class="badge type-${f.type}">${f.type}</span>
            ${f.selector ? `<span class="finding-selector">${escapeHtml(f.selector)}</span>` : ""}
          </div>
          <div class="finding-message">${escapeHtml(f.message)}</div>
          ${f.suggestion ? `<div class="finding-fix"><b>Fix:</b> ${escapeHtml(f.suggestion)}</div>` : ""}
          ${loc ? `<div class="finding-loc">${loc}</div>` : ""}
        </div>`;
    })
    .join("");
}

function renderAutoFix(autoFix) {
  const hasFixed = autoFix && autoFix.fixedSources && autoFix.fixedSources.length;
  els.downloadFixBtn.classList.toggle("hidden", !hasFixed);
  if (hasFixed) {
    const n = autoFix.applied.length;
    els.autofixNote.textContent = `${n} safe fix${n === 1 ? "" : "es"} available across ${autoFix.fixedSources.length} source(s) — download to review.`;
    els.autofixNote.classList.remove("hidden");
  } else {
    els.autofixNote.classList.add("hidden");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function sanitizeFilename(label) {
  let base = String(label)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return base || "stylesheet";
}

els.analyzeBtn.addEventListener("click", runAnalysis);
els.retryBtn.addEventListener("click", runAnalysis);
els.reanalyzeBtn.addEventListener("click", runAnalysis);

els.downloadJsonBtn.addEventListener("click", () => {
  if (!lastResult) return;
  downloadBlob("css-audit-report.json", JSON.stringify(lastResult, null, 2), "application/json");
});

els.downloadFixBtn.addEventListener("click", () => {
  if (!lastResult || !lastResult.autoFix) return;
  const used = new Set();
  for (const { source, fixed } of lastResult.autoFix.fixedSources) {
    let name = sanitizeFilename(source);
    if (!name.endsWith(".css")) name += ".css";
    while (used.has(name)) name = name.replace(/\.css$/, `-2.css`);
    used.add(name);
    downloadBlob(name, fixed, "text/css");
  }
});

init();
