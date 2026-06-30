/**
 * Responsive-aware Tailwind class model for the Design Studio (§6.4).
 *
 * The canvas is mobile-first: the base (unprefixed) class is what renders on
 * the narrowest breakpoint; each larger breakpoint layers overrides upward,
 * matching Tailwind's min-width cascade.
 *
 * Frame widths snap to Tailwind's canonical breakpoint thresholds:
 *   < 640  → base (unprefixed)
 *   640–767 → sm:
 *   768–1023 → md:
 *   1024–1279 → lg:
 *   1280–1535 → xl:
 *   ≥ 1536  → 2xl:
 *
 * All helpers are pure (no DB, no DOM, no side-effects).
 */

import type { TailwindBreakpointPrefix } from "./design-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single Tailwind class token split into its constituent parts.
 * `prefix` is `"base"` for unprefixed tokens.
 */
export interface ParsedClassToken {
  /** Original token string as it appears in the className (e.g. "md:text-lg"). */
  raw: string;
  /** Breakpoint scope. `"base"` means the token has no responsive prefix. */
  prefix: TailwindBreakpointPrefix;
  /**
   * The utility after the prefix (e.g. "text-lg" from "md:text-lg").
   * For base tokens this equals `raw`.
   */
  utility: string;
}

/**
 * The className string parsed into per-breakpoint groups.
 * Each group preserves the order classes appeared in the source string.
 */
export type BreakpointClassGroups = {
  [P in TailwindBreakpointPrefix]: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered list of Tailwind min-width thresholds in pixels. */
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

/** Regex that matches a responsive prefix at the start of a class token. */
const PREFIX_RE = /^(2xl|xl|lg|md|sm):/;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single class token (e.g. `"md:text-lg"`) into its parts.
 * Handles arbitrary-value utilities like `"lg:w-[calc(100%-1rem)]"`.
 */
export function parseClassToken(token: string): ParsedClassToken {
  const match = PREFIX_RE.exec(token);
  if (!match) {
    return { raw: token, prefix: "base", utility: token };
  }
  const prefix = match[1] as TailwindBreakpointPrefix;
  const utility = token.slice(match[0].length);
  return { raw: token, prefix, utility };
}

/**
 * Split a `className` string into individual tokens and group them by
 * breakpoint prefix.  Whitespace is normalised; duplicates are preserved in
 * the order they appear.
 *
 * @example
 * parseClassGroups("text-sm md:text-base lg:text-lg")
 * // → { base: ["text-sm"], sm: [], md: ["text-base"], lg: ["text-lg"], xl: [], "2xl": [] }
 */
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
    const { prefix } = parseClassToken(token);
    groups[prefix].push(token);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Property extraction
// ---------------------------------------------------------------------------

/** Single-word utilities whose CSS property is fixed regardless of suffix. */
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

/**
 * Map a Tailwind utility to a stable CSS-property key so two utilities that
 * target the SAME property compare equal (and replace one another rather than
 * accumulate), while utilities for DIFFERENT properties stay distinct.
 *
 * Heuristic, not a full Tailwind AST — but it resolves the families where a
 * naive "leading segment" key collides: the single-word `display`/`position`
 * families; `text-*` (align vs size vs color vs overflow vs wrap); `font-*`
 * (weight vs family); `bg-*` (color vs image vs size vs repeat vs ...); the
 * flex/grid alignment families; and axis-split families (`min-w` ≠ `min-h`,
 * `gap-x` ≠ `gap-y`). Everything else falls back to the leading segment, which
 * is correct for `w-`, `h-`, `p-`, `m-`, `rounded-`, `border-`, etc.
 *
 * Exported so other callers (e.g. apply-visual-edit) derive the SAME key and
 * stay consistent with set/remove here.
 */
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

// ---------------------------------------------------------------------------
// Get / set per-breakpoint
// ---------------------------------------------------------------------------

/**
 * Return all tokens in `className` whose prefix equals `prefix` and whose
 * utility starts with `stem` (the CSS property stem, e.g. `"text"` to find
 * `"text-sm"`, `"md:text-base"`, etc.).
 *
 * @example
 * getPropertyClasses("text-sm md:text-base", "md", "text")
 * // → ["md:text-base"]
 */
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

/**
 * Set the class for `property` at `prefix` to `newUtility`, returning the
 * updated className string.
 *
 * - If a class with the same stem already exists at this prefix it is replaced.
 * - If no such class exists the new one is appended.
 * - Classes at all other prefixes are left untouched.
 * - `newUtility` should be the bare utility without the prefix (e.g. `"text-lg"`
 *   not `"md:text-lg"`); the prefix is added automatically.
 *
 * @example
 * setPropertyClass("text-sm md:text-base", "lg", "text-xl")
 * // → "text-sm md:text-base lg:text-xl"
 *
 * setPropertyClass("text-sm md:text-base md:font-bold", "md", "text-lg")
 * // → "text-sm md:text-lg md:font-bold"
 */
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

/**
 * Remove all tokens whose prefix equals `prefix` and whose utility stem matches
 * `stem`.  Returns the updated className string.
 *
 * @example
 * removePropertyClass("text-sm md:text-base lg:text-lg", "md", "text")
 * // → "text-sm lg:text-lg"
 */
export function removePropertyClass(
  className: string,
  prefix: TailwindBreakpointPrefix,
  stem: string,
): string {
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  return tokens
    .filter((token) => {
      const parsed = parseClassToken(token);
      return !(
        parsed.prefix === prefix && utilityStem(parsed.utility) === stem
      );
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Frame-width → prefix mapping
// ---------------------------------------------------------------------------

/**
 * Given the pixel width of a canvas frame, return the Tailwind responsive
 * prefix that should be written when editing a layer in that frame.
 *
 * - Mobile-first: a frame below `sm`'s min-width (640 px) writes `"base"`.
 * - Each larger frame writes the prefix whose min-width that frame satisfies.
 *
 * @example
 * widthToPrefix(390)   // → "base"
 * widthToPrefix(768)   // → "md"
 * widthToPrefix(1280)  // → "xl"
 * widthToPrefix(1536)  // → "2xl"
 */
export function widthToPrefix(widthPx: number): TailwindBreakpointPrefix {
  for (const { prefix, minPx } of BREAKPOINT_MIN_WIDTHS) {
    if (widthPx >= minPx) return prefix;
  }
  return "base";
}

// ---------------------------------------------------------------------------
// Override detection
// ---------------------------------------------------------------------------

/**
 * Return all breakpoint prefixes (other than `"base"`) at which the given
 * property stem has an override in `className`.  An override means a class with
 * that stem exists at a prefix larger than `"base"`.
 *
 * Useful for rendering the "overridden at these breakpoints" indicators in the
 * inspector.
 *
 * @example
 * overriddenPrefixes("text-sm md:text-base lg:text-lg", "text")
 * // → ["md", "lg"]
 */
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

/**
 * Reset a property at a breakpoint back to its base value by removing the
 * prefixed override.  Equivalent to `removePropertyClass(className, prefix, stem)`
 * but named to match the "Reset to base" UI affordance.
 */
export function resetToBase(
  className: string,
  prefix: TailwindBreakpointPrefix,
  stem: string,
): string {
  if (prefix === "base") return className;
  return removePropertyClass(className, prefix, stem);
}
