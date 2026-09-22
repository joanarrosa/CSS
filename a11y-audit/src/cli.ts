#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runScan } from "./scan/runner.js";
import { DEFAULT_VIEWPORTS } from "./scan/viewports.js";
import { buildReportData } from "./report/aggregate.js";
import { buildHtmlReport } from "./report/html.js";
import { buildJsonReport } from "./report/json.js";
import { buildCsvReport } from "./report/csv.js";
import type { Flow, PageTarget, ReportData, Severity, Viewport } from "./types.js";

const SEVERITY_ORDER: Severity[] = ["minor", "moderate", "serious", "critical"];

interface CliOptions {
  url: string[];
  config?: string;
  flows?: string;
  viewport: string[];
  out?: string;
  baseUrl?: string;
  failOn?: string;
  screenshots: boolean;
  verbose: boolean;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("a11y-audit")
    .description("WCAG 2.1/2.2 AA accessibility scanner: automated axe-core scans plus manual/semi-automated checks, scored HTML/JSON/CSV reports.")
    .option("-u, --url <url>", "page to scan (repeatable — pass -u multiple times for multiple pages)", collect, [])
    .option("--config <file>", "JSON file with { targets: [{name, url}], viewports?: [{name,width,height}] } for more control than --url")
    .option("--flows <file>", "path to a .js module that default-exports a Flow[] (see README 'Testing user flows')")
    .option(
      "--viewport <name>",
      "viewport to test: desktop, tablet, or mobile (repeatable; default: all three)",
      collect,
      []
    )
    .option("--base-url <url>", "base URL flows resolve relative paths against (default: first target's origin)")
    .option("-o, --out <dir>", "output directory (default: ./reports/<timestamp>/)")
    .option("--fail-on <value>", "exit 1 if the result is worse than <value>: a severity (critical/serious/moderate/minor) or a 0-100 score")
    .option("--no-screenshots", "skip evidence screenshots (faster)")
    .option("-v, --verbose", "print scan progress", false)
    .parse(process.argv);

  const opts = program.opts<CliOptions>();

  let configTargets: PageTarget[] = [];
  let configViewports: Viewport[] | undefined;
  if (opts.config) {
    const raw = JSON.parse(await readFile(path.resolve(opts.config), "utf8"));
    if (Array.isArray(raw.targets)) configTargets = raw.targets;
    if (Array.isArray(raw.viewports)) configViewports = raw.viewports;
  }

  const urlTargets: PageTarget[] = opts.url.map((u) => ({ name: deriveNameFromUrl(u), url: u }));
  const targets = [...configTargets, ...urlTargets];

  let flows: Flow[] = [];
  if (opts.flows) {
    const mod = await import(pathToFileURL(path.resolve(opts.flows)).href);
    flows = mod.default ?? mod.flows ?? [];
    if (!Array.isArray(flows)) {
      fail(`--flows file must default-export an array of Flow objects (got ${typeof flows}).`);
    }
  }

  if (targets.length === 0 && flows.length === 0) {
    program.error("Provide at least one --url, a --config file with targets, or a --flows file. Run with --help for usage.");
  }

  const viewports = resolveViewports(opts.viewport, configViewports);
  const baseUrl = opts.baseUrl ?? (targets[0] ? new URL(targets[0].url).origin : undefined);
  if (flows.length > 0 && !baseUrl) {
    fail("--flows requires a base URL to resolve relative paths against — pass at least one --url, or set --base-url explicitly.");
  }

  let failOnSeverity: Severity | undefined;
  let failOnScore: number | undefined;
  if (opts.failOn) {
    const val = opts.failOn.toLowerCase();
    if ((SEVERITY_ORDER as string[]).includes(val)) {
      failOnSeverity = val as Severity;
    } else if (/^\d+$/.test(opts.failOn) && Number(opts.failOn) >= 0 && Number(opts.failOn) <= 100) {
      failOnScore = Number(opts.failOn);
    } else {
      fail(`Invalid --fail-on value "${opts.failOn}" — use a severity (critical/serious/moderate/minor) or a number 0-100.`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = opts.out ? path.resolve(opts.out) : path.resolve("reports", timestamp);
  await mkdir(outDir, { recursive: true });

  const log = (msg: string) => {
    if (opts.verbose) console.error(`[a11y-audit] ${msg}`);
  };

  log(`Scanning ${targets.length} page(s) and ${flows.length} flow(s) across ${viewports.length} viewport(s)...`);

  const config = {
    targets,
    flows,
    viewports,
    baseUrl: baseUrl ?? "",
    outDir,
    screenshots: opts.screenshots,
    chromiumExecutablePath: process.env.A11Y_AUDIT_CHROMIUM_PATH || process.env.CSS_AUDIT_CHROMIUM_PATH,
  };

  const result = await runScan(config, log);
  const reportData = buildReportData(result.findings, config, result);

  await writeFile(path.join(outDir, "report.html"), buildHtmlReport(reportData), "utf8");
  await writeFile(path.join(outDir, "report.json"), buildJsonReport(reportData), "utf8");
  await writeFile(path.join(outDir, "report.csv"), buildCsvReport(reportData), "utf8");

  printSummary(reportData);
  console.log(`\nReports written to ${outDir}/ (report.html, report.json, report.csv)`);

  if (failOnSeverity) {
    const rank = SEVERITY_ORDER.indexOf(failOnSeverity);
    const worst = result.findings.some((f) => SEVERITY_ORDER.indexOf(f.severity) >= rank);
    if (worst) {
      console.error(`\nFAIL: found a finding at or above severity "${failOnSeverity}".`);
      process.exitCode = 1;
    }
  } else if (failOnScore !== undefined) {
    if (reportData.summary.score < failOnScore) {
      console.error(`\nFAIL: score ${reportData.summary.score} is below the --fail-on threshold of ${failOnScore}.`);
      process.exitCode = 1;
    }
  }
}

function printSummary(data: ReportData): void {
  const s = data.summary;
  console.log(`\nAccessibility score: ${s.score}/100 (${s.grade})`);
  console.log(`  ${s.bySeverity.critical} critical  ${s.bySeverity.serious} serious  ${s.bySeverity.moderate} moderate  ${s.bySeverity.minor} minor  (${s.total} total)`);
  const topWcag = Object.entries(s.byWcagCriterion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topWcag.length) {
    console.log(`  Top WCAG criteria: ${topWcag.map(([sc, n]) => `${sc} (${n})`).join(", ")}`);
  }
  console.log(`\n  ${data.manualChecklist.length} manual verification item(s) — see the HTML report's "Manual verification still required" section.`);
}

function resolveViewports(names: string[], configViewports?: Viewport[]): Viewport[] {
  if (configViewports && configViewports.length) return configViewports;
  if (names.length === 0) return DEFAULT_VIEWPORTS;
  const byName = new Map(DEFAULT_VIEWPORTS.map((v) => [v.name, v]));
  const out: Viewport[] = [];
  for (const n of names) {
    const v = byName.get(n.toLowerCase());
    if (!v) fail(`Unknown viewport "${n}" — use desktop, tablet, or mobile.`);
    else out.push(v);
  }
  return out;
}

function deriveNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p && p !== "" ? `${u.hostname}${p}`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || u.hostname : u.hostname;
  } catch {
    return url;
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function fail(msg: string): never {
  console.error(`[a11y-audit] ${msg}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(`[a11y-audit] ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
