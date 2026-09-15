import {
  formatScrubValue,
  parseScrubExpression,
  resolveFontFamilySelectValue,
} from "@agent-native/toolkit/design-tweaks";

import { isMixedValue, MIXED_VALUE } from "./selection-helpers";

export {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  resolveFontFamilySelectValue,
  splitFontFamilyList,
} from "@agent-native/toolkit/design-tweaks";

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

export type LineHeightUnit = "px" | "%";

export interface LineHeightFieldValue {
  text: string;
  value: number;
  unit: LineHeightUnit;
}

export interface ParsedLineHeightInput extends LineHeightFieldValue {
  cssValue: string;
}

export const TEXT_TRUNCATION_ORIGINAL_DISPLAY =
  "--agent-native-truncate-original-display";
export const TEXT_TRUNCATION_ORIGINAL_OVERFLOW =
  "--agent-native-truncate-original-overflow";

export function textTruncationLineCount(
  value: string | undefined,
): number | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

/**
 * Legacy Chromium line clamping uses a box display that replaces authored
 * display and overflow values. Keep their raw inline values as JSON strings on
 * the node so CSS-wide keywords and absent declarations survive save/reload.
 */
export function textTruncationStyleChanges(
  enabled: boolean,
  lineCount: number,
  inlineStyles: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!enabled) {
    const savedDisplay = inlineStyles?.[TEXT_TRUNCATION_ORIGINAL_DISPLAY];
    const savedOverflow = inlineStyles?.[TEXT_TRUNCATION_ORIGINAL_OVERFLOW];
    const hasSavedDisplay = savedDisplay !== undefined;
    const hasSavedOverflow = savedOverflow !== undefined;
    if (hasSavedDisplay !== hasSavedOverflow) return null;

    const changes: Record<string, string> = {
      webkitBoxOrient: "horizontal",
      webkitLineClamp: "none",
    };
    if (!hasSavedDisplay) return changes;

    const originalDisplay = decodeTextTruncationValue(savedDisplay);
    const originalOverflow = decodeTextTruncationValue(savedOverflow);
    if (originalDisplay === null || originalOverflow === null) return null;

    changes.display = originalDisplay || "revert-layer";
    changes.overflow = originalOverflow || "revert-layer";
    changes[TEXT_TRUNCATION_ORIGINAL_DISPLAY] = "initial";
    changes[TEXT_TRUNCATION_ORIGINAL_OVERFLOW] = "initial";
    return changes;
  }

  if (!Number.isSafeInteger(lineCount) || lineCount < 1) return null;

  const styles: Record<string, string> = {
    display: "-webkit-box",
    webkitBoxOrient: "vertical",
    webkitLineClamp: String(lineCount),
    overflow: "hidden",
  };
  const currentlyTruncated =
    textTruncationLineCount(inlineStyles?.webkitLineClamp) !== null;
  const savedDisplay = inlineStyles?.[TEXT_TRUNCATION_ORIGINAL_DISPLAY];
  const savedOverflow = inlineStyles?.[TEXT_TRUNCATION_ORIGINAL_OVERFLOW];
  const hasSavedDisplay = savedDisplay !== undefined;
  const hasSavedOverflow = savedOverflow !== undefined;
  if (hasSavedDisplay !== hasSavedOverflow) return null;
  if (currentlyTruncated && hasSavedDisplay) {
    if (
      decodeTextTruncationValue(savedDisplay) === null ||
      decodeTextTruncationValue(savedOverflow) === null
    ) {
      return null;
    }
  } else {
    styles[TEXT_TRUNCATION_ORIGINAL_DISPLAY] = JSON.stringify(
      inlineStyles?.display ?? "",
    );
    styles[TEXT_TRUNCATION_ORIGINAL_OVERFLOW] = JSON.stringify(
      inlineStyles?.overflow ?? "",
    );
  }
  return styles;
}

function decodeTextTruncationValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    // coercion-ok: invalid saved metadata is rejected and the UI blocks the style mutation with a localized error.
    return null;
  }
}

function lineHeightPixels(
  computedLineHeight: string | undefined,
  fontSize: string | undefined,
  resolvedNormalPx: string | undefined,
): number {
  const computed = computedLineHeight?.trim() ?? "";
  const computedPx = computed.match(/^([\d.]+)px$/i);
  if (computedPx) return Number(computedPx[1]);

  if (/^(?:normal|auto)$/i.test(computed)) {
    const measured = Number.parseFloat(resolvedNormalPx ?? "");
    if (Number.isFinite(measured) && measured > 0) return measured;
  }

  const fontPx = Number.parseFloat(fontSize ?? "");
  const font = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : 16;
  const computedRatio = Number.parseFloat(computed);
  if (Number.isFinite(computedRatio) && computedRatio > 0) {
    return font * computedRatio;
  }
  return font * 1.2;
}

/**
 * Read line-height in the same units the author chose. Computed styles turn
 * percentages and unitless ratios into px, so the authored inline snapshot is
 * the authority when present; a legacy unitless ratio is shown equivalently
 * as a percentage without changing the source until the user edits it.
 */
export function resolveLineHeightFieldValue(
  authoredLineHeight: string | undefined,
  computedLineHeight: string | undefined,
  fontSize: string | undefined,
  resolvedNormalPx?: string,
): LineHeightFieldValue {
  const authored = authoredLineHeight?.trim() ?? "";
  const raw = authored || computedLineHeight?.trim() || "normal";
  if (/^(?:normal|auto)$/i.test(raw)) {
    return {
      text: "Auto",
      value: lineHeightPixels(computedLineHeight, fontSize, resolvedNormalPx),
      unit: "px",
    };
  }

  const explicit = raw.match(/^([+-]?(?:\d*\.)?\d+)\s*(px|%)$/i);
  if (explicit) {
    const value = Number(explicit[1]);
    if (Number.isFinite(value) && value >= 0) {
      const unit = explicit[2]!.toLowerCase() as LineHeightUnit;
      return { text: formatScrubValue(value, { unit }), value, unit };
    }
  }

  const unitless = raw.match(/^([+]?(?:\d*\.)?\d+)$/);
  if (unitless) {
    const ratio = Number(unitless[1]);
    if (Number.isFinite(ratio) && ratio >= 0) {
      const value = ratio * 100;
      return {
        text: formatScrubValue(value, { unit: "%", precision: 2 }),
        value,
        unit: "%",
      };
    }
  }

  const computedPx = raw === computedLineHeight ? raw : computedLineHeight;
  return {
    text: raw,
    value: lineHeightPixels(computedPx, fontSize, resolvedNormalPx),
    unit: "px",
  };
}

/** Parse Figma-style px / percent / Auto input; bare values are pixels. */
export function parseLineHeightInput(
  input: string,
  current: Pick<LineHeightFieldValue, "value" | "unit">,
): ParsedLineHeightInput | null {
  const raw = input.trim();
  if (/^(?:auto|normal)$/i.test(raw)) {
    return {
      text: "Auto",
      value: current.value,
      unit: "px",
      cssValue: "normal",
    };
  }

  const explicitUnit = raw
    .match(/(?:px|%)\s*$/i)?.[0]
    ?.trim()
    .toLowerCase();
  const unit: LineHeightUnit = explicitUnit
    ? (explicitUnit as LineHeightUnit)
    : "px";
  const parsed = parseScrubExpression(raw, current.value, {
    unit,
    min: 0,
    precision: 2,
  });
  if (!parsed) return null;
  const value = parsed.value;
  const text = formatScrubValue(value, { unit, precision: 2 });
  return { text, value, unit, cssValue: text };
}

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
