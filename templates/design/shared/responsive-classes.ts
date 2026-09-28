import type { TailwindBreakpointPrefix } from "./design-state.js";

export interface ParsedClassToken {
  raw: string;
  prefix: TailwindBreakpointPrefix;
  utility: string;
}

export type BreakpointClassGroups = {
  [P in TailwindBreakpointPrefix]: string[];
};

const BREAKPOINT_MIN_WIDTHS: ReadonlyArray<{
  prefix: TailwindBreakpointPrefix;
  minPx: number;
}> = [
  { prefix: "2xl", minPx: 1536 },
  { prefix: "xl", minPx: 1280 },
  { prefix: "lg", minPx: 1024 },
  { prefix: "md", minPx: 768 },
  { prefix: "sm", minPx: 640 },
  // base has no minimum — it is the fallback below sm.
];

const ALL_PREFIXES: ReadonlyArray<TailwindBreakpointPrefix> = [
  "base",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
];

const PREFIX_RE = /^(2xl|xl|lg|md|sm):/;

const MAX_WIDTH_VARIANT_RE = /^max-\[(\d+)px\]:/;

const CORE_MAX_VARIANT_BOUNDS: Readonly<Record<string, number>> = {
  "max-sm": 639,
  "max-md": 767,
  "max-lg": 1023,
  "max-xl": 1279,
  "max-2xl": 1535,
};

const CORE_MAX_VARIANT_RE = /^max-(2xl|xl|lg|md|sm):/;

export function parseClassToken(token: string): ParsedClassToken {
  const match = PREFIX_RE.exec(token);
  if (!match) {
    return { raw: token, prefix: "base", utility: token };
  }
  const prefix = match[1] as TailwindBreakpointPrefix;
  const utility = token.slice(match[0].length);
  return { raw: token, prefix, utility };
}

export function parseClassGroups(className: string): BreakpointClassGroups {
  const groups: BreakpointClassGroups = {
    base: [],
    sm: [],
    md: [],
    lg: [],
    xl: [],
    "2xl": [],
  };

  const tokens = className.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    // Max-width-scoped tokens belong to the desktop-down cascade — they are
    // NOT base values and must not pollute the min-width groups (a
    // `max-[809px]:text-sm` token is an override below 810px, not the base
    // font size). They are handled by the `*MaxWidth*` helpers instead.
    if (parseMaxWidthClassToken(token)) continue;
    const { prefix } = parseClassToken(token);
    groups[prefix].push(token);
  }

  return groups;
}

const SINGLE_WORD_PROPERTY: Readonly<Record<string, string>> = {
  flex: "display",
  grid: "display",
  block: "display",
  inline: "display",
  "inline-block": "display",
  "inline-flex": "display",
  "inline-grid": "display",
  hidden: "display",
  contents: "display",
  "flow-root": "display",
  table: "display",
  "list-item": "display",
  static: "position",
  fixed: "position",
  absolute: "position",
  relative: "position",
  sticky: "position",
};

const TEXT_ALIGN = new Set([
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
]);
const FONT_SIZES = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const TEXT_OVERFLOW = new Set(["ellipsis", "clip"]);
const TEXT_WRAP = new Set(["wrap", "nowrap", "balance", "pretty"]);
const FONT_WEIGHTS = new Set([
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
]);
const AXIS_FAMILIES = new Set([
  "min",
  "max",
  "space",
  "gap",
  "divide",
  "scroll",
  "inset",
]);
const LENGTH_RE = /\d|rem|em|px|%|ch|vw|vh|vmin|vmax/;

export function utilityStem(utility: string): string {
  const u = utility.startsWith("-") ? utility.slice(1) : utility;
  const bracketIdx = u.indexOf("[");
  const head = bracketIdx >= 0 ? u.slice(0, bracketIdx).replace(/-$/, "") : u;
  const arbitrary = bracketIdx >= 0 ? u.slice(bracketIdx + 1) : "";

  if (head in SINGLE_WORD_PROPERTY) return SINGLE_WORD_PROPERTY[head];

  const seg = head.split("-");
  const family = seg[0];
  const rest = seg.slice(1).join("-");

  if (family === "text") {
    if (TEXT_ALIGN.has(rest)) return "text-align";
    if (FONT_SIZES.has(rest)) return "font-size";
    if (TEXT_OVERFLOW.has(rest)) return "text-overflow";
    if (TEXT_WRAP.has(rest)) return "text-wrap";
    if (bracketIdx >= 0) {
      return LENGTH_RE.test(arbitrary) ? "font-size" : "text-color";
    }
    return "text-color";
  }
  if (family === "font") {
    return FONT_WEIGHTS.has(rest) ? "font-weight" : "font-family";
  }
  if (family === "bg") {
    if (rest === "none" || rest.startsWith("gradient"))
      return "background-image";
    if (rest === "auto" || rest === "cover" || rest === "contain") {
      return "background-size";
    }
    if (
      rest === "no-repeat" ||
      rest === "repeat" ||
      rest.startsWith("repeat-")
    ) {
      return "background-repeat";
    }
    if (rest === "fixed" || rest === "local" || rest === "scroll") {
      return "background-attachment";
    }
    if (rest.startsWith("clip-")) return "background-clip";
    if (rest.startsWith("origin-")) return "background-origin";
    if (rest.startsWith("blend-")) return "background-blend-mode";
    if (
      rest === "bottom" ||
      rest === "center" ||
      rest === "top" ||
      rest.startsWith("left") ||
      rest.startsWith("right")
    ) {
      return "background-position";
    }
    return "background-color";
  }
  if (family === "justify") {
    return rest.startsWith("items")
      ? "justify-items"
      : rest.startsWith("self")
        ? "justify-self"
        : "justify-content";
  }
  if (family === "items") return "align-items";
  if (family === "self") return "align-self";
  if (family === "content") return "align-content";

  if (AXIS_FAMILIES.has(family) && seg.length >= 2) {
    return `${family}-${seg[1]}`;
  }

  return family;
}

export function getPropertyClasses(
  className: string,
  prefix: TailwindBreakpointPrefix,
  stem: string,
): string[] {
  const groups = parseClassGroups(className);
  return groups[prefix].filter((tok) => {
    const { utility } = parseClassToken(tok);
    return utilityStem(utility) === stem;
  });
}

export function setPropertyClass(
  className: string,
  prefix: TailwindBreakpointPrefix,
  newUtility: string,
): string {
  const stem = utilityStem(newUtility);
  const newToken = prefix === "base" ? newUtility : `${prefix}:${newUtility}`;

  const tokens = className.trim().split(/\s+/).filter(Boolean);
  let replaced = false;
  const next: string[] = [];

  for (const token of tokens) {
    if (parseMaxWidthClassToken(token)) {
      next.push(token);
      continue;
    }
    const parsed = parseClassToken(token);
    if (parsed.prefix === prefix && utilityStem(parsed.utility) === stem) {
      if (!replaced) {
        next.push(newToken);
        replaced = true;
      }
      // drop duplicate occurrences of the same stem at the same prefix
    } else {
      next.push(token);
    }
  }

  if (!replaced) {
    next.push(newToken);
  }

  return next.join(" ");
}

export function removePropertyClass(
  className: string,
  prefix: TailwindBreakpointPrefix,
  stem: string,
): string {
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  return tokens
    .filter((token) => {
      if (parseMaxWidthClassToken(token)) return true;
      const parsed = parseClassToken(token);
      return !(
        parsed.prefix === prefix && utilityStem(parsed.utility) === stem
      );
    })
    .join(" ");
}

export function widthToPrefix(widthPx: number): TailwindBreakpointPrefix {
  for (const { prefix, minPx } of BREAKPOINT_MIN_WIDTHS) {
    if (widthPx >= minPx) return prefix;
  }
  return "base";
}

export function overriddenPrefixes(
  className: string,
  stem: string,
): TailwindBreakpointPrefix[] {
  const groups = parseClassGroups(className);
  const result: TailwindBreakpointPrefix[] = [];
  for (const prefix of ALL_PREFIXES) {
    if (prefix === "base") continue;
    const has = groups[prefix].some((tok) => {
      const { utility } = parseClassToken(tok);
      return utilityStem(utility) === stem;
    });
    if (has) result.push(prefix);
  }
  return result;
}

export function resetToBase(
  className: string,
  prefix: TailwindBreakpointPrefix,
  stem: string,
): string {
  if (prefix === "base") return className;
  return removePropertyClass(className, prefix, stem);
}

export interface ParsedMaxWidthClassToken {
  raw: string;
  boundPx: number;
  utility: string;
}

export function parseMaxWidthClassToken(
  token: string,
): ParsedMaxWidthClassToken | null {
  const arbitrary = MAX_WIDTH_VARIANT_RE.exec(token);
  if (arbitrary) {
    const boundPx = Number.parseInt(arbitrary[1], 10);
    if (!Number.isFinite(boundPx) || boundPx <= 0) return null;
    return { raw: token, boundPx, utility: token.slice(arbitrary[0].length) };
  }
  const core = CORE_MAX_VARIANT_RE.exec(token);
  if (core) {
    const boundPx = CORE_MAX_VARIANT_BOUNDS[`max-${core[1]}`];
    if (boundPx === undefined) return null;
    return { raw: token, boundPx, utility: token.slice(core[0].length) };
  }
  return null;
}

export function maxWidthClassToken(boundPx: number, utility: string): string {
  return `max-[${Math.round(boundPx)}px]:${utility}`;
}

export function migrateMaxWidthClassBounds(
  className: string,
  boundMap: ReadonlyMap<number, number | null>,
): string | null {
  if (boundMap.size === 0) return className;

  const parts = className.split(/(\s+)/);
  const migrations: Array<{
    index: number;
    token: string;
    boundPx: number;
    targetPx: number;
    stem: string;
    utility: string;
  }> = [];

  for (const [index, token] of parts.entries()) {
    if (!token || /^\s+$/.test(token) || !token.startsWith("max-[")) {
      continue;
    }
    const parsed = parseMaxWidthClassToken(token);
    if (!parsed) continue;
    const requestedTarget = boundMap.has(parsed.boundPx)
      ? boundMap.get(parsed.boundPx)!
      : parsed.boundPx;
    if (
      requestedTarget === null ||
      !Number.isFinite(requestedTarget) ||
      requestedTarget <= 0
    ) {
      return null;
    }
    migrations.push({
      index,
      token,
      boundPx: parsed.boundPx,
      targetPx: Math.round(requestedTarget),
      stem: utilityStem(parsed.utility),
      utility: parsed.utility,
    });
  }

  const owners = new Map<
    string,
    { token: string; boundPx: number; targetPx: number }
  >();
  for (const current of migrations) {
    const key = `${current.targetPx}\u0000${current.stem}`;
    const previous = owners.get(key);
    if (
      previous &&
      previous.token !== current.token &&
      (previous.targetPx !== previous.boundPx ||
        current.targetPx !== current.boundPx)
    ) {
      return null;
    }
    owners.set(key, current);
  }

  for (const migration of migrations) {
    if (migration.targetPx !== migration.boundPx) {
      parts[migration.index] = maxWidthClassToken(
        migration.targetPx,
        migration.utility,
      );
    }
  }
  return parts.join("");
}

export function getMaxWidthPropertyClasses(
  className: string,
  boundPx: number,
  stem: string,
): string[] {
  return className
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const parsed = parseMaxWidthClassToken(token);
      return (
        parsed !== null &&
        parsed.boundPx === boundPx &&
        utilityStem(parsed.utility) === stem
      );
    });
}

export function setMaxWidthPropertyClass(
  className: string,
  boundPx: number,
  utility: string,
): string {
  const stem = utilityStem(utility);
  const newToken = maxWidthClassToken(boundPx, utility);
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  let replaced = false;
  const next: string[] = [];

  for (const token of tokens) {
    const parsed = parseMaxWidthClassToken(token);
    if (
      parsed !== null &&
      parsed.boundPx === boundPx &&
      utilityStem(parsed.utility) === stem
    ) {
      if (!replaced) {
        next.push(newToken);
        replaced = true;
      }
      // drop duplicate same-stem tokens at the same bound
    } else {
      next.push(token);
    }
  }

  if (!replaced) next.push(newToken);
  return next.join(" ");
}

export function removeMaxWidthPropertyClass(
  className: string,
  boundPx: number,
  stem: string,
): string {
  return className
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const parsed = parseMaxWidthClassToken(token);
      return !(
        parsed !== null &&
        parsed.boundPx === boundPx &&
        utilityStem(parsed.utility) === stem
      );
    })
    .join(" ");
}

export function maxWidthOverridesForStem(
  className: string,
  stem: string,
): Array<{ boundPx: number; utility: string; token: string }> {
  const overrides: Array<{ boundPx: number; utility: string; token: string }> =
    [];
  for (const token of className.trim().split(/\s+/).filter(Boolean)) {
    const parsed = parseMaxWidthClassToken(token);
    if (parsed && utilityStem(parsed.utility) === stem) {
      overrides.push({
        boundPx: parsed.boundPx,
        utility: parsed.utility,
        token,
      });
    }
  }
  return overrides.sort((a, b) => b.boundPx - a.boundPx);
}

export function breakpointUpperBoundPx(
  breakpointWidths: readonly number[],
  activeWidthPx: number,
  baseWidthPx?: number | null,
): number | null {
  const candidates = breakpointWidths.filter(
    (width) => Number.isFinite(width) && width > activeWidthPx,
  );
  if (
    baseWidthPx != null &&
    Number.isFinite(baseWidthPx) &&
    baseWidthPx > activeWidthPx
  ) {
    candidates.push(baseWidthPx);
  }
  if (candidates.length === 0) return null;
  return Math.round(Math.min(...candidates)) - 1;
}

const CSS_PROPERTY_UTILITY_STEMS: Readonly<Record<string, string[]>> = {
  color: ["text-color"],
  "background-color": ["background-color"],
  background: ["background-color", "background-image"],
  "font-size": ["font-size"],
  "font-weight": ["font-weight"],
  "font-family": ["font-family"],
  "text-align": ["text-align"],
  display: ["display"],
  position: ["position"],
  width: ["w"],
  height: ["h"],
  opacity: ["opacity"],
  "border-radius": ["rounded"],
  padding: ["p"],
  "padding-left": ["px", "pl"],
  "padding-right": ["px", "pr"],
  "padding-top": ["py", "pt"],
  "padding-bottom": ["py", "pb"],
  margin: ["m"],
  "margin-left": ["mx", "ml"],
  "margin-right": ["mx", "mr"],
  "margin-top": ["my", "mt"],
  "margin-bottom": ["my", "mb"],
  gap: ["gap"],
  "column-gap": ["gap-x"],
  "row-gap": ["gap-y"],
};

export function normalizeCssPropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export function utilityStemsForCssProperty(property: string): string[] {
  const normalized = normalizeCssPropertyName(property);
  return CSS_PROPERTY_UTILITY_STEMS[normalized] ?? [normalized];
}

export function looksLikeTailwindUtility(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/[;{}]/.test(trimmed) || /\/\*/.test(trimmed)) return false;
  if (/^(?:#|rgb\(|rgba\(|hsl\(|hsla\(|var\(|calc\()/i.test(trimmed)) {
    return false;
  }
  if (trimmed.includes(":")) return false;
  return /^[!-]?[a-z0-9][a-z0-9[\]()./%_-]*$/i.test(trimmed);
}

export function responsiveUtilityMatchesStyleProperty(
  property: string,
  value: string,
): boolean {
  if (!looksLikeTailwindUtility(value)) return false;
  const normalizedProperty = normalizeCssPropertyName(property);
  const stem = utilityStem(value.trim());
  const allowed = CSS_PROPERTY_UTILITY_STEMS[normalizedProperty];
  return allowed ? allowed.includes(stem) : stem === normalizedProperty;
}

export type BreakpointStyleWritePlan =
  | {
      mode: "base";
    }
  | {
      mode: "class";
      boundPx: number;
      utility: string;
      token: string;
    }
  | {
      mode: "media";
      maxWidthPx: number;
      property: string;
      value: string;
    };

export function planBreakpointStyleWrite(args: {
  property: string;
  value: string;
  upperBoundPx: number | null;
}): BreakpointStyleWritePlan {
  const { property, value, upperBoundPx } = args;
  if (upperBoundPx == null) return { mode: "base" };
  const trimmed = value.trim();
  if (responsiveUtilityMatchesStyleProperty(property, trimmed)) {
    return {
      mode: "class",
      boundPx: upperBoundPx,
      utility: trimmed,
      token: maxWidthClassToken(upperBoundPx, trimmed),
    };
  }
  return {
    mode: "media",
    maxWidthPx: upperBoundPx,
    property: normalizeCssPropertyName(property),
    value: trimmed,
  };
}

export function effectiveUtilityAtWidth(
  className: string,
  stem: string,
  viewportWidthPx: number,
): {
  utility: string;
  source: "max-width" | "prefix" | "base";
  boundPx?: number;
  prefix?: TailwindBreakpointPrefix;
} | null {
  const maxMatches = maxWidthOverridesForStem(className, stem).filter(
    (override) => override.boundPx >= viewportWidthPx,
  );
  if (maxMatches.length > 0) {
    const winner = maxMatches[maxMatches.length - 1];
    return {
      utility: winner.utility,
      source: "max-width",
      boundPx: winner.boundPx,
    };
  }

  const groups = parseClassGroups(className);
  const satisfied = BREAKPOINT_MIN_WIDTHS.filter(
    ({ minPx }) => viewportWidthPx >= minPx,
  );
  for (const { prefix } of satisfied) {
    const tokens = groups[prefix].filter((token) => {
      const { utility } = parseClassToken(token);
      return utilityStem(utility) === stem;
    });
    if (tokens.length > 0) {
      const { utility } = parseClassToken(tokens[tokens.length - 1]);
      return { utility, source: "prefix", prefix };
    }
  }

  const baseTokens = groups.base.filter(
    (token) => utilityStem(parseClassToken(token).utility) === stem,
  );
  if (baseTokens.length > 0) {
    return {
      utility: baseTokens[baseTokens.length - 1],
      source: "base",
    };
  }
  return null;
}
