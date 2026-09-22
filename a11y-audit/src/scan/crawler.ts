import { chromium } from "playwright";
import { dismissConsentBanner } from "./consent.js";

export interface CrawlOptions {
  maxPages: number;
  dismissText?: string;
  chromiumExecutablePath?: string;
  log?: (msg: string) => void;
}

/**
 * Fallback for sites with no sitemap: actually browses the site like a
 * visitor would — load a page, find every same-origin <a href>, queue them,
 * repeat breadth-first — instead of relying on the site to have published a
 * list of its own URLs. Needs a real browser (not a plain fetch, unlike
 * sitemap.ts) because navigation links on a JS-rendered app often don't
 * exist in the raw HTML until the page actually runs.
 *
 * Runs in its own short-lived browser instance, separate from the real scan
 * that follows — this is purely link discovery, no axe/checks run here.
 */
export async function crawlSameOrigin(startUrl: string, opts: CrawlOptions): Promise<string[]> {
  const { maxPages, dismissText, chromiumExecutablePath, log } = opts;
  const origin = new URL(startUrl).origin;
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutablePath });
  const discovered: string[] = [];

  try {
    const page = await browser.newPage();
    const visited = new Set<string>();
    const queue = [startUrl];

    while (queue.length > 0 && discovered.length < maxPages) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      log?.(`Crawling (${discovered.length + 1}/${maxPages}): ${url}`);
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      } catch {
        continue;
      }

      await dismissConsentBanner(page, dismissText);
      discovered.push(page.url());
      if (discovered.length >= maxPages) break;

      let hrefs: string[] = [];
      try {
        hrefs = await page.$$eval("a[href]", (els) => els.map((el) => el.getAttribute("href") || ""));
      } catch {
        hrefs = [];
      }

      for (const href of hrefs) {
        if (!href) continue;
        let resolved: URL;
        try {
          resolved = new URL(href, page.url());
        } catch {
          continue;
        }
        if (resolved.origin !== origin) continue;
        if (!/^https?:$/.test(resolved.protocol)) continue;
        resolved.hash = "";
        const clean = resolved.toString();
        if (!visited.has(clean) && !queue.includes(clean)) queue.push(clean);
      }
    }
  } finally {
    await browser.close();
  }

  return discovered;
}
