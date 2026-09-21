import * as csstree from "css-tree";
import { selectorSpecificity } from "./utils/specificity.js";

const CONDITIONAL_AT_RULES = new Set(["media", "supports", "document", "layer"]);
const NON_STYLE_AT_RULES = new Set(["font-face", "keyframes", "-webkit-keyframes", "page", "counter-style", "property"]);

/**
 * Parses every collected CSS source into a flat list of "rule" records, one
 * per (selector, declarations) pair — comma-separated selector lists are
 * split so each selector can be analyzed independently.
 *
 * Returns { rules, parseErrors, atRuleBlocks } where atRuleBlocks captures
 * @font-face/@keyframes/etc. bodies separately (still useful for best-practice
 * checks like vendor-prefix consistency, but excluded from selector matching).
 */
export function parseAllSources(cssSources) {
  const rules = [];
  const parseErrors = [];
  const atRuleBlocks = [];
  let globalOrder = 0;

  for (const source of cssSources) {
    let ast;
    try {
      ast = csstree.parse(source.text, {
        positions: true,
        filename: source.label,
        onParseError(error) {
          parseErrors.push({
            source: source.label,
            sourceType: source.type,
            href: source.href,
            line: error.line,
            column: error.column,
            message: error.rawMessage || error.message,
          });
        },
      });
    } catch (err) {
      parseErrors.push({
        source: source.label,
        sourceType: source.type,
        href: source.href,
        line: err.line || null,
        column: err.column || null,
        message: err.message,
      });
      continue;
    }

    const baseMediaStack = source.media && source.media !== "all" ? [source.media] : [];
    let ruleIndexInSource = 0;

    walkTopLevel(ast, {
      onRule(ruleNode, stack) {
        const line = ruleNode.loc ? ruleNode.loc.start.line : null;
        const ruleStartOffset = ruleNode.loc ? ruleNode.loc.start.offset : null;
        const ruleEndOffset = ruleNode.loc ? ruleNode.loc.end.offset : null;
        const declarations = extractDeclarations(ruleNode.block);
        const selectorTexts = splitSelectorList(ruleNode.prelude);
        const soleSelectorInBlock = selectorTexts.length === 1;

        for (const { text, node } of selectorTexts) {
          const spec = selectorSpecificity(node);
          rules.push({
            id: `${source.id}:${ruleIndexInSource}:${rules.length}`,
            selector: text,
            specificityObj: spec,
            declarations,
            source: source.label,
            sourceType: source.type,
            href: source.href,
            media: stack.length ? stack.join(" and ") : null,
            line,
            order: globalOrder,
            sourceOrder: source.order,
            soleSelectorInBlock,
            ruleStartOffset,
            ruleEndOffset,
          });
        }
        ruleIndexInSource++;
        globalOrder++;
      },
      onAtRuleBlock(atRuleNode, name) {
        const line = atRuleNode.loc ? atRuleNode.loc.start.line : null;
        atRuleBlocks.push({
          name,
          prelude: atRuleNode.prelude ? csstree.generate(atRuleNode.prelude) : "",
          declarations: extractDeclarations(atRuleNode.block),
          source: source.label,
          sourceType: source.type,
          href: source.href,
          line,
        });
      },
      mediaStack: baseMediaStack,
    });
  }

  return { rules, parseErrors, atRuleBlocks };
}

function splitSelectorList(preludeNode) {
  const out = [];
  if (!preludeNode) return out;
  for (const selectorNode of preludeNode.children) {
    if (selectorNode.type !== "Selector") continue;
    out.push({ text: csstree.generate(selectorNode).trim(), node: selectorNode });
  }
  return out;
}

function extractDeclarations(blockNode) {
  const decls = [];
  if (!blockNode) return decls;
  for (const node of blockNode.children) {
    if (node.type !== "Declaration") continue;
    decls.push({
      property: node.property,
      value: csstree.generate(node.value).trim(),
      important: !!node.important,
      line: node.loc ? node.loc.start.line : null,
      startOffset: node.loc ? node.loc.start.offset : null,
      endOffset: node.loc ? node.loc.end.offset : null,
    });
  }
  return decls;
}

// Manually walks top-level StyleSheet children so we can track @media/@supports
// nesting depth without csstree's generic walk re-entering declaration values.
function walkTopLevel(ast, { onRule, onAtRuleBlock, mediaStack }) {
  function visit(node, stack) {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (child.type === "Rule") {
        onRule(child, stack);
      } else if (child.type === "Atrule") {
        const name = (child.name || "").toLowerCase();
        if (CONDITIONAL_AT_RULES.has(name) && child.block) {
          const condition = child.prelude ? csstree.generate(child.prelude).trim() : "";
          visit(child.block, condition ? [...stack, condition] : stack);
        } else if (NON_STYLE_AT_RULES.has(name)) {
          onAtRuleBlock(child, name);
        } else if (child.block) {
          // Unknown at-rule with a block of rules (e.g. future syntax) — recurse defensively.
          visit(child.block, stack);
        }
      }
    }
  }
  visit(ast, mediaStack);
}
