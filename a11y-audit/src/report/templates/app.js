(function () {
  const form = document.getElementById("scan-form");
  const urlInput = document.getElementById("url-input");
  const singlePageCheckbox = document.getElementById("single-page-checkbox");
  const maxPagesField = document.querySelector(".max-pages-field");
  const maxPagesInput = document.getElementById("max-pages-input");
  const dismissTextInput = document.getElementById("dismiss-text-input");
  const scanHint = document.getElementById("scan-hint");

  const MULTI_PAGE_HINT =
    'Looks for a sitemap at that URL\'s domain and scans every page it finds (up to "Max pages"); if there\'s no sitemap, it crawls the site\'s own links instead. No pages found either way? Falls back to just the one page you entered. Common cookie-banner vendors (OneTrust, Cookiebot, Didomi...) are dismissed automatically — for a custom banner, type its accept button\'s exact text above.';
  const SINGLE_PAGE_HINT = "Scans only the exact page you entered — no sitemap lookup, no crawling other links.";

  singlePageCheckbox.addEventListener("change", () => {
    const single = singlePageCheckbox.checked;
    maxPagesInput.disabled = single;
    maxPagesField.classList.toggle("disabled", single);
    scanHint.textContent = single ? SINGLE_PAGE_HINT : MULTI_PAGE_HINT;
  });
  const statusEl = document.getElementById("scan-status");
  const analyzeBtn = document.getElementById("analyze-btn");
  const downloadRow = document.getElementById("download-row");
  const downloadHtml = document.getElementById("download-html");
  const downloadJson = document.getElementById("download-json");
  const downloadCsv = document.getElementById("download-csv");
  const reportRoot = document.getElementById("report-root");

  const LAST_URL_KEY = "a11y-audit:last-url";
  const saved = localStorage.getItem(LAST_URL_KEY);
  if (saved) urlInput.value = saved;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    const viewports = Array.from(form.querySelectorAll('input[name="viewport"]:checked')).map((el) => el.value);
    const maxPages = Math.min(50, Math.max(1, Number(maxPagesInput.value) || 20));
    const dismissText = dismissTextInput.value.trim();
    const singlePageOnly = singlePageCheckbox.checked;
    if (!url) return;
    if (viewports.length === 0) {
      setStatus("Pick at least one viewport.", true);
      return;
    }

    try {
      localStorage.setItem(LAST_URL_KEY, url);
    } catch {
      /* ignore — private browsing etc. */
    }

    analyzeBtn.disabled = true;
    reportRoot.classList.add("hidden");
    downloadRow.classList.add("hidden");
    setStatus("Starting scan...", false);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, viewports, maxPages, dismissText, singlePageOnly }),
      });

      if (!res.body) {
        throw new Error(`Server error (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;
      let reportUrlBase = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "progress") {
            setStatus(evt.message, false);
          } else if (evt.type === "done") {
            finalData = evt.data;
            reportUrlBase = evt.reportUrlBase;
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }

      if (!finalData) {
        throw new Error("The scan ended without producing a result — check the server window for details.");
      }

      setStatus(`Done — score ${finalData.summary.score}/100 (${finalData.summary.grade}).`, false);
      window.A11yReportRenderer.renderReport(finalData, { screenshotBase: reportUrlBase + "/" });

      downloadHtml.href = `${reportUrlBase}/report.html`;
      downloadJson.href = `${reportUrlBase}/report.json`;
      downloadCsv.href = `${reportUrlBase}/report.csv`;
      downloadRow.classList.remove("hidden");
    } catch (err) {
      setStatus(`Error: ${err && err.message ? err.message : err}`, true);
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.remove("hidden");
    statusEl.classList.toggle("error", !!isError);
  }
})();
