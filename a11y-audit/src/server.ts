#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "./scan/runner.js";
import { DEFAULT_VIEWPORTS } from "./scan/viewports.js";
import { buildReportData } from "./report/aggregate.js";
import { buildHtmlReport } from "./report/html.js";
import { buildJsonReport } from "./report/json.js";
import { buildCsvReport } from "./report/csv.js";
import { buildAppShellHtml } from "./report/templates/appShell.js";
import type { Viewport } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "report", "templates");
const REPORTS_ROOT = path.resolve(process.cwd(), "reports");

const PORT = Number(process.env.PORT) || 4174;

const ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

async function main(): Promise<void> {
  await mkdir(REPORTS_ROOT, { recursive: true });

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[a11y-audit] Unhandled server error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("Internal server error.");
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[a11y-audit] Port ${PORT} is already in use — a server is probably already running (maybe from an earlier launch). Open http://localhost:${PORT} directly.`
      );
      process.exit(0);
    }
    console.error("[a11y-audit] Server failed to start:", err);
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`[a11y-audit] web UI running at http://localhost:${PORT}`);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildAppShellHtml());
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    await serveStaticFile(path.join(TEMPLATES_DIR, url.pathname.slice("/assets/".length)), res, TEMPLATES_DIR);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
    await serveStaticFile(path.join(REPORTS_ROOT, url.pathname.slice("/reports/".length)), res, REPORTS_ROOT);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scan") {
    await handleScan(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found.");
}

async function serveStaticFile(filePath: string, res: ServerResponse, mustBeUnder?: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (mustBeUnder && !resolved.startsWith(path.resolve(mustBeUnder) + path.sep) && resolved !== path.resolve(mustBeUnder)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden.");
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("not a file");
    const content = await readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, { "Content-Type": ASSET_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found.");
  }
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function resolveViewports(names: string[]): Viewport[] | null {
  const byName = new Map(DEFAULT_VIEWPORTS.map((v) => [v.name, v]));
  const out: Viewport[] = [];
  for (const n of names) {
    const v = byName.get(String(n).toLowerCase());
    if (!v) return null;
    out.push(v);
  }
  return out;
}

async function handleScan(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid JSON body.");
    return;
  }

  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
    if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("bad protocol");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`"${rawUrl}" is not a valid http(s) URL.`);
    return;
  }

  const viewportNames = Array.isArray(body.viewports) && body.viewports.length ? body.viewports : DEFAULT_VIEWPORTS.map((v) => v.name);
  const viewports = resolveViewports(viewportNames);
  if (!viewports) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Unknown viewport name — use desktop, tablet, or mobile.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  const send = (event: object) => {
    res.write(JSON.stringify(event) + "\n");
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scanId = `web-${timestamp}`;
  const outDir = path.join(REPORTS_ROOT, scanId);
  await mkdir(outDir, { recursive: true });

  const config = {
    targets: [{ name: parsedUrl.hostname + parsedUrl.pathname.replace(/\/+$/, ""), url: parsedUrl.toString() }],
    flows: [],
    viewports,
    baseUrl: parsedUrl.origin,
    outDir,
    screenshots: true,
    chromiumExecutablePath: process.env.A11Y_AUDIT_CHROMIUM_PATH || process.env.CSS_AUDIT_CHROMIUM_PATH,
  };

  try {
    send({ type: "progress", message: `Launching browser, scanning ${parsedUrl.toString()}...` });
    const result = await runScan(config, (msg) => send({ type: "progress", message: msg }));
    send({ type: "progress", message: "Building report..." });
    const reportData = buildReportData(result.findings, config, result);

    await writeFile(path.join(outDir, "report.html"), buildHtmlReport(reportData), "utf8");
    await writeFile(path.join(outDir, "report.json"), buildJsonReport(reportData), "utf8");
    await writeFile(path.join(outDir, "report.csv"), buildCsvReport(reportData), "utf8");

    send({ type: "done", data: reportData, reportUrlBase: `/reports/${scanId}` });
  } catch (err) {
    send({ type: "error", message: friendlyScanError(err) });
  } finally {
    res.end();
  }
}

function friendlyScanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/net::ERR_NAME_NOT_RESOLVED/.test(msg)) return "Could not resolve that domain — check the URL is correct.";
  if (/net::ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_TIMED_OUT|net::ERR_ADDRESS_UNREACHABLE/.test(msg))
    return "Could not connect — the server may be down, unreachable, or need a VPN.";
  if (/Timeout.*exceeded/.test(msg)) return "Timed out loading the page — it may be very slow or stuck loading resources.";
  if (/executable doesn't exist|Executable doesn't exist/i.test(msg))
    return "The browser Playwright needs isn't installed — run: npx playwright install chromium";
  return msg;
}

main().catch((err) => {
  console.error("[a11y-audit]", err);
  process.exit(1);
});
