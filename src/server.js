import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSite, FetchError } from "./collect.js";
import { runFullAnalysis } from "./analyze/index.js";
import { toJsonReport } from "./report/json.js";
import { runAxeAudit, toAccessibilityReport } from "./axeAudit.js";
import { info, error as logError } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DEFAULT_PORT = 4173;
const MAX_BODY_BYTES = 1_000_000;

const STATIC_FILES = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "application/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", contentType: "image/svg+xml" },
};

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && STATIC_FILES[req.url]) {
        const { file, contentType } = STATIC_FILES[req.url];
        return await serveStatic(res, file, contentType);
      }
      if (req.method === "POST" && req.url === "/api/analyze") {
        return await handleAnalyze(req, res);
      }
      if (req.method === "POST" && req.url === "/api/accessibility-report") {
        return await handleAccessibilityReport(req, res);
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      logError(err.stack || err.message);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error." }));
    }
  });
}

async function serveStatic(res, file, contentType) {
  try {
    const data = await readFile(path.join(PUBLIC_DIR, file));
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

async function parseUrlFromBody(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    sendJson(res, 413, { error: err.message });
    return null;
  }

  let url;
  try {
    ({ url } = JSON.parse(body));
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body — expected {"url": "..."}.' });
    return null;
  }
  if (!url || typeof url !== "string") {
    sendJson(res, 400, { error: 'Missing "url" in request body.' });
    return null;
  }
  return url;
}

async function loadSite(url, res) {
  try {
    info(`Loading ${url} ...`);
    return await collectSite(url, { verbose: false });
  } catch (err) {
    if (err instanceof FetchError) {
      sendJson(res, 422, { error: err.message });
      return null;
    }
    logError(err.stack || err.message);
    sendJson(res, 500, { error: `Unexpected error while loading the page: ${err.message}` });
    return null;
  }
}

async function handleAnalyze(req, res) {
  const url = await parseUrlFromBody(req, res);
  if (url === null) return;

  const site = await loadSite(url, res);
  if (site === null) return;

  try {
    const { findings, stats } = await runFullAnalysis(site, { verbose: false });
    const report = toJsonReport({
      url: site.url,
      finalUrl: site.finalUrl,
      title: site.title,
      status: site.status,
      warnings: site.warnings,
      stats,
      findings,
    });
    sendJson(res, 200, report);
  } catch (err) {
    logError(err.stack || err.message);
    sendJson(res, 500, { error: `Unexpected error while analyzing CSS: ${err.message}` });
  } finally {
    await site.browser.close();
  }
}

async function handleAccessibilityReport(req, res) {
  const url = await parseUrlFromBody(req, res);
  if (url === null) return;

  const site = await loadSite(url, res);
  if (site === null) return;

  try {
    info(`Running accessibility audit for ${url} ...`);
    const raw = await runAxeAudit(site.page);
    const report = toAccessibilityReport(raw);
    sendJson(res, 200, {
      url: site.url,
      finalUrl: site.finalUrl,
      title: site.title,
      warnings: site.warnings,
      ...report,
    });
  } catch (err) {
    logError(err.stack || err.message);
    sendJson(res, 500, { error: `Unexpected error while running the accessibility audit: ${err.message}` });
  } finally {
    await site.browser.close();
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large."));
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

export function startServer(port = DEFAULT_PORT) {
  const server = createServer();
  server.listen(port, () => {
    info(`css-audit web UI running at http://localhost:${port}`);
  });
  return server;
}
