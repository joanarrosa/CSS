import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { AxeResults } from "axe-core";

// WCAG 2.1 AA is the primary target; also pull in WCAG 2.2 AA and the
// best-practice rule set (things every major a11y tool flags even though
// they're not tied to a single SC), plus EN 301 549 relevant tags. AAA rules
// are intentionally NOT included in the default tag set — analyze.ts labels
// them "bonus" only when a rule matches wcag2aaa/wcag21aaa explicitly, via
// a second, separate scan (see runAxeScan's `includeAaa` option).
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const AAA_TAGS = ["wcag2aaa", "wcag21aaa"];

export async function runAxeScan(page: Page, { includeAaa = true }: { includeAaa?: boolean } = {}): Promise<AxeResults> {
  const builder = new AxeBuilder({ page }).withTags(includeAaa ? [...AA_TAGS, ...AAA_TAGS] : AA_TAGS);
  return builder.analyze();
}
