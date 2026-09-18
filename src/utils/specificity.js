import * as csstree from "css-tree";

// Approximates CSS specificity as [inline, id, class, type] per the CSS spec.
// :where() contributes 0 specificity; :not()/:is()/:has() are approximated by
// walking into their argument selectors (a reasonable, slightly-generous approximation).
export function selectorSpecificity(selectorNode) {
  const spec = { inline: 0, id: 0, class: 0, type: 0 };

  csstree.walk(selectorNode, (node) => {
    switch (node.type) {
      case "IdSelector":
        spec.id++;
        break;
      case "ClassSelector":
      case "AttributeSelector":
        spec.class++;
        break;
      case "PseudoClassSelector":
        if (node.name.toLowerCase() === "where") {
          return csstree.walk.skip;
        }
        spec.class++;
        break;
      case "PseudoElementSelector":
        spec.type++;
        break;
      case "TypeSelector":
        if (node.name !== "*") spec.type++;
        break;
      default:
        break;
    }
  });

  return spec;
}

export function specificityTuple(spec) {
  return [spec.inline, spec.id, spec.class, spec.type];
}

export function compareSpecificity(a, b) {
  const ta = specificityTuple(a);
  const tb = specificityTuple(b);
  for (let i = 0; i < 4; i++) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

export function specificityToString(spec) {
  return `(${spec.inline},${spec.id},${spec.class},${spec.type})`;
}

export function specificityScore(spec) {
  // Single sortable number (not spec-accurate across huge counts, fine for ranking).
  return spec.inline * 1e9 + spec.id * 1e6 + spec.class * 1e3 + spec.type;
}
