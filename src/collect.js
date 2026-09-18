import { chromium } from "playwright";
import { isThirdPartyAdOrTracking } from "./utils/thirdParty.js";
import { warn, info } from "./utils/logger.js";

const NAV_TIMEOUT_MS = 30000;
const SETTLE_DELAY_MS = 500;

export class FetchError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "FetchError";
    this.code = code || "FETCH_FAILED";
  }
}

/**
 * Loads `url` in headless Chromium, captures every stylesheet the page
 * actually uses (linked, inline <style>, and inline style="" attributes),
 * and returns the still-open page/browser so later analysis stages can run
 * live DOM queries (selector matching, computed styles) against it.
 */
export async function collectSite(url, { verbose = false } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new FetchError(`"${url}" is not a valid URL. Include the protocol, e.g. https://example.com`, {
      code: "INVALID_URL",
    });
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new FetchError(`Only http:// and https:// URLs are supported (got "${parsedUrl.protocol}").`, {
      code: "INVALID_URL",
    });
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CSS_AUDIT_CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; css-audit/1.0; +https://github.com/) CSSAuditBot",
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();

  const warnings = [];
  const stylesheetResponses = new Map(); // url -> { text, status, contentType }

  page.on("response", (response) => {
    const req = response.request();
    if (req.resourceType() !== "stylesheet") return;
    const respUrl = response.url();
    response
      .text()
      .then((text) => {
        stylesheetResponses.set(respUrl, {
          text,
          status: response.status(),
          contentType: response.headers()["content-type"] || "",
        });
      })
      .catch((err) => {
        warnings.push(`Could not read stylesheet body for ${respUrl}: ${err.message}`);
      });
  });

  page.on("requestfailed", (request) => {
    if (request.resourceType() === "stylesheet") {
      warnings.push(
        `Stylesheet request failed: ${request.url()} (${request.failure()?.errorText || "unknown error"})`
      );
    }
  });

  let mainResponse;
  try {
    if (verbose) info(`Navigating to ${url} ...`);
    mainResponse = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT_MS,
    });
  } catch (err) {
    await browser.close();
    if (/net::ERR_NAME_NOT_RESOLVED/.test(err.message)) {
      throw new FetchError(`Could not resolve the domain in "${url}". Check the URL is correct.`, {
        code: "DNS_ERROR",
      });
    }
    if (
      /net::ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_TIMED_OUT|net::ERR_CONNECTION_CLOSED|net::ERR_TUNNEL_CONNECTION_FAILED|net::ERR_ADDRESS_UNREACHABLE/.test(
        err.message
      )
    ) {
      throw new FetchError(`Could not connect to "${url}". The server may be down, unreachable, or blocking this connection.`, {
        code: "CONNECTION_ERROR",
      });
    }
    if (/net::ERR_CERT_|net::ERR_SSL_/.test(err.message)) {
      throw new FetchError(`TLS/certificate error loading "${url}". The site's HTTPS certificate may be invalid or self-signed.`, {
        code: "TLS_ERROR",
      });
    }
    if (/Timeout.*exceeded/.test(err.message)) {
      throw new FetchError(
        `Timed out loading "${url}" after ${NAV_TIMEOUT_MS / 1000}s. The page may be very slow or stuck loading resources.`,
        { code: "TIMEOUT" }
      );
    }
    throw new FetchError(`Failed to load "${url}": ${err.message}`, { code: "NAVIGATION_ERROR" });
  }

  // Let any JS-driven style injection (CSS-in-JS, late <style> tags, etc.) settle.
  await page.waitForTimeout(SETTLE_DELAY_MS);

  const status = mainResponse ? mainResponse.status() : null;
  if (status && status >= 400) {
    warnings.push(
      `The page responded with HTTP ${status}. This may be an error page rather than real site content, so results could be misleading.`
    );
  }

  const finalUrl = page.url();
  const title = await page.title().catch(() => "");

  if (status === 401 || status === 403) {
    throw new FetchError(
      `"${url}" returned HTTP ${status}. The page appears to require authentication that this tool cannot provide.`,
      { code: "AUTH_REQUIRED" }
    );
  }
  if (/\b(login|signin|sign-in|sso|auth)\b/i.test(finalUrl) && finalUrl !== url) {
    warnings.push(
      `The page redirected to what looks like a login URL (${finalUrl}). This may be an authentication wall — results may reflect the login page, not the intended content.`
    );
  }

  // Collect <style> blocks, in document order.
  const styleBlocks = await page.$$eval("style", (nodes) =>
    nodes.map((n, i) => ({
      index: i,
      text: n.textContent || "",
      media: n.getAttribute("media") || "",
    }))
  );

  // Collect <link rel=stylesheet> elements, in document order.
  const linkEls = await page.$$eval('link[rel~="stylesheet"]', (nodes) =>
    nodes.map((n, i) => ({
      index: i,
      href: n.href,
      media: n.getAttribute("media") || "",
      disabled: !!n.disabled,
    }))
  );

  // Collect inline style="" attributes with a best-effort readable selector path.
  const inlineStyleElements = await page.$$eval("[style]", (nodes) =>
    nodes.map((el, i) => {
      function cssPath(node) {
        const parts = [];
        let cur = node;
        let depth = 0;
        while (cur && cur.nodeType === 1 && depth < 4) {
          let part = cur.tagName.toLowerCase();
          if (cur.id) {
            part += `#${cur.id}`;
            parts.unshift(part);
            break;
          } else if (cur.className && typeof cur.className === "string") {
            const cls = cur.className.trim().split(/\s+/).slice(0, 2).join(".");
            if (cls) part += `.${cls}`;
          }
          parts.unshift(part);
          cur = cur.parentElement;
          depth++;
        }
        return parts.join(" > ");
      }
      return {
        index: i,
        selector: cssPath(el),
        style: el.getAttribute("style"),
      };
    })
  );

  const pageDomain = parsedUrl.hostname;

  const cssSources = [];
  let order = 0;

  for (const block of styleBlocks) {
    if (!block.text.trim()) continue;
    cssSources.push({
      id: `style-${block.index}`,
      type: "style",
      label: `<style> block #${block.index + 1}`,
      href: null,
      media: block.media,
      text: block.text,
      order: order++,
    });
  }

  let thirdPartyExcluded = 0;
  for (const link of linkEls) {
    if (link.disabled) continue;
    let hostname = "";
    try {
      hostname = new URL(link.href).hostname;
    } catch {
      // ignore
    }
    if (isThirdPartyAdOrTracking(hostname)) {
      thirdPartyExcluded++;
      continue;
    }
    const resp = stylesheetResponses.get(link.href);
    if (!resp) {
      warnings.push(`Could not capture content for stylesheet: ${link.href}`);
      continue;
    }
    if (resp.status >= 400) {
      warnings.push(`Stylesheet returned HTTP ${resp.status}: ${link.href}`);
      continue;
    }
    cssSources.push({
      id: `link-${cssSources.length}`,
      type: "link",
      label: link.href,
      href: link.href,
      media: link.media,
      text: resp.text,
      order: order++,
      crossOrigin: hostname && hostname !== pageDomain,
    });
  }

  // Any stylesheet responses we captured that weren't matched to a <link>
  // element (e.g. @import chains) — attribute them to their importing order.
  for (const [respUrl, resp] of stylesheetResponses) {
    if (cssSources.some((s) => s.href === respUrl)) continue;
    let hostname = "";
    try {
      hostname = new URL(respUrl).hostname;
    } catch {
      // ignore
    }
    if (isThirdPartyAdOrTracking(hostname)) {
      thirdPartyExcluded++;
      continue;
    }
    if (resp.status >= 400) continue;
    cssSources.push({
      id: `import-${cssSources.length}`,
      type: "import",
      label: `${respUrl} (via @import)`,
      href: respUrl,
      media: "",
      text: resp.text,
      order: order++,
      crossOrigin: hostname && hostname !== pageDomain,
    });
  }

  if (thirdPartyExcluded > 0) {
    warnings.push(
      `Excluded ${thirdPartyExcluded} stylesheet(s) from known ad/tracking domains (not considered part of the site's own CSS).`
    );
  }

  if (cssSources.length === 0) {
    warnings.push("No CSS was found on this page (no <style> blocks or stylesheets).");
  }

  for (const w of warnings) warn(w);

  return {
    browser,
    context,
    page,
    url,
    finalUrl,
    title,
    status,
    cssSources,
    inlineStyleElements: inlineStyleElements.filter((el) => el.style && el.style.trim()),
    warnings,
  };
}
