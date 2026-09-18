// Minimal color parsing + WCAG contrast helpers. No external deps.

// Parses rgb()/rgba()/#hex strings (the forms getComputedStyle returns) into [r,g,b,a].
export function parseColor(input) {
  if (!input) return null;
  const str = String(input).trim().toLowerCase();

  if (str === "transparent") return [0, 0, 0, 0];

  let m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }
  // space-separated modern syntax: rgb(255 0 0 / 0.5)
  m = str.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.%]+))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  m = str.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  m = str.match(/^#([0-9a-f]{6})$/);
  if (m) {
    const hex = m[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }
  m = str.match(/^#([0-9a-f]{8})$/);
  if (m) {
    const hex = m[1];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(6, 8), 16) / 255,
    ];
  }
  return null;
}

function relativeLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Flattens a translucent foreground color over an opaque background.
export function flattenAlpha(fg, bg) {
  const [r, g, b, a] = fg;
  if (a === undefined || a >= 1) return [r, g, b];
  const [br, bg2, bb] = bg;
  return [r * a + br * (1 - a), g * a + bg2 * (1 - a), b * a + bb * (1 - a)];
}

export function contrastRatio(colorA, colorB) {
  const lumA = relativeLuminance(colorA) + 0.05;
  const lumB = relativeLuminance(colorB) + 0.05;
  return lumA > lumB ? lumA / lumB : lumB / lumA;
}

// WCAG AA thresholds: 4.5:1 normal text, 3:1 large text (>=18pt or >=14pt bold).
export function isLargeText(fontSizePx, fontWeight) {
  const bold = fontWeight >= 700 || fontWeight === "bold";
  if (bold) return fontSizePx >= 18.66; // ~14pt
  return fontSizePx >= 24; // ~18pt
}

export function aaThreshold(fontSizePx, fontWeight) {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}
