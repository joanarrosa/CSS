import { collectSite } from "./collect.js";
import { runFullAnalysis } from "./analyze/index.js";
import { info, warn } from "./utils/logger.js";

const DEFAULT_MAX_PAGES = 5;

/**
 * Extracts same-origin, navigable links from the given page (already
 * loaded). Two URLs differing only in query string are treated as distinct
 * pages, since they can render different content; only the hash is dropped.
 */
async function discoverLinks(page, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter(Boolean));

  const links = new Set();
  for (const href of hrefs) {
    let resolved;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    if (!/^https?:$/.test(resolved.protocol)) continue;
    resolved.hash = "";
    links.add(resolved.toString());
  }
  return [...links];
}

/**
 * Crawls same-origin pages starting from `startUrl` (breadth-first, up to
 * `maxPages` total pages including the start URL), running the full CSS
 * audit independently on each. Returns per-page results — merging is a
 * separate step (see mergeFindings) so callers can inspect individual pages
 * too.
 */
export async function crawlAndAnalyze(startUrl, { maxPages = DEFAULT_MAX_PAGES, verbose = false, ignoreRules = [] } = {}) {
  const visited = new Set();
  const queue = [startUrl];
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    if (verbose) info(`Crawling (${pages.length + 1}/${maxPages}): ${url}`);

    let site;
    try {
      site = await collectSite(url, { verbose: false });
    } catch (err) {
      warn(`Skipping ${url}: ${err.message}`);
      continue;
    }

    try {
      const { findings, stats, selectorMatches } = await runFullAnalysis(site, { verbose: false, ignoreRules });
      pages.push({ url: site.url, finalUrl: site.finalUrl, title: site.title, findings, stats, selectorMatches });

      if (pages.length < maxPages) {
        const links = await discoverLinks(site.page, site.finalUrl || url);
        for (const link of links) {
          if (!visited.has(link) && !queue.includes(link)) queue.push(link);
        }
      }
    } catch (err) {
      warn(`Failed analyzing ${url}: ${err.message}`);
    } finally {
      await site.browser.close();
    }
  }

  return pages;
}

function findingKey(f) {
  return `${f.category}|${f.selector || ""}|${f.source || ""}|${f.line || ""}|${f.message}`;
}

/**
 * Merges findings across crawled pages:
 *  - "unused" findings are kept only for selectors that never matched an
 *    element on ANY crawled page — built from each page's raw selectorMatches
 *    (not from other findings, since a selector that's used but otherwise
 *    unremarkable produces no finding at all and would be invisible to a
 *    findings-only heuristic). A selector never even parsed on a given page
 *    (its stylesheet wasn't loaded there) contributes no signal either way.
 *  - Every other finding is deduped by (category, selector, source, line,
 *    message); a finding appearing on N pages is reported once, with
 *    meta.pageCount/meta.pages recording how widely it applies.
 */
export function mergeFindings(pages) {
  const matchedAnywhere = new Set(); // "source|selector" for anything that matched on at least one page
  for (const page of pages) {
    for (const m of page.selectorMatches || []) {
      if (m.matched) matchedAnywhere.add(`${m.source}|${m.selector}`);
    }
  }

  const byKey = new Map(); // key -> { finding, pages: Set<url> }
  for (const page of pages) {
    for (const f of page.findings) {
      const key = findingKey(f);
      if (!byKey.has(key)) byKey.set(key, { finding: f, pages: new Set() });
      byKey.get(key).pages.add(page.url);
    }
  }

  const merged = [];
  for (const { finding, pages: onPages } of byKey.values()) {
    if (finding.category === "unused" && finding.selector) {
      const key = `${finding.source || ""}|${finding.selector}`;
      if (matchedAnywhere.has(key)) continue; // used on at least one crawled page — not truly unused
    }
    merged.push({
      ...finding,
      meta: { ...finding.meta, pageCount: onPages.size, pages: [...onPages] },
    });
  }

  return merged;
}
