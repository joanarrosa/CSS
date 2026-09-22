import type { Page } from "playwright";

/**
 * Cookie/consent banners sit on top of the real page and can pollute a scan
 * two ways: axe/the manual checks end up testing the banner's own markup
 * instead of (or in addition to) the page underneath, and the banner can
 * physically block interaction (keyboard-trap/focus checks especially).
 * This tries to dismiss one right after each navigation, two ways:
 *
 *  1. A short, curated list of known consent-management-platform selectors
 *     (OneTrust, Cookiebot, Didomi, ...) — works with zero configuration on
 *     any site using one of these, which covers a large share of sites.
 *  2. A caller-supplied button text match, for custom-built banners (e.g. a
 *     site's own OutSystems/Angular/whatever component) that don't use any
 *     of the above. This is what makes it generic rather than hardcoded to
 *     one site: the mechanism is built in, the text is configuration.
 *
 * Always best-effort — never throws, never blocks the scan if no banner
 * exists or the click fails for any reason.
 */

const KNOWN_CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "#didomi-notice-agree-button",
  "#truste-consent-button",
  ".qc-cmp2-summary-buttons button[mode='primary']",
  ".osano-cm-accept-all",
  "[data-testid='uc-accept-all-button']",
  ".coi-banner__accept",
];

export async function dismissConsentBanner(page: Page, dismissText?: string): Promise<void> {
  const viaVendor = await tryKnownVendors(page);
  if (!viaVendor && dismissText && dismissText.trim()) {
    await tryByText(page, dismissText.trim());
  }
  // Give any dismiss-triggered animation/layout shift a moment to settle.
  await page.waitForTimeout(200).catch(() => {});
}

async function tryKnownVendors(page: Page): Promise<boolean> {
  for (const selector of KNOWN_CONSENT_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) continue;
      await locator.click({ timeout: 1000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function tryByText(page: Page, text: string): Promise<boolean> {
  try {
    const candidates = page
      .locator('button, a, [role="button"], input[type="button"], input[type="submit"]')
      .filter({ hasText: text });
    if ((await candidates.count()) === 0) return false;
    await candidates.first().click({ timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}
