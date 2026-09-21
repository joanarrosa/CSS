import { specificityScore } from "./utils/specificity.js";

const MAX_RULES_FOR_DOM_MATCH = 6000;
export const PSEUDO_ELEMENT_RE = /::?(before|after|first-line|first-letter|placeholder|marker|selection|backdrop|-webkit-[\w-]+)\b/gi;

function stripPseudoElements(selector) {
  return selector.replace(PSEUDO_ELEMENT_RE, "").trim();
}

// Builds the plain-data descriptors matchRulesInPage needs from parsed rules
// (pseudo-element stripping, specificity scoring, per-rule declaration
// dedup). Pure and reusable outside Playwright — the browser extension calls
// this directly (it's already running in the page, no page.evaluate needed).
export function buildRuleDescriptors(rules) {
  const usable = rules.slice(0, MAX_RULES_FOR_DOM_MATCH);
  const truncated = rules.length > MAX_RULES_FOR_DOM_MATCH;

  const descriptors = usable.map((rule, idx) => {
    const hasPseudoElement = PSEUDO_ELEMENT_RE.test(rule.selector);
    PSEUDO_ELEMENT_RE.lastIndex = 0;
    const queryable = hasPseudoElement ? stripPseudoElements(rule.selector) : rule.selector;
    return {
      idx,
      selector: rule.selector,
      queryable,
      hasPseudoElement,
      media: rule.media,
      specScore: specificityScore(rule.specificityObj),
      order: rule.order,
      decls: dedupeDeclsLastWins(rule.declarations),
    };
  });

  return { descriptors, usable, truncated };
}

/**
 * Runs a single in-browser pass that, for every parsed CSS rule:
 *  - counts how many live DOM elements it matches (feeds "unused CSS")
 *  - determines, for elements matched by 2+ rules declaring the same
 *    property, which rule's declaration actually wins the cascade and
 *    aggregates the "loser" declarations (feeds "overridden declarations")
 *
 * All matching happens inside page.evaluate() so we pay for one DOM walk
 * instead of round-tripping per selector.
 */
export async function matchRulesAgainstDom(page, rules) {
  const { descriptors, usable, truncated } = buildRuleDescriptors(rules);
  const result = await page.evaluate(matchRulesInPage, descriptors);

  return {
    matchCounts: result.matchCounts,
    overrides: result.overrides,
    rules: usable,
    truncated,
  };
}

function dedupeDeclsLastWins(declarations) {
  const map = new Map();
  for (const d of declarations) map.set(d.property, d);
  return [...map.values()];
}

// The actual matching pass. Self-contained on purpose (references only its
// own parameter and browser globals) so it can run either via
// page.evaluate(matchRulesInPage, descriptors) (Playwright, which serializes
// and re-executes it) or be called directly when already running inside the
// page (the browser extension, which has no separate page/JS-context split).
export function matchRulesInPage(rulesData) {
  const matchCounts = new Array(rulesData.length).fill(null); // null = not evaluated (bad selector / inactive media)
  const mediaCache = new Map();
  function mediaActive(cond) {
    if (!cond) return true;
    if (mediaCache.has(cond)) return mediaCache.get(cond);
    let active = true;
    try {
      active = window.matchMedia(cond).matches;
    } catch {
      active = true; // unknown condition — assume active rather than hide real findings
    }
    mediaCache.set(cond, active);
    return active;
  }

  let nextIdx = 0;
  const elementRuleProps = new Map(); // elementIdx -> Map(property -> [{ruleIdx, value, important, specScore, order}])
  const elementMeta = new Map(); // elementIdx -> {tag, id, classes}

  for (const rd of rulesData) {
    if (!mediaActive(rd.media)) continue;
    if (!rd.queryable) continue;
    let matched;
    try {
      matched = document.querySelectorAll(rd.queryable);
    } catch {
      continue; // invalid/unsupported selector — leave as "not evaluated"
    }
    matchCounts[rd.idx] = matched.length;
    if (rd.hasPseudoElement) continue; // don't feed override analysis with approximate matches

    if (matched.length === 0) continue;
    for (const el of matched) {
      let eIdx = el.__cssAuditIdx;
      if (eIdx === undefined) {
        eIdx = nextIdx++;
        el.__cssAuditIdx = eIdx;
        elementMeta.set(eIdx, {
          tag: el.tagName ? el.tagName.toLowerCase() : "",
          id: el.id || "",
          classes: el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3) : [],
        });
      }
      if (!elementRuleProps.has(eIdx)) elementRuleProps.set(eIdx, new Map());
      const propMap = elementRuleProps.get(eIdx);
      for (const decl of rd.decls) {
        if (!propMap.has(decl.property)) propMap.set(decl.property, []);
        propMap.get(decl.property).push({
          ruleIdx: rd.idx,
          value: decl.value,
          important: decl.important,
          specScore: rd.specScore,
          order: rd.order,
        });
      }
    }
  }

  // Aggregate overrides: for each element+property with >1 contributing rule,
  // find the winner and record (loser -> winner) pairs with a hit count + one sample element.
  const aggKey = (loserIdx, winnerIdx, property) => `${loserIdx}|${winnerIdx}|${property}`;
  const agg = new Map();

  for (const [eIdx, propMap] of elementRuleProps) {
    for (const [property, contributions] of propMap) {
      if (contributions.length < 2) continue;
      const sorted = [...contributions].sort((a, b) => {
        if (!!a.important !== !!b.important) return a.important ? 1 : -1;
        if (a.specScore !== b.specScore) return a.specScore - b.specScore;
        return a.order - b.order;
      });
      const winner = sorted[sorted.length - 1];
      const losers = sorted.slice(0, -1).filter((l) => l.value !== winner.value || l.ruleIdx !== winner.ruleIdx);
      for (const loser of losers) {
        if (loser.ruleIdx === winner.ruleIdx) continue;
        const key = aggKey(loser.ruleIdx, winner.ruleIdx, property);
        if (!agg.has(key)) {
          agg.set(key, {
            loserRuleIdx: loser.ruleIdx,
            winnerRuleIdx: winner.ruleIdx,
            property,
            loserValue: loser.value,
            winnerValue: winner.value,
            count: 0,
            sample: null,
          });
        }
        const entry = agg.get(key);
        entry.count++;
        if (!entry.sample) entry.sample = elementMeta.get(eIdx);
      }
    }
  }

  return { matchCounts, overrides: [...agg.values()] };
}
