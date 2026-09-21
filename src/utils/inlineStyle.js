// Inline style="" attributes behave like a rule with maximal specificity that
// always wins over any stylesheet rule (barring !important elsewhere).
export function inlineStyleElementsToRules(inlineStyleElements, orderStart) {
  return inlineStyleElements.map((el, i) => ({
    id: `inline-${i}`,
    selector: el.selector || "[inline style]",
    specificityObj: { inline: 1, id: 0, class: 0, type: 0 },
    declarations: parseInlineDeclarations(el.style),
    source: "inline style attribute",
    sourceType: "inline",
    href: null,
    media: null,
    line: null,
    order: orderStart + i,
    sourceOrder: 1e9,
  }));
}

export function parseInlineDeclarations(styleText) {
  const decls = [];
  const parts = styleText.split(";");
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const property = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    if (!property || !value) continue;
    const important = /!important\s*$/i.test(value);
    if (important) value = value.replace(/!important\s*$/i, "").trim();
    decls.push({ property, value, important, line: null });
  }
  return decls;
}
