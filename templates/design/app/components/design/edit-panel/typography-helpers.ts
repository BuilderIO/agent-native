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
