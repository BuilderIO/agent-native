import { isMixedValue, MIXED_VALUE } from "./selection-helpers";

export const FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const;

export const FONT_WEIGHT_OPTIONS = [
  { value: "100", key: "thin" },
  { value: "200", key: "extraLight" },
  { value: "300", key: "light" },
  { value: "400", key: "regular" },
  { value: "500", key: "medium" },
  { value: "600", key: "semiBold" },
  { value: "700", key: "bold" },
  { value: "800", key: "extraBold" },
  { value: "900", key: "black" },
] as const;

/**
 * True when `value` matches one of the nine standard FONT_WEIGHT_OPTIONS
 * notches. Variable-font weights (e.g. "550") or a keyword the browser
 * didn't normalize are real but "unknown" — callers should inject a
 * synthesized option for these instead of silently rendering a Select whose
 * value matches no item (blank dropdown, current weight still applied).
 */
export function isKnownFontWeight(value: string): boolean {
  return FONT_WEIGHT_OPTIONS.some((option) => option.value === value);
}

export type TextResizeMode = "auto-width" | "auto-height" | "fixed";

/**
 * Fallback dimension used when converting a text box from an auto (width or
 * height) resize mode to "fixed". When the box already has a real authored
 * size (not auto), that size is preserved verbatim. Otherwise this must use
 * the element's actual current on-screen size (`boundingSizePx`, from
 * `boundingRect`) rather than an arbitrary constant — converting auto-width
 * text that currently renders at, say, 340px wide to "fixed" must keep it at
 * ~340px, not silently snap it to a hardcoded default and visibly resize it.
 */
export function resolveFixedResizeDimension(
  authoredValue: string | undefined,
  isAuto: boolean,
  boundingSizePx: number,
): string {
  if (authoredValue && !isAuto) return authoredValue;
  const size = Number.isFinite(boundingSizePx) ? Math.round(boundingSizePx) : 0;
  return `${Math.max(1, size)}px`;
}

function cleanFontFamilyName(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function splitFontFamilyList(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [];

  const families: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if ((char === '"' || char === "'") && raw[i - 1] !== "\\") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      token += char;
      continue;
    }
    if (char === "," && !quote) {
      const cleaned = cleanFontFamilyName(token);
      if (cleaned) families.push(cleaned);
      token = "";
      continue;
    }
    token += char;
  }

  const cleaned = cleanFontFamilyName(token);
  if (cleaned) families.push(cleaned);
  return families;
}

function normalizeFontFamilyName(value: string): string {
  return cleanFontFamilyName(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeFontFamilyStack(value: string): string {
  return splitFontFamilyList(value).map(normalizeFontFamilyName).join(",");
}

export function displayFontFamilyName(value: string | undefined): string {
  const first = splitFontFamilyList(value)[0];
  if (!first) return "Sans Serif"; // i18n-ignore design generic font label

  const normalized = normalizeFontFamilyName(first);
  if (normalized === "sans-serif") {
    return "Sans Serif"; // i18n-ignore design generic font label
  }
  if (normalized === "serif") return "Serif"; // i18n-ignore design generic font label
  if (normalized === "monospace") {
    return "Monospace"; // i18n-ignore design generic font label
  }
  if (normalized === "system-ui" || normalized === "-apple-system") {
    return "System UI"; // i18n-ignore design generic font label
  }
  if (normalized === "blinkmacsystemfont") {
    return "Apple System"; // i18n-ignore design generic font label
  }
  return first;
}

export function resolveFontFamilySelectValue(
  value: string | undefined,
): string {
  const raw = value?.trim();
  if (!raw) return "sans-serif";

  const normalizedStack = normalizeFontFamilyStack(raw);
  const exactOption = FONT_FAMILY_OPTIONS.find(
    (option) => normalizeFontFamilyStack(option.value) === normalizedStack,
  );
  if (exactOption) return exactOption.value;

  const firstFamily = normalizeFontFamilyName(
    splitFontFamilyList(raw)[0] ?? "",
  );
  const firstFamilyOption = FONT_FAMILY_OPTIONS.find(
    (option) =>
      normalizeFontFamilyName(splitFontFamilyList(option.value)[0] ?? "") ===
      firstFamily,
  );
  return firstFamilyOption?.value ?? raw;
}

/**
 * Mixed-selection-safe wrapper around resolveFontFamilySelectValue.
 *
 * A multi-selection spanning different font families injects the MIXED_VALUE
 * sentinel string ("Mixed") into computedStyles.fontFamily (see
 * mixedElementFromSelection/sameOrMixed in selection-helpers.ts). Feeding
 * that sentinel straight into resolveFontFamilySelectValue happened to
 * resolve back to the literal string "Mixed" (no option's normalized stack
 * or first-family matches, so the raw fallback wins) — but only by
 * coincidence, since MIXED_VALUE itself is "Mixed". Callers must not rely on
 * that coincidence: without an explicit mixed check the caller has no signal
 * to render the value as a disabled placeholder, so "Mixed" ends up as a
 * normal, clickable SelectItem the user could select and commit as a literal
 * (nonsensical) `font-family: Mixed` style. This wrapper makes the mixed
 * state explicit so callers can branch on it the same way they already do
 * for fontWeight/fontSize/lineHeight/letterSpacing.
 */
export function resolveFontFamilyFieldValue(
  computedFontFamily: string | undefined,
): string {
  if (isMixedValue(computedFontFamily)) return MIXED_VALUE;
  return resolveFontFamilySelectValue(computedFontFamily);
}

/**
 * PERSISTENCE GOTCHA — commit text-decoration toggles through "text-decoration"
 * (the shorthand), never "text-decoration-line" (the longhand).
 *
 * The persisted-source style patcher (`applyStyleEdit`/`normalizeStyleProperty`
 * in `shared/code-layer.ts`) only writes properties on its `VisualStyleProperty`
 * allow-list. That list has "text-decoration" but does NOT have
 * "text-decoration-line" — so an `onStyleChange("textDecorationLine", ...)`
 * call would normalize to the unlisted kebab name, miss the allow-list, and
 * return "unsupported": the live iframe preview (which patches the DOM
 * directly via `element.style.setProperty`, no allow-list) would still
 * visually flip on the toggle tick, but the change would never reach the
 * saved HTML source and would revert on the next load/reparse — a
 * works-in-preview, doesn't-persist bug. The shorthand happily accepts a bare
 * line-keyword list ("underline", "underline line-through", "none") as its
 * value, which is valid CSS and *is* on the allow-list, so every helper below
 * reads/writes through "text-decoration" (property name "textDecoration" from
 * call sites) even though the bridge separately exposes the clean longhand
 * `textDecorationLine` computed value for reading current state.
 */
export type TextDecorationLineToken = "underline" | "line-through" | "overline";

const TEXT_DECORATION_LINE_TOKENS: readonly TextDecorationLineToken[] = [
  "underline",
  "line-through",
  "overline",
];

/**
 * Parses a text-decoration-line-ish CSS value ("none", "underline",
 * "underline line-through", or even the full shorthand computed string like
 * "underline solid rgb(0, 0, 0)") into the set of line tokens present. Works
 * on either the clean longhand or the composite shorthand since it just
 * looks for each known keyword as a whole word.
 */
export function parseTextDecorationLineTokens(
  value: string | undefined,
): Set<TextDecorationLineToken> {
  const tokens = new Set<TextDecorationLineToken>();
  if (!value) return tokens;
  for (const token of TEXT_DECORATION_LINE_TOKENS) {
    if (new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(value)) {
      tokens.add(token);
    }
  }
  return tokens;
}

/**
 * True when `line` is active in `value`. A mixed-selection sentinel (see
 * `isMixedValue`) always reads as inactive — same convention every other
 * mixed-aware field in this panel uses (fontFamily/fontWeight/fontSize/...):
 * an indeterminate state renders as "off", not as a guess at one element's
 * value.
 */
export function isTextDecorationLineActive(
  value: string | undefined,
  line: TextDecorationLineToken,
): boolean {
  if (isMixedValue(value)) return false;
  return parseTextDecorationLineTokens(value).has(line);
}

/**
 * Returns the "text-decoration" value to commit after toggling `line` on/off
 * against the element's current decoration-line state. A mixed selection is
 * treated as "no lines active yet" so the first click always turns the
 * toggled line ON uniformly across every selected element — matching how
 * every other Select-driven field here (fontFamily, fontWeight, ...)
 * overwrites a mixed selection with one explicit value instead of trying to
 * merge each element's own prior state.
 */
export function nextTextDecorationLineValue(
  currentValue: string | undefined,
  line: TextDecorationLineToken,
): string {
  const current = isMixedValue(currentValue)
    ? new Set<TextDecorationLineToken>()
    : parseTextDecorationLineTokens(currentValue);
  if (current.has(line)) current.delete(line);
  else current.add(line);
  return current.size === 0 ? "none" : Array.from(current).join(" ");
}

/**
 * text-transform options (Figma's "Case" control). Unlike font-family/weight,
 * "text-transform" is already on the persisted-source `VisualStyleProperty`
 * allow-list under its own name, so callers can commit it directly with
 * `onStyleChange("textTransform", value)` — no shorthand workaround needed.
 */
export const TEXT_CASE_OPTIONS = [
  { value: "none", key: "none" },
  { value: "uppercase", key: "uppercase" },
  { value: "lowercase", key: "lowercase" },
  { value: "capitalize", key: "capitalize" },
] as const;

export type TextCaseValue = (typeof TEXT_CASE_OPTIONS)[number]["value"];
