/**
 * Responsive-aware Tailwind class model for the Design Studio (§6.4).
 *
 * Two cascades coexist in one className:
 *
 * 1. **Mobile-first min-width prefixes** (`sm:`/`md:`/`lg:`/`xl:`/`2xl:`) —
 *    Tailwind's canonical cascade. The base (unprefixed) class renders on the
 *    narrowest viewport; each larger breakpoint layers overrides upward.
 *    Frame widths snap to Tailwind's canonical thresholds:
 *      < 640  → base (unprefixed)
 *      640–767 → sm:
 *      768–1023 → md:
 *      1024–1279 → lg:
 *      1280–1535 → xl:
 *      ≥ 1536  → 2xl:
 *
 * 2. **Framer-style desktop-down max-width scopes** (`max-[809px]:` arbitrary
 *    variants) — the breakpoint-bar editing model. The PRIMARY frame is the
 *    base: unprefixed classes cascade down to every narrower breakpoint
 *    unless a narrower frame writes a `max-[<bound>px]:` override, which
 *    applies at that width range and below. The bound is derived from the
 *    next-wider frame in the design's breakpoint set (Framer semantics) — see
 *    `breakpointUpperBoundPx`.
 *
 * Max-width-scoped tokens are OPAQUE to the legacy prefix helpers
 * (`parseClassGroups` / `setPropertyClass` / …) so the two cascades never
 * clobber each other; use the `*MaxWidth*` helpers for the scoped layer.
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

/**
 * Regex that matches a Framer-style max-width arbitrary variant at the start
 * of a class token (e.g. `"max-[809px]:text-sm"`).
 */
const MAX_WIDTH_VARIANT_RE = /^max-\[(\d+)px\]:/;

/**
 * Tailwind's core max-* variants and the inclusive pixel bound each applies
 * below (max-md: compiles to `@media not all and (min-width: 768px)`, i.e.
 * effective at widths ≤ 767).
 */
const CORE_MAX_VARIANT_BOUNDS: Readonly<Record<string, number>> = {
  "max-sm": 639,
  "max-md": 767,
  "max-lg": 1023,
  "max-xl": 1279,
  "max-2xl": 1535,
};

const CORE_MAX_VARIANT_RE = /^max-(2xl|xl|lg|md|sm):/;

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
    // Max-width-scoped tokens are opaque to the min-width prefix cascade.
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
      // Max-width-scoped tokens are opaque to the min-width prefix cascade.
      if (parseMaxWidthClassToken(token)) return true;
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

// ---------------------------------------------------------------------------
// Framer-style desktop-down max-width scopes (§6.4 breakpoint bar)
// ---------------------------------------------------------------------------

/** A parsed max-width-scoped class token (e.g. `"max-[809px]:text-sm"`). */
export interface ParsedMaxWidthClassToken {
  /** Original token string. */
  raw: string;
  /** Inclusive upper viewport-width bound in pixels the utility applies at. */
  boundPx: number;
  /** The utility after the variant (e.g. `"text-sm"`). */
  utility: string;
}

/**
 * Parse a max-width-scoped token. Accepts arbitrary `max-[NNNpx]:` variants
 * (the form this module writes) and Tailwind's core `max-sm:`…`max-2xl:`
 * variants (mapped to their canonical bounds) so hand-authored documents are
 * still recognised. Returns `null` for every other token, including plain
 * `max-w-*` sizing utilities.
 */
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

/**
 * Build a max-width-scoped class token: `maxWidthClassToken(809, "text-sm")`
 * → `"max-[809px]:text-sm"`. Tailwind's arbitrary-variant JIT compiles this
 * to `@media (max-width: 809px) { … }`.
 */
export function maxWidthClassToken(boundPx: number, utility: string): string {
  return `max-[${Math.round(boundPx)}px]:${utility}`;
}

/**
 * Return all max-width-scoped tokens for `stem` at exactly `boundPx`.
 */
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

/**
 * Set the utility for its property stem at the `boundPx` max-width scope,
 * replacing any existing same-stem token at the SAME bound and leaving every
 * other token (base, min-width prefixed, other bounds) untouched.
 */
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

/**
 * Remove all max-width-scoped tokens for `stem` at exactly `boundPx`,
 * falling back to the base value (desktop-down cascade).
 */
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

/**
 * All max-width-scoped overrides for `stem` in `className`, sorted widest
 * bound first (the CSS emission / cascade order).
 */
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

/**
 * Framer-style scope bound for editing at `activeWidthPx`.
 *
 * A breakpoint's overrides apply from just below the NEXT-WIDER frame down
 * to zero (narrower breakpoints layer their own overrides on top). The bound
 * is therefore `min(width of every wider frame, base width) - 1`.
 *
 * Returns `null` when there is no wider frame — the active frame IS the
 * widest context, so edits belong to the base (unscoped) layer.
 *
 * @example
 * // breakpoints 390 / 810, primary frame 1280
 * breakpointUpperBoundPx([390, 810], 810, 1280) // → 1279
 * breakpointUpperBoundPx([390, 810], 390, 1280) // → 809
 * breakpointUpperBoundPx([390, 810], 1280, 1280) // → null (base)
 */
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

// ---------------------------------------------------------------------------
// Class-vs-media write decision (single write path)
// ---------------------------------------------------------------------------

/**
 * CSS property → the Tailwind utility stems that may express it. Shared by
 * the inspector and the apply-visual-edit action so both derive the SAME
 * class-vs-media decision for a given (property, value) pair.
 */
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

/** Convert a camelCase CSS property name to kebab-case. */
export function normalizeCssPropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/** Utility stems that may express the given CSS property (kebab or camel). */
export function utilityStemsForCssProperty(property: string): string[] {
  const normalized = normalizeCssPropertyName(property);
  return CSS_PROPERTY_UTILITY_STEMS[normalized] ?? [normalized];
}

/**
 * Heuristic: does `value` look like a single Tailwind utility token rather
 * than a raw CSS value? Rejects whitespace, declarations, and obvious CSS
 * function/color syntax.
 */
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

/**
 * True when `value` is a Tailwind utility whose stem actually expresses the
 * given CSS property — the gate for writing a breakpoint override as a
 * responsive class instead of a managed `@media` rule.
 */
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

/** How a single (property, value) edit should be persisted for a scope. */
export type BreakpointStyleWritePlan =
  | {
      /** No wider frame exists — write to the base (unscoped) layer. */
      mode: "base";
    }
  | {
      /** The value is a Tailwind utility — write a max-width-scoped class. */
      mode: "class";
      boundPx: number;
      utility: string;
      token: string;
    }
  | {
      /**
       * The value can't be a utility class (raw CSS value, e.g. an exact px
       * position from a canvas drag) — write a rule into the managed
       * `<style data-agent-native-breakpoints>` block.
       */
      mode: "media";
      maxWidthPx: number;
      property: string;
      value: string;
    };

/**
 * THE single write-path decision for breakpoint-scoped style edits: given a
 * CSS property, its new value, and the active scope's upper bound (from
 * `breakpointUpperBoundPx`), decide whether the edit is a base write, a
 * responsive utility class, or a managed `@media` rule.
 */
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

// ---------------------------------------------------------------------------
// Cascade resolution (inspector / indicator support)
// ---------------------------------------------------------------------------

/**
 * Resolve which utility for `stem` is effective at `viewportWidthPx`,
 * following both cascades the way the rendered CSS does:
 *
 * 1. Among max-width scopes whose bound ≥ width, the NARROWEST bound wins
 *    (managed emission order puts narrower ranges later in the sheet).
 * 2. Otherwise the largest satisfied min-width prefix wins (Tailwind
 *    mobile-first).
 * 3. Otherwise the base token.
 *
 * Heuristic for indicators and agent inspection — the browser's real cascade
 * also involves stylesheet order for hand-authored documents.
 */
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
    // Narrowest applicable bound wins.
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
