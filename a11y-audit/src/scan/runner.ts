import { chromium } from "playwright";
import type { Finding, RawAxeRun, ScanConfig } from "../types.js";
import { runAxeScan } from "./axeScan.js";
import { checkHeadingHierarchy } from "../checks/headingHierarchy.js";
import { checkKeyboardNav } from "../checks/keyboardNav.js";
import { checkComponentContrast } from "../checks/contrastComponent.js";
import { checkReflowAtZoom } from "../checks/reflowZoom.js";
import { checkLiveRegions } from "../checks/liveRegions.js";
import { parseAxeRun } from "../parse/axeResults.js";
import { captureEvidenceScreenshot } from "./screenshot.js";

export interface ScanRunResult {
  findings: Finding[];
  rawAxeRuns: RawAxeRun[];
  pagesScanned: number;
  viewportsScanned: number;
  flowsScanned: number;
}

export async function runScan(config: ScanConfig, onProgress?: (msg: string) => void): Promise<ScanRunResult> {
  const log = onProgress ?? (() => {});
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    headless: true,
    executablePath: config.chromiumExecutablePath,
    proxy: proxyServer ? { server: proxyServer, bypass: "localhost,127.0.0.1" } : undefined,
  });

  const findings: Finding[] = [];
  const rawAxeRuns: RawAxeRun[] = [];

  try {
    for (const viewport of config.viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();

      for (const target of config.targets) {
        log(`Scanning ${target.name} @ ${viewport.name}...`);
        await page.goto(target.url, { waitUntil: "networkidle", timeout: 30000 });
        await scanCurrentState(page, { pageName: target.name, url: page.url(), viewport: viewport.name }, config, findings, rawAxeRuns);
      }

      for (const flow of config.flows) {
        log(`Running flow "${flow.name}" @ ${viewport.name}...`);
        try {
          await flow.run(page, config.baseUrl);
        } catch (err) {
          log(`  ! Flow "${flow.name}" failed to complete: ${(err as Error).message} — scanning whatever state it left the page in.`);
        }
        await scanCurrentState(page, { pageName: flow.name, url: page.url(), viewport: viewport.name, flow: flow.name }, config, findings, rawAxeRuns);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return {
    findings,
    rawAxeRuns,
    pagesScanned: config.targets.length,
    viewportsScanned: config.viewports.length,
    flowsScanned: config.flows.length,
  };
}

async function scanCurrentState(
  page: import("playwright").Page,
  ctx: { pageName: string; url: string; viewport: string; flow?: string },
  config: ScanConfig,
  findings: Finding[],
  rawAxeRuns: RawAxeRun[]
): Promise<void> {
  const axeResults = await runAxeScan(page);
  rawAxeRuns.push({ page: ctx.pageName, url: ctx.url, viewport: ctx.viewport, flow: ctx.flow, axeResults });
  const stateFindings = parseAxeRun({ page: ctx.pageName, url: ctx.url, viewport: ctx.viewport, flow: ctx.flow, axeResults });

  stateFindings.push(...(await checkHeadingHierarchy(page, ctx)));
  stateFindings.push(...(await checkKeyboardNav(page, ctx)));
  stateFindings.push(...(await checkComponentContrast(page, ctx)));
  stateFindings.push(...(await checkReflowAtZoom(page, ctx)));
  stateFindings.push(...(await checkLiveRegions(page, ctx)));

  if (config.screenshots) {
    const baseName = `${ctx.pageName}-${ctx.viewport}${ctx.flow ? `-${ctx.flow}` : ""}`;
    await captureEvidenceScreenshot(page, stateFindings, config.outDir, baseName);
  }

  findings.push(...stateFindings);
}
