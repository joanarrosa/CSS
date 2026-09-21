import { collectSite, FetchError } from "./collect.js";
import { runFullAnalysis } from "./analyze/index.js";
import { printTerminalReport } from "./report/terminal.js";
import { toJsonReport } from "./report/json.js";
import { runAxeAudit, toAccessibilityReport } from "./axeAudit.js";
import { printAccessibilityReport } from "./report/axeTerminal.js";
import { loadConfig, warnIfConfigProblem } from "./config.js";
import { parseFailOn, shouldFail } from "./utils/failOn.js";
import { buildHtmlReport } from "./report/html.js";
import { captureAnnotatedScreenshot, buildCssAnnotations, buildA11yAnnotations } from "./screenshot.js";
import { crawlAndAnalyze, mergeFindings } from "./crawl.js";
import { error as logError, info } from "./utils/logger.js";

const HELP = `css-audit — analyze the CSS a page actually uses

Usage:
  css-audit <url> [options]

Options:
  --json           Output a machine-readable JSON report instead of the terminal report
  --html           Write a single, self-contained HTML report (styled like the web UI, no
                    server needed to view it) instead of printing to the terminal
  --out <file>     Write the report to a file instead of stdout (default filename with --html)
  --a11y-report    Run a full WCAG 2.1 A/AA accessibility audit (axe-core) instead of the CSS audit
  --config <file>  Ignore-rules config (default: .css-auditrc.json in the current directory, if present)
  --fail-on <val>  Exit with code 1 if the result is worse than <val>: a letter grade (A-F,
                    e.g. "B" fails on C/D/F) or a numeric score 0-100 (fails if score < val).
                    For CI: gate a pipeline on css-audit without parsing its output.
  --screenshot <file>  Save a full-page screenshot with the worst offending elements
                        outlined and numbered
  --crawl          Crawl same-origin pages from <url> (breadth-first) and merge results —
                    a selector is only reported "unused" if it's unused on every crawled
                    page. Not yet supported together with --a11y-report or --screenshot.
  --max-pages <n>  Max pages to visit with --crawl (default: 5)
  --fix            Write auto-fixed copies of the stylesheets for safe findings (dead
                    overridden declarations, non-conflicting duplicate selectors) — see
                    "Auto-fix mode" below. Not supported with --crawl or --a11y-report.
  --fix-out <dir>  Directory to write auto-fixed stylesheets into (default: css-audit-fixes)
  --verbose        Print progress information to stderr
  -h, --help       Show this help
`;

export async function main(argv) {
  const args = parseArgs(argv);

  if (args.help || !args.url) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }

  let failOnThreshold = null;
  if (args.failOn) {
    try {
      failOnThreshold = parseFailOn(args.failOn);
    } catch (err) {
      logError(err.message);
      process.exit(2);
    }
  }

  const config = warnIfConfigProblem(() => loadConfig(args.config));
  if (args.verbose && config.path) info(`Using config: ${config.path} (${config.ignore.length} ignore rule(s))`);

  if (args.crawl) {
    if (args.a11yReport) {
      logError("--crawl doesn't support --a11y-report yet — run them separately.");
      process.exit(2);
    }
    if (args.screenshot) {
      logError("--crawl doesn't support --screenshot yet — run them separately.");
      process.exit(2);
    }
    if (args.fix) {
      logError("--crawl doesn't support --fix yet — run them separately.");
      process.exit(2);
    }
    await runCrawl(args, config, failOnThreshold);
    return;
  }

  if (args.fix && args.a11yReport) {
    logError("--fix only applies to the CSS audit, not --a11y-report.");
    process.exit(2);
  }

  let site;
  try {
    site = await collectSite(args.url, { verbose: args.verbose });
  } catch (err) {
    if (err instanceof FetchError) {
      logError(err.message);
      process.exit(2);
    }
    throw err;
  }

  try {
    if (args.a11yReport) {
      if (args.verbose) info("Running accessibility audit (axe-core)...");
      const raw = await runAxeAudit(site.page);
      const a11yReport = toAccessibilityReport(raw, { ignoreRules: config.ignore });
      const reportData = {
        url: site.url,
        finalUrl: site.finalUrl,
        title: site.title,
        warnings: site.warnings,
        ...a11yReport,
      };
      if (args.screenshot) await takeScreenshot(site.page, buildA11yAnnotations(a11yReport.violations), args.screenshot);
      const a11ySummary = await writeReport(reportData, args, printAccessibilityReport, null, "a11y");
      applyFailOn(a11ySummary, failOnThreshold);
      return;
    }

    const { findings, stats, autoFix } = await runFullAnalysis(site, { verbose: args.verbose, ignoreRules: config.ignore });

    const reportData = {
      url: site.url,
      finalUrl: site.finalUrl,
      title: site.title,
      status: site.status,
      warnings: site.warnings,
      stats,
      findings,
    };

    if (args.screenshot) await takeScreenshot(site.page, buildCssAnnotations(findings), args.screenshot);
    if (args.fix) await writeAutoFixes(autoFix, args.fixOut || "css-audit-fixes");
    const summary = await writeReport(reportData, args, printTerminalReport, toJsonReport, "css");
    applyFailOn(summary, failOnThreshold);
  } finally {
    await site.browser.close();
  }
}

async function runCrawl(args, config, failOnThreshold) {
  const maxPages = args.maxPages ? Number(args.maxPages) : undefined;
  if (args.maxPages && (!Number.isInteger(maxPages) || maxPages < 1)) {
    logError(`Invalid --max-pages value "${args.maxPages}" — must be a positive integer.`);
    process.exit(2);
  }

  const pages = await crawlAndAnalyze(args.url, { maxPages, verbose: args.verbose, ignoreRules: config.ignore });
  if (pages.length === 0) {
    logError(`Could not successfully analyze any page starting from "${args.url}".`);
    process.exit(2);
  }

  const findings = mergeFindings(pages);
  const first = pages[0];
  const stats = {
    totalRules: pages.reduce((sum, p) => sum + p.stats.totalRules, 0),
    totalSources: pages.reduce((sum, p) => sum + p.stats.totalSources, 0),
    parseErrors: pages.reduce((sum, p) => sum + p.stats.parseErrors, 0),
    ignored: pages.reduce((sum, p) => sum + p.stats.ignored, 0),
    pagesCrawled: pages.length,
    crawledUrls: pages.map((p) => p.url),
  };

  const reportData = {
    url: args.url,
    finalUrl: first.finalUrl,
    title: pages.length > 1 ? `${first.title} (+ ${pages.length - 1} more page${pages.length - 1 === 1 ? "" : "s"})` : first.title,
    status: null,
    warnings: [],
    stats,
    findings,
  };

  const summary = await writeReport(reportData, args, printTerminalReport, toJsonReport, "css");
  applyFailOn(summary, failOnThreshold);
}

async function writeAutoFixes(autoFix, outDir) {
  const { fixedSources, applied, skipped } = autoFix;

  if (fixedSources.length === 0) {
    info(applied.length === 0 ? "Auto-fix: nothing safe to fix." : "Auto-fix: no fixes could be applied (no writable source offsets).");
  } else {
    const fs = await import("node:fs/promises");
    await fs.mkdir(outDir, { recursive: true });
    const used = new Set();
    for (const { source, fixed } of fixedSources) {
      const filename = uniqueFilename(source, used);
      await fs.writeFile(`${outDir}/${filename}`, fixed, "utf8");
    }
    info(`Auto-fix: ${applied.length} fix(es) applied across ${fixedSources.length} source(s), written to ${outDir}/`);
    for (const a of applied) info(`  - ${a.description}`);
  }

  if (skipped.length) {
    info(`Auto-fix: ${skipped.length} finding(s) need manual review:`);
    for (const s of skipped) info(`  - ${s.description}: ${s.reason}`);
  }
}

function uniqueFilename(label, used) {
  let base = label
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  if (!base) base = "stylesheet";
  if (!base.endsWith(".css")) base += ".css";
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = base.replace(/\.css$/, `-${i}.css`);
    i++;
  }
  used.add(name);
  return name;
}

async function takeScreenshot(page, annotations, outPath) {
  if (annotations.length === 0) {
    info(`No high-severity findings to annotate — skipping screenshot.`);
    return;
  }
  const { path: savedPath, annotated } = await captureAnnotatedScreenshot(page, annotations, outPath);
  info(`Screenshot saved to ${savedPath} (${annotated} element(s) outlined).`);
}

function applyFailOn(summary, threshold) {
  if (!threshold) return;
  if (shouldFail(summary, threshold)) {
    const label = threshold.kind === "grade" ? `grade ${threshold.value}` : `score ${threshold.value}`;
    logError(`Score ${summary.score}/100 (${summary.grade}) fails the --fail-on ${label} threshold.`);
    process.exitCode = 1;
  }
}

async function writeReport(reportData, args, printFn, toJsonFn, kind) {
  const jsonPayload = toJsonFn ? toJsonFn(reportData) : reportData;

  if (args.html) {
    const fs = await import("node:fs/promises");
    const outPath = args.out || (kind === "a11y" ? "accessibility-report.html" : "css-audit-report.html");
    const htmlContent = buildHtmlReport(kind, jsonPayload);
    await fs.writeFile(outPath, htmlContent, "utf8");
    info(`HTML report written to ${outPath}`);
    return jsonPayload.summary;
  }

  const output = args.json ? JSON.stringify(jsonPayload, null, 2) : null;

  if (args.out) {
    const fs = await import("node:fs/promises");
    if (args.json) {
      await fs.writeFile(args.out, output, "utf8");
    } else {
      const chunks = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk) => {
        chunks.push(chunk);
        return true;
      };
      printFn(reportData);
      process.stdout.write = originalWrite;
      // Strip ANSI codes for file output.
      const text = chunks.join("").replace(/\x1b\[[0-9;]*m/g, "");
      await fs.writeFile(args.out, text, "utf8");
    }
    if (args.verbose) info(`Report written to ${args.out}`);
  } else if (args.json) {
    process.stdout.write(output + "\n");
  } else {
    printFn(reportData);
  }

  return jsonPayload.summary;
}

function parseArgs(argv) {
  const args = {
    url: null,
    json: false,
    html: false,
    out: null,
    verbose: false,
    help: false,
    a11yReport: false,
    config: null,
    failOn: null,
    screenshot: null,
    crawl: false,
    maxPages: null,
    fix: false,
    fixOut: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--html") args.html = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--a11y-report") args.a11yReport = true;
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--fail-on") args.failOn = argv[++i];
    else if (arg === "--screenshot") args.screenshot = argv[++i];
    else if (arg === "--crawl") args.crawl = true;
    else if (arg === "--max-pages") args.maxPages = argv[++i];
    else if (arg === "--fix") args.fix = true;
    else if (arg === "--fix-out") args.fixOut = argv[++i];
    else if (!arg.startsWith("-") && !args.url) args.url = arg;
  }
  return args;
}
