const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const isTTY = process.stdout.isTTY;

function paint(color, text) {
  if (!isTTY) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

export const color = Object.fromEntries(
  Object.keys(COLORS)
    .filter((k) => k !== "reset")
    .map((k) => [k, (text) => paint(k, text)])
);

export function info(msg) {
  process.stderr.write(`${color.cyan("[css-audit]")} ${msg}\n`);
}

export function warn(msg) {
  process.stderr.write(`${color.yellow("[css-audit]")} ${msg}\n`);
}

export function error(msg) {
  process.stderr.write(`${color.red("[css-audit]")} ${msg}\n`);
}
