import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { warn } from "./utils/logger.js";

const DEFAULT_CONFIG_NAME = ".css-auditrc.json";

/**
 * Loads the ignore-rules config. Looks at `explicitPath` if given, otherwise
 * `.css-auditrc.json` in the current working directory. Missing file is not
 * an error (returns an empty config); a malformed file is (throws), so a
 * typo doesn't silently disable filtering.
 *
 * Config shape:
 *   { "ignore": [ { category?, type?, severity?, selector?, message?, source?, ruleId? }, ... ] }
 * A finding is ignored if ANY entry matches it; an entry matches only if
 * ALL fields present on it match.
 */
export function loadConfig(explicitPath) {
  const configPath = explicitPath || DEFAULT_CONFIG_NAME;
  const resolved = path.resolve(process.cwd(), configPath);

  if (!existsSync(resolved)) {
    if (explicitPath) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return { ignore: [] };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse config file ${resolved}: ${err.message}`);
  }

  const ignore = Array.isArray(raw.ignore) ? raw.ignore : [];
  return { ignore, path: resolved };
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesRule(finding, rule) {
  if (rule.category !== undefined && finding.category !== rule.category) return false;
  if (rule.type !== undefined && finding.type !== rule.type) return false;
  if (rule.severity !== undefined && finding.severity !== rule.severity) return false;
  if (rule.ruleId !== undefined && finding.ruleId !== rule.ruleId) return false;
  if (rule.selector !== undefined) {
    if (!finding.selector || !globToRegExp(rule.selector).test(finding.selector)) return false;
  }
  if (rule.source !== undefined) {
    if (!finding.source || !finding.source.toLowerCase().includes(rule.source.toLowerCase())) return false;
  }
  if (rule.message !== undefined) {
    const text = finding.message || finding.description || finding.help || "";
    if (!text.toLowerCase().includes(rule.message.toLowerCase())) return false;
  }
  return true;
}

/**
 * Splits findings into { kept, ignored } based on the config's ignore rules.
 * `findings` can be css-audit findings (category/selector/message) or
 * axe-core rules (id/description/help) — matchesRule handles both shapes,
 * reading `finding.ruleId ?? finding.id` for the ruleId match.
 */
export function partitionIgnored(findings, ignoreRules) {
  if (!ignoreRules || ignoreRules.length === 0) return { kept: findings, ignored: [] };

  const kept = [];
  const ignored = [];
  for (const f of findings) {
    const normalized = { ...f, ruleId: f.ruleId ?? f.id };
    const matched = ignoreRules.some((rule) => matchesRule(normalized, rule));
    (matched ? ignored : kept).push(f);
  }
  return { kept, ignored };
}

export function warnIfConfigProblem(fn) {
  try {
    return fn();
  } catch (err) {
    warn(err.message);
    return { ignore: [] };
  }
}
