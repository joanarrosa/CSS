import { collectSite, FetchError } from "./collect.js";
import { runFullAnalysis } from "./analyze/index.js";
import { printTerminalReport } from "./report/terminal.js";
import { toJsonReport } from "./report/json.js";
import { error as logError, info } from "./utils/logger.js";

const HELP = `css-audit — analyze the CSS a page actually uses

Usage:
  css-audit <url> [options]

Options:
  --json          Output a machine-readable JSON report instead of the terminal report
  --out <file>    Write the report to a file instead of stdout
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

    const output = args.json ? JSON.stringify(toJsonReport(reportData), null, 2) : null;

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
        printTerminalReport(reportData);
        process.stdout.write = originalWrite;
        // Strip ANSI codes for file output.
        const text = chunks.join("").replace(/\x1b\[[0-9;]*m/g, "");
        await fs.writeFile(args.out, text, "utf8");
      }
      if (args.verbose) info(`Report written to ${args.out}`);
    } else if (args.json) {
      process.stdout.write(output + "\n");
    } else {
      printTerminalReport(reportData);
    }
  } finally {
    await site.browser.close();
  }
}

function parseArgs(argv) {
  const args = { url: null, json: false, out: null, verbose: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && !args.url) args.url = arg;
  }
  return args;
}
