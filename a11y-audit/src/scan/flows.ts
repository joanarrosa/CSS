import type { Flow } from "../types.js";

/**
 * Flows are inherently site-specific (there's no generic "add to cart"
 * selector), so this file ships small, reusable *factories* instead of
 * fixed flow instances — plug in your own selectors/URLs and pass the
 * result to the CLI via a custom flows file (--flows ./my-flows.ts, which
 * must default-export a Flow[]; see README "Testing user flows").
 *
 * No flows run by default — only the pages/templates you pass via
 * --url/--urls are scanned unless you supply --flows too.
 */

export function loginFlow(opts: {
  name?: string;
  loginPath: string; // relative to baseUrl, e.g. "/login"
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  username: string;
  password: string;
  waitForSelector?: string; // something present once logged in
}): Flow {
  return {
    name: opts.name ?? "login",
    description: `Log in via ${opts.loginPath} and land on the authenticated state.`,
    async run(page, baseUrl) {
      await page.goto(new URL(opts.loginPath, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.fill(opts.usernameSelector, opts.username);
      await page.fill(opts.passwordSelector, opts.password);
      await page.click(opts.submitSelector);
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 15000 });
      } else {
        await page.waitForLoadState("networkidle");
      }
    },
  };
}

export function addToCartFlow(opts: {
  name?: string;
  productPath: string; // relative to baseUrl, a product page
  addToCartSelector: string;
  waitForSelector?: string; // e.g. a cart-updated confirmation
}): Flow {
  return {
    name: opts.name ?? "add-to-cart",
    description: `Open ${opts.productPath} and add the product to the cart.`,
    async run(page, baseUrl) {
      await page.goto(new URL(opts.productPath, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.click(opts.addToCartSelector);
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 15000 });
      } else {
        await page.waitForTimeout(500);
      }
    },
  };
}

export function searchFlow(opts: {
  name?: string;
  startPath: string;
  searchInputSelector: string;
  query: string;
  submitSelector?: string; // if omitted, presses Enter
  waitForSelector?: string; // results container
}): Flow {
  return {
    name: opts.name ?? "search",
    description: `Search for "${opts.query}" from ${opts.startPath}.`,
    async run(page, baseUrl) {
      await page.goto(new URL(opts.startPath, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.fill(opts.searchInputSelector, opts.query);
      if (opts.submitSelector) {
        await page.click(opts.submitSelector);
      } else {
        await page.press(opts.searchInputSelector, "Enter");
      }
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 15000 });
      } else {
        await page.waitForLoadState("networkidle");
      }
    },
  };
}

/** A generic "open this interactive component" flow — modals, dropdowns, tabs, etc. */
export function openComponentFlow(opts: {
  name: string;
  description?: string;
  path: string;
  triggerSelector: string;
  waitForSelector?: string; // the opened component's root element
}): Flow {
  return {
    name: opts.name,
    description: opts.description ?? `Open the "${opts.name}" component on ${opts.path}.`,
    async run(page, baseUrl) {
      await page.goto(new URL(opts.path, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.click(opts.triggerSelector);
      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 10000 });
      } else {
        await page.waitForTimeout(300);
      }
    },
  };
}

export const DEFAULT_FLOWS: Flow[] = [];
