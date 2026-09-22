/**
 * Discovers page URLs from a site's sitemap instead of relying on the one
 * URL a user pasted in. Tries, in order: any Sitemap: directive in
 * robots.txt, then the conventional /sitemap.xml and /sitemap_index.xml
 * locations. Handles sitemap index files (a sitemap that just lists other
 * sitemaps) by recursing into them, capped to avoid a pathological or
 * malicious sitemap chain running away. Returns [] if nothing is found —
 * callers should fall back to scanning the single URL they started with.
 */

const MAX_SITEMAP_DEPTH = 3;
const MAX_SUB_SITEMAPS = 20;
const FETCH_TIMEOUT_MS = 10000;

export async function discoverSitemapUrls(startUrl: string, { maxUrls = 500 }: { maxUrls?: number } = {}): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const candidates: string[] = [];

  const robotsSitemaps = await findSitemapsInRobotsTxt(origin);
  candidates.push(...robotsSitemaps);
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  const visitedSitemaps = new Set<string>();
  for (const candidate of candidates) {
    if (visitedSitemaps.has(candidate)) continue;
    const urls = await fetchAndParseSitemap(candidate, visitedSitemaps, maxUrls, 0);
    if (urls.length > 0) {
      const sameOrigin = urls.filter((u) => isSameOrigin(u, origin));
      return dedupe(sameOrigin).slice(0, maxUrls);
    }
  }
  return [];
}

async function findSitemapsInRobotsTxt(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`);
    if (!res.ok) return [];
    const text = await res.text();
    const matches = [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)];
    return matches.map((m) => m[1]);
  } catch {
    return [];
  }
}

async function fetchAndParseSitemap(url: string, visited: Set<string>, maxUrls: number, depth: number): Promise<string[]> {
  if (depth > MAX_SITEMAP_DEPTH || visited.has(url)) return [];
  visited.add(url);

  let text: string;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json") || contentType.includes("html")) return [];
    text = await res.text();
  } catch {
    return [];
  }

  if (!/<urlset|<sitemapindex/i.test(text)) return [];

  if (/<sitemapindex/i.test(text)) {
    const subSitemaps = extractLocs(text).slice(0, MAX_SUB_SITEMAPS);
    const out: string[] = [];
    for (const sub of subSitemaps) {
      const urls = await fetchAndParseSitemap(sub, visited, maxUrls, depth + 1);
      out.push(...urls);
      if (out.length >= maxUrls) break;
    }
    return out;
  }

  return extractLocs(text);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timeout);
  }
}

function extractLocs(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)];
  return matches.map((m) => decodeXmlEntities(m[1].trim())).filter(Boolean);
}

function decodeXmlEntities(str: string): string {
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

export function nameFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const p = u.pathname.replace(/\/+$/, "");
    const name = `${u.hostname}${p}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return name || u.hostname;
  } catch {
    return urlStr;
  }
}
