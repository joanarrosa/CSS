const MAX_MERGE_GROUPS = 500;

/**
 * Computes safe, mechanical fixes for a small subset of findings that can be
 * applied without any risk of changing what the page looks like:
 *
 *  1. Dead declarations from "overrides" — a declaration that a live DOM
 *     pass already proved never wins the cascade on any matched element is
 *     safe to delete outright.
 *  2. Non-conflicting duplicate selector blocks from "duplicates" — when the
 *     same single-selector rule is defined more than once in the same
 *     source with no property set to two different values across the
 *     occurrences, merging them into one rule (at the position of the last
 *     occurrence, so cascade order is unchanged) is a no-op for rendering.
 *
 * Deliberately NOT auto-fixed: "unused" selectors (may be used via JS
 * toggles, :hover/:focus, other pages/viewports we didn't check — see
 * README "Limitations"), conflicting duplicates (merging would silently
 * pick a winner), anything in an inline style="" attribute (lives in the
 * HTML, not a CSS source file we can rewrite), and any rule/declaration we
 * don't have exact source offsets for.
 *
 * Operates purely on in-memory source text and returns the fixed text per
 * source — it never touches the site's real files (css-audit only ever has
 * the CSS it fetched over the network, not a checkout of the project).
 */
export function computeAutoFixes({ rules, domResult, cssSources }) {
  const sourceText = new Map(cssSources.map((s) => [s.label, s.text]));
  const opsBySource = new Map();
  const applied = [];
  const skipped = [];

  function addOp(source, op) {
    if (!opsBySource.has(source)) opsBySource.set(source, []);
    opsBySource.get(source).push(op);
  }

  applyDeadDeclarationFixes({ domResult, sourceText, addOp, applied, skipped });
  applyDuplicateMergeFixes({ rules, sourceText, addOp, applied, skipped });

  const fixedSources = [];
  for (const [source, ops] of opsBySource) {
    const original = sourceText.get(source);
    const fixed = applyOps(original, ops);
    if (fixed !== original) fixedSources.push({ source, original, fixed });
  }

  return { fixedSources, applied, skipped };
}

function applyDeadDeclarationFixes({ domResult, sourceText, addOp, applied, skipped }) {
  const seen = new Set();
  const deadByRule = new Map(); // "source|ruleStartOffset" -> { rule, decls: [], descriptions: [] }

  for (const entry of domResult.overrides || []) {
    const loser = domResult.rules[entry.loserRuleIdx];
    const winner = domResult.rules[entry.winnerRuleIdx];
    if (!loser || !winner) continue;
    if (loser.selector === winner.selector && loser.source === winner.source) continue;

    if (loser.sourceType === "inline") {
      skipped.push({
        description: `"${entry.property}" in "${loser.selector}" (inline style attribute)`,
        reason: `inline style="" attributes live in the HTML, not a CSS source file — remove it by hand.`,
      });
      continue;
    }

    // A comma-separated selector list (".a, .b { ... }") shares one declarations
    // array across all its selectors — a declaration proven dead for ".a" isn't
    // necessarily dead for ".b" too, so it's not safe to delete automatically.
    if (!loser.soleSelectorInBlock) {
      skipped.push({
        description: `"${entry.property}" in "${loser.selector}" (${loser.source}${loser.line ? `:${loser.line}` : ""})`,
        reason: `this rule shares its declarations with other comma-separated selectors — the declaration may still apply to them; resolve by hand.`,
      });
      continue;
    }

    const decl = [...loser.declarations].reverse().find((d) => d.property === entry.property);
    if (!decl || decl.startOffset == null || decl.endOffset == null) continue;
    if (!sourceText.has(loser.source)) continue;

    const dedupeKey = `${loser.source}|${decl.startOffset}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const ruleKey = `${loser.source}|${loser.ruleStartOffset}`;
    if (!deadByRule.has(ruleKey)) deadByRule.set(ruleKey, { rule: loser, decls: [], descriptions: [] });
    const bucket = deadByRule.get(ruleKey);
    bucket.decls.push(decl);
    bucket.descriptions.push(
      `Removed dead "${entry.property}: ${entry.loserValue}" from "${loser.selector}" (${loser.source}${
        loser.line ? `:${loser.line}` : ""
      }) — always overridden by "${winner.selector}".`
    );
  }

  for (const { rule, decls, descriptions } of deadByRule.values()) {
    const allDeclsDead =
      rule.declarations.length > 0 &&
      decls.length === rule.declarations.length &&
      rule.declarations.every((d) => decls.some((dd) => dd.startOffset === d.startOffset));

    if (allDeclsDead && rule.ruleStartOffset != null && rule.ruleEndOffset != null) {
      addOp(rule.source, { kind: "delete-rule", startOffset: rule.ruleStartOffset, endOffset: rule.ruleEndOffset });
      applied.push({
        description: `Removed now-empty rule "${rule.selector}" (${rule.source}${
          rule.line ? `:${rule.line}` : ""
        }) after every declaration in it was proven dead.`,
        source: rule.source,
        line: rule.line,
      });
      continue;
    }

    for (const decl of decls) {
      addOp(rule.source, { kind: "delete-decl", startOffset: decl.startOffset, endOffset: decl.endOffset });
    }
    for (const description of descriptions) {
      applied.push({ description, source: rule.source, line: rule.line });
    }
  }
}

function applyDuplicateMergeFixes({ rules, sourceText, addOp, applied, skipped }) {
  const bySelector = new Map();
  for (const rule of rules) {
    if (rule.sourceType === "inline") continue;
    if (!rule.soleSelectorInBlock) continue;
    if (rule.ruleStartOffset == null || rule.ruleEndOffset == null) continue;
    const key = `${rule.source}::${rule.media || ""}::${rule.selector}`;
    if (!bySelector.has(key)) bySelector.set(key, []);
    bySelector.get(key).push(rule);
  }

  let mergeGroups = 0;
  for (const [, occurrences] of bySelector) {
    if (occurrences.length < 2) continue;
    if (mergeGroups >= MAX_MERGE_GROUPS) break;
    if (!sourceText.has(occurrences[0].source)) continue;

    const propValues = new Map();
    for (const occ of occurrences) {
      for (const d of occ.declarations) {
        if (!propValues.has(d.property)) propValues.set(d.property, new Set());
        propValues.get(d.property).add(d.value);
      }
    }
    const conflicting = [...propValues.values()].some((v) => v.size > 1);
    if (conflicting) {
      skipped.push({
        description: `"${occurrences[0].selector}" defined ${occurrences.length}x in ${occurrences[0].source} with conflicting values`,
        reason: `values differ between occurrences — merging could silently change which one wins; resolve by hand.`,
      });
      continue;
    }

    const source = occurrences[0].source;
    const kept = occurrences[occurrences.length - 1];
    const others = occurrences.slice(0, -1);

    const existing = new Set(kept.declarations.map((d) => declKey(d)));
    const toInsert = [];
    for (const occ of others) {
      for (const d of occ.declarations) {
        const key = declKey(d);
        if (existing.has(key)) continue;
        existing.add(key);
        toInsert.push(d);
      }
    }

    for (const occ of others) {
      addOp(source, { kind: "delete-rule", startOffset: occ.ruleStartOffset, endOffset: occ.ruleEndOffset });
    }
    if (toInsert.length) {
      const text = sourceText.get(source);
      const indent = guessIndent(text, kept);
      const braceOffset = findClosingBraceOffset(text, kept.ruleEndOffset);
      // Insert right after the last non-whitespace char before "}", trimming any
      // trailing spaces on the way, so a single-line rule gets a clean new line
      // for the merged-in declarations instead of everything jammed together.
      let insertAt = braceOffset;
      while (insertAt > 0 && (text[insertAt - 1] === " " || text[insertAt - 1] === "\t")) insertAt--;
      const needsLeadingNewline = text[insertAt - 1] !== "\n";
      const insertText =
        (needsLeadingNewline ? "\n" : "") +
        toInsert.map((d) => `${indent}${d.property}: ${d.value}${d.important ? " !important" : ""};\n`).join("");
      addOp(source, { kind: "insert-at", offset: insertAt, text: insertText });
    }

    applied.push({
      description: `Merged ${occurrences.length} duplicate "${occurrences[0].selector}" rules in ${source} into one.`,
      source,
      line: kept.line,
    });
    mergeGroups++;
  }
}

function declKey(d) {
  return `${d.property}:${d.value}:${!!d.important}`;
}

function guessIndent(text, rule) {
  const firstDecl = rule.declarations[0];
  if (!firstDecl || firstDecl.startOffset == null) return "  ";
  let lineStart = firstDecl.startOffset;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
  const indent = text.slice(lineStart, firstDecl.startOffset);
  return /^[ \t]*$/.test(indent) && indent.length ? indent : "  ";
}

function findClosingBraceOffset(text, ruleEndOffset) {
  let i = ruleEndOffset - 1;
  while (i > 0 && text[i] !== "}") i--;
  return i;
}

// Widens a [start, end) deletion range to also swallow the declaration's
// trailing ";" and any trailing same-line whitespace + one newline, and any
// leading indentation on its own line — so removing something one-per-line
// doesn't leave a blank/half-empty line behind. Degrades gracefully (no-op
// widening) on minified/single-line CSS.
function widenDeleteRange(text, start, end, isWholeRule) {
  let e = end;
  while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
  if (!isWholeRule && text[e] === ";") e++;
  while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
  if (text[e] === "\r" && text[e + 1] === "\n") e += 2;
  else if (text[e] === "\n") e++;

  let s = start;
  let lineStart = s;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
  const between = text.slice(lineStart, s);
  if (/^[ \t]*$/.test(between)) s = lineStart;

  return [s, e];
}

function applyOps(text, ops) {
  const spans = [];
  for (const op of ops) {
    if (op.kind === "delete-decl") {
      const [s, e] = widenDeleteRange(text, op.startOffset, op.endOffset, false);
      spans.push({ start: s, end: e, text: "" });
    } else if (op.kind === "delete-rule") {
      const [s, e] = widenDeleteRange(text, op.startOffset, op.endOffset, true);
      spans.push({ start: s, end: e, text: "" });
    } else if (op.kind === "insert-at") {
      spans.push({ start: op.offset, end: op.offset, text: op.text });
    }
  }
  spans.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const sp of spans) {
    out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
  }
  return out;
}
