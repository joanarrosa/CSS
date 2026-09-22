export type Severity = "critical" | "serious" | "moderate" | "minor";
export type WcagLevel = "A" | "AA" | "AAA";

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** A single page/template/route to scan. */
export interface PageTarget {
  name: string;
  url: string;
}

/**
 * A scripted user flow (login, add-to-cart, search, checkout...). `run`
 * drives the interaction with Playwright and leaves the page in the state
 * that should then be scanned (e.g. a modal open, a cart with an item in
 * it) — axe-core alone only ever sees static page loads, so this is how we
 * cover flows instead of just routes.
 */
export interface Flow {
  name: string;
  description: string;
  /** Navigates and performs the interaction; page is scanned once this resolves. */
  run: (page: import("playwright").Page, baseUrl: string) => Promise<void>;
}

/** One thing found wrong, from any source (axe or a manual/semi-automated check). */
export interface Finding {
  id: string;
  source: "axe" | "keyboard" | "heading-hierarchy" | "contrast" | "reflow" | "live-region";
  ruleId: string;
  wcagCriteria: string[];
  wcagLevel: WcagLevel;
  en301549?: string;
  severity: Severity;
  /** 1 (barely noticeable) - 5 (blocks task completion for affected users). */
  impact: number;
  /** 1 (trivial, one attribute) - 5 (structural/component rework). */
  effort: number;
  title: string;
  description: string;
  help?: string;
  helpUrl?: string;
  /** CSS selector(s) of the affected element(s), for evidence + re-testing. */
  target: string[];
  /** HTML snippet showing the actual problem markup. */
  snippet?: string;
  /** Concrete fix — real markup/attribute changes, not generic advice. */
  fix: string;
  page: string;
  url: string;
  viewport: string;
  flow?: string;
  /** Relative path (within the same report folder) to an evidence screenshot. */
  screenshot?: string;
  isBonusAAA?: boolean;
  /** How many elements/occurrences this finding represents, when collapsed. */
  occurrences: number;
}

/** Raw axe-core result for one page+viewport(+flow) run, before parsing into Findings. */
export interface RawAxeRun {
  page: string;
  url: string;
  viewport: string;
  flow?: string;
  axeResults: import("axe-core").AxeResults;
}

export interface ScanConfig {
  targets: PageTarget[];
  flows: Flow[];
  viewports: Viewport[];
  /** Base URL flows resolve their relative paths against. */
  baseUrl: string;
  outDir: string;
  screenshots: boolean;
  chromiumExecutablePath?: string;
}

export interface ManualChecklistItem {
  label: string;
  reason: string;
}

export interface ReportSummary {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  total: number;
  bySeverity: Record<Severity, number>;
  byWcagCriterion: Record<string, number>;
  pagesScanned: number;
  viewportsScanned: number;
  flowsScanned: number;
}

export interface ReportData {
  generatedAt: string;
  targets: PageTarget[];
  /** Just name/description — Flow.run isn't serializable and isn't report data anyway. */
  flows: { name: string; description: string }[];
  viewports: Viewport[];
  findings: Finding[];
  summary: ReportSummary;
  manualChecklist: ManualChecklistItem[];
}
