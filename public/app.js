const form = document.getElementById("analyze-form");
const urlInput = document.getElementById("url-input");
const analyzeBtn = document.getElementById("analyze-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  setLoading(true);
  summaryEl.innerHTML = "";
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
    render(data);
  } catch (err) {
    showError("Network error: " + err.message);
  } finally {
    setLoading(false);
  }
});

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

function render(data) {
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
    <div class="category-counts">
      ${CATEGORY_ORDER.map(
        (c) =>
          `<div class="count-pill"><span>${CATEGORY_LABELS[c]}</span><strong>${
            data.summary.counts[c] || 0
          }</strong></div>`
      ).join("")}
    </div>
  `;
  summaryEl.appendChild(summaryCard);

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
            <strong>${i + 1}. ${escapeHtml(f.categoryLabel)}</strong>
          </div>
          <p>${escapeHtml(f.message)}</p>
          ${f.suggestion ? `<p class="fix"><strong>Fix:</strong> ${escapeHtml(f.suggestion)}</p>` : ""}
        </div>
      `
        )
        .join("");
    summaryEl.appendChild(topBox);
  }

  for (const cat of CATEGORY_ORDER) {
    const items = data.findings[cat] || [];
    if (items.length === 0) continue;

    const section = document.createElement("details");
    section.className = "category-section";
    section.open = true;

    const summary = document.createElement("summary");
    summary.textContent = `${CATEGORY_LABELS[cat]} (${items.length})`;
    section.appendChild(summary);

    const list = document.createElement("div");
    list.className = "finding-list";
    for (const f of items) {
      const card = document.createElement("div");
      card.className = `finding finding--${f.severity}`;
      card.innerHTML = `
        <div class="finding-header">
          <span class="sev-badge sev-badge--${f.severity}">${f.severity}</span>
          ${f.selector ? `<code>${escapeHtml(f.selector)}</code>` : `<span class="doc-level">document-level</span>`}
          ${f.source ? `<span class="loc">${escapeHtml(f.source)}${f.line ? ":" + f.line : ""}</span>` : ""}
        </div>
        <p>${escapeHtml(f.message)}</p>
        ${f.suggestion ? `<p class="fix"><strong>Fix:</strong> ${escapeHtml(f.suggestion)}</p>` : ""}
      `;
      list.appendChild(card);
    }
    section.appendChild(list);
    resultsEl.appendChild(section);
  }

  if (resultsEl.children.length === 0) {
    const okBox = document.createElement("div");
    okBox.className = "summary-card";
    okBox.textContent = "No issues found across any category.";
    resultsEl.appendChild(okBox);
  }
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
