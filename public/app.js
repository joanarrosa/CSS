const form = document.getElementById("analyze-form");
const urlInput = document.getElementById("url-input");
const analyzeBtn = document.getElementById("analyze-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const filterBarEl = document.getElementById("filter-bar");
const resultsEl = document.getElementById("results");

const CATEGORY_ORDER = [
  "duplicates",
  "overrides",
  "specificity",
  "unused",
  "best-practices",
  "accessibility",
  "performance",
];

const CATEGORY_LABELS = {
  duplicates: "Duplicates",
  overrides: "Overrides",
  specificity: "Specificity",
  unused: "Unused CSS",
  "best-practices": "Best Practices",
  accessibility: "Accessibility",
  performance: "Performance",
};

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const LAST_URL_KEY = "css-audit:last-url";

let currentData = null;
let activeCategory = "all";
let activeType = "all";

restoreLastUrl();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  rememberUrl(url);
  activeCategory = "all";
  activeType = "all";
  setLoading(true);
  summaryEl.innerHTML = "";
  filterBarEl.innerHTML = "";
  resultsEl.innerHTML = "";

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Something went wrong.");
      return;
    }
    currentData = data;
    renderSummary(data);
    renderFilterBar(data);
    renderResults(data);
  } catch (err) {
    showError("Network error: " + err.message);
  } finally {
    setLoading(false);
  }
});

function restoreLastUrl() {
  try {
    const last = localStorage.getItem(LAST_URL_KEY);
    if (last) urlInput.value = last;
  } catch {
    // localStorage unavailable (private mode, etc.) — not essential, skip silently
  }
}

function rememberUrl(url) {
  try {
    localStorage.setItem(LAST_URL_KEY, url);
  } catch {
    // ignore
  }
}

function setLoading(loading) {
  analyzeBtn.disabled = loading;
  analyzeBtn.textContent = loading ? "Analyzing…" : "Analyze";
  if (loading) {
    statusEl.textContent =
      "Loading the page in a headless browser and analyzing its CSS — this can take several seconds…";
    statusEl.className = "status status--loading";
  }
}

function showError(msg) {
  statusEl.textContent = msg;
  statusEl.className = "status status--error";
}

function renderSummary(data) {
  statusEl.textContent = "";
  statusEl.className = "status";

  if (data.warnings && data.warnings.length) {
    const warnBox = document.createElement("div");
    warnBox.className = "warnings";
    warnBox.innerHTML =
      "<strong>Warnings</strong><ul>" +
      data.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("") +
      "</ul>";
    summaryEl.appendChild(warnBox);
  }

  const summaryCard = document.createElement("div");
  summaryCard.className = "summary-card";
  summaryCard.innerHTML = `
    <div class="summary-header">
      <div>
        <h2>${escapeHtml(data.title || data.url)}</h2>
        <div class="meta">${escapeHtml(data.url)}${
    data.finalUrl && data.finalUrl !== data.url ? " → " + escapeHtml(data.finalUrl) : ""
  }</div>
        <div class="meta">${data.stats.totalRules} rules across ${data.stats.totalSources} source(s)${
    data.httpStatus ? `, HTTP ${data.httpStatus}` : ""
  }</div>
      </div>
      <div class="severity-badges">
        <span class="badge badge--high">${data.summary.bySeverity.high || 0} high</span>
        <span class="badge badge--medium">${data.summary.bySeverity.medium || 0} medium</span>
        <span class="badge badge--low">${data.summary.bySeverity.low || 0} low</span>
      </div>
    </div>
    <div class="type-row">
      <span class="type-pill type-pill--error">${data.summary.byType.error || 0} errors</span>
      <span class="type-hint">objectively broken — fix these first</span>
      <span class="type-pill type-pill--improvement">${data.summary.byType.improvement || 0} improvements</span>
      <span class="type-hint">works today, but could be better</span>
    </div>
    <div class="category-counts">
      ${CATEGORY_ORDER.map(
        (c) =>
          `<div class="count-pill"><span>${CATEGORY_LABELS[c]}</span><strong>${
            data.summary.counts[c] || 0
          }</strong></div>`
      ).join("")}
    </div>
    <div class="summary-actions">
      <button id="download-json-btn" type="button" class="secondary-btn">Download JSON report</button>
    </div>
  `;
  summaryEl.appendChild(summaryCard);
  document.getElementById("download-json-btn").addEventListener("click", () => downloadJson(data));

  if (data.summary.topPriorityFixes.length) {
    const topBox = document.createElement("div");
    topBox.className = "top-fixes";
    topBox.innerHTML =
      "<h3>Top priority fixes</h3>" +
      data.summary.topPriorityFixes
        .map(
          (f, i) => `
        <div class="finding finding--${f.severity}">
          <div class="finding-header">
            <span class="sev-badge sev-badge--${f.severity}">${f.severity}</span>
            <span class="type-badge type-badge--${f.type}">${f.type}</span>
            <strong>${i + 1}. ${escapeHtml(f.categoryLabel)}</strong>
          </div>
          <p class="problem">${escapeHtml(f.message)}</p>
          ${f.suggestion ? `<p class="fix"><strong>Fix:</strong> ${escapeHtml(f.suggestion)}</p>` : ""}
        </div>
      `
        )
        .join("");
    summaryEl.appendChild(topBox);
  }
}

function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const hostname = safeHostname(data.url);
  a.href = url;
  a.download = `css-audit-${hostname}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "report";
  }
}

function renderFilterBar(data) {
  filterBarEl.innerHTML = "";

  const categoryRow = document.createElement("div");
  categoryRow.className = "filter-row";
  categoryRow.appendChild(makeFilterChip("all", "All categories", sumCounts(data.summary.counts), "category"));
  for (const cat of CATEGORY_ORDER) {
    const n = data.summary.counts[cat] || 0;
    if (n === 0) continue;
    categoryRow.appendChild(makeFilterChip(cat, CATEGORY_LABELS[cat], n, "category"));
  }
  filterBarEl.appendChild(categoryRow);

  const typeRow = document.createElement("div");
  typeRow.className = "filter-row";
  typeRow.appendChild(makeFilterChip("all", "All types", data.summary.total, "type"));
  typeRow.appendChild(makeFilterChip("error", "Errors", data.summary.byType.error || 0, "type"));
  typeRow.appendChild(makeFilterChip("improvement", "Improvements", data.summary.byType.improvement || 0, "type"));
  filterBarEl.appendChild(typeRow);
}

function sumCounts(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function makeFilterChip(value, label, count, kind) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "filter-chip";
  chip.dataset.kind = kind;
  chip.dataset.value = value;
  chip.textContent = `${label} (${count})`;
  const active = kind === "category" ? activeCategory : activeType;
  if (active === value) chip.classList.add("filter-chip--active");
  chip.addEventListener("click", () => {
    if (kind === "category") activeCategory = value;
    else activeType = value;
    updateFilterChipStates();
    renderResults(currentData);
  });
  return chip;
}

function updateFilterChipStates() {
  filterBarEl.querySelectorAll(".filter-chip").forEach((chip) => {
    const active = chip.dataset.kind === "category" ? activeCategory : activeType;
    chip.classList.toggle("filter-chip--active", chip.dataset.value === active);
  });
}

function renderResults(data) {
  resultsEl.innerHTML = "";

  const categoriesToShow = activeCategory === "all" ? CATEGORY_ORDER : [activeCategory];

  let shown = 0;
  for (const cat of categoriesToShow) {
    let items = data.findings[cat] || [];
    if (activeType !== "all") items = items.filter((f) => f.type === activeType);
    if (items.length === 0) continue;

    items = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "error" ? -1 : 1;
      return (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0);
    });

    shown += items.length;

    const section = document.createElement("details");
    section.className = "category-section";
    section.open = true;

    const summary = document.createElement("summary");
    summary.textContent = `${CATEGORY_LABELS[cat]} (${items.length})`;
    section.appendChild(summary);

    const description = data.categories && data.categories[cat] ? data.categories[cat].description : "";
    if (description) {
      const desc = document.createElement("p");
      desc.className = "category-description";
      desc.textContent = description;
      section.appendChild(desc);
    }

    const list = document.createElement("div");
    list.className = "finding-list";
    for (const f of items) {
      list.appendChild(renderFindingCard(f));
    }
    section.appendChild(list);
    resultsEl.appendChild(section);
  }

  if (shown === 0) {
    const emptyBox = document.createElement("div");
    emptyBox.className = "summary-card";
    emptyBox.textContent =
      activeCategory === "all" && activeType === "all"
        ? "No issues found across any category."
        : "No findings match the current filters.";
    resultsEl.appendChild(emptyBox);
  }
}

function renderFindingCard(f) {
  const card = document.createElement("div");
  card.className = `finding finding--${f.severity}`;
  card.innerHTML = `
    <div class="finding-header">
      <span class="sev-badge sev-badge--${f.severity}">${f.severity}</span>
      <span class="type-badge type-badge--${f.type}">${f.type}</span>
      ${f.selector ? `<code>${escapeHtml(f.selector)}</code>` : `<span class="doc-level">document-level</span>`}
    </div>
    ${f.source ? `<p class="where"><strong>Where:</strong> ${escapeHtml(f.source)}${f.line ? ":" + f.line : ""}</p>` : ""}
    <p class="problem"><strong>Problem:</strong> ${escapeHtml(f.message)}</p>
    ${f.suggestion ? `<p class="fix"><strong>Fix:</strong> ${escapeHtml(f.suggestion)}</p>` : ""}
  `;
  return card;
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
