import { collectSite, FetchError } from "./collect.js";
import { runFullAnalysis } from "./analyze/index.js";
import { printTerminalReport } from "./report/terminal.js";
import { toJsonReport } from "./report/json.js";
import { runAxeAudit, toAccessibilityReport } from "./axeAudit.js";
import { printAccessibilityReport } from "./report/axeTerminal.js";
import { error as logError, info } from "./utils/logger.js";

const HELP = `css-audit — analyze the CSS a page actually uses

Usage:
  css-audit <url> [options]

Options:
  --json          Output a machine-readable JSON report instead of the terminal report
  --out <file>    Write the report to a file instead of stdout
  --a11y-report   Run a full WCAG 2.1 A/AA accessibility audit (axe-core) instead of the CSS audit
  --verbose       Print progress information to stderr
  -h, --help      Show this help
`;

export async function main(argv) {
  const args = parseArgs(argv);

  if (args.help || !args.url) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
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
      const a11yReport = toAccessibilityReport(raw);
      const reportData = {
        url: site.url,
        finalUrl: site.finalUrl,
        title: site.title,
        warnings: site.warnings,
        ...a11yReport,
      };
      await writeReport(reportData, args, printAccessibilityReport);
      return;
    }

    const { findings, stats } = await runFullAnalysis(site, { verbose: args.verbose });

    const reportData = {
      url: site.url,
      finalUrl: site.finalUrl,
      title: site.title,
      status: site.status,
      warnings: site.warnings,
      stats,
      findings,
    };

    await writeReport(reportData, args, printTerminalReport, toJsonReport);
  } finally {
    await site.browser.close();
  }
}

async function writeReport(reportData, args, printFn, toJsonFn) {
  const jsonPayload = toJsonFn ? toJsonFn(reportData) : reportData;
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
}

function parseArgs(argv) {
  const args = { url: null, json: false, out: null, verbose: false, help: false, a11yReport: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--a11y-report") args.a11yReport = true;
    else if (!arg.startsWith("-") && !args.url) args.url = arg;
  }
  return args;
}
