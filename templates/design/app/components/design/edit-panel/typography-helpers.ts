import {
  formatScrubValue,
  parseScrubExpression,
  resolveFontFamilySelectValue,
} from "@agent-native/toolkit/design-tweaks";

import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import { parseNumericValue } from "./style-options";

export {
  displayFontFamilyName,
  FONT_FAMILY_OPTIONS,
  resolveFontFamilySelectValue,
  sortFontFamilyOptions,
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

/**
 * Finds the unit token (one of `units`) in `raw`, validated to appear at
 * most once. Both callers below funnel into parseScrubExpression, which
 * strips every occurrence of the unit it's told to use (global regex) — so
 * a second, unstripped occurrence, a doubled suffix ("2pxpx"/"2px px") or a
 * mismatched pair ("2%%", "2em%"), would otherwise silently vanish instead
 * of failing to parse. Returns null for that malformed case.
 *
 * Matches anywhere in the input, not only at the end: a letter-spacing
 * expression like "(x+0.005em)*2" carries its one unit token
 * mid-expression, so this is deliberately looser than "exactly one
 * TRAILING token" — it only guards against a SECOND token appearing
 * anywhere, not against where the single token sits.
 */
function singleUnitToken(
  raw: string,
  units: readonly string[],
): { unit: string | undefined } | null {
  const matches = raw.match(new RegExp(units.join("|"), "gi"));
  if (matches && matches.length > 1) return null;
  return { unit: matches?.[0]?.toLowerCase() };
}

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

  const token = singleUnitToken(raw, ["px", "%"]);
  if (!token) return null;
  const explicitUnit = token.unit;
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

export type LetterSpacingUnit = "px" | "%";

export interface LetterSpacingFieldValue {
  text: string;
  value: number;
  unit: LetterSpacingUnit;
}

export interface ParsedLetterSpacingInput extends LetterSpacingFieldValue {
  cssValue: string;
}

const LETTER_SPACING_EM_PRECISION = 4;

function letterSpacingCssValue(value: number, unit: LetterSpacingUnit): string {
  return unit === "%"
    ? formatScrubValue(value / 100, {
        unit: "em",
        precision: LETTER_SPACING_EM_PRECISION,
      })
    : formatScrubValue(value, { unit: "px", precision: 2 });
}

export function resolveLetterSpacingFieldValue(
  authoredLetterSpacing: string | undefined,
  computedLetterSpacing: string | undefined,
): LetterSpacingFieldValue {
  const authored = authoredLetterSpacing?.trim() ?? "";
  const relative = authored.match(/^([+-]?(?:\d*\.)?\d+)\s*(em|%)$/i);
  if (relative) {
    const number = Number(relative[1]);
    if (Number.isFinite(number)) {
      const value = relative[2]!.toLowerCase() === "em" ? number * 100 : number;
      return {
        text: formatScrubValue(value, { unit: "%", precision: 2 }),
        value,
        unit: "%",
      };
    }
  }
  const value = computedLetterSpacing
    ? parseNumericValue(computedLetterSpacing)
    : 0;
  return {
    text: formatScrubValue(value, { unit: "px", precision: 2 }),
    value,
    unit: "px",
  };
}

export function parseLetterSpacingInput(
  input: string,
  current: Pick<LetterSpacingFieldValue, "value" | "unit">,
): ParsedLetterSpacingInput | null {
  const raw = input.trim();
  const token = singleUnitToken(raw, ["px", "em", "%"]);
  if (!token) return null;
  const explicitUnit = token.unit;
  const unit: LetterSpacingUnit =
    explicitUnit === "px" ? "px" : explicitUnit ? "%" : current.unit;
  // The `x` token has no defined base across dimensions: it's only meaningful
  const nonEmUnit = explicitUnit ?? (unit === "%" ? "%" : "px");
  const nonEmBase =
    !explicitUnit || nonEmUnit === current.unit ? current.value : Number.NaN;
  const parsed =
    explicitUnit === "em"
      ? parseScrubExpression(
          raw,
          current.unit === "%" ? current.value / 100 : Number.NaN,
          { unit: "em", precision: LETTER_SPACING_EM_PRECISION },
        )
      : parseScrubExpression(raw, nonEmBase, {
          unit: nonEmUnit,
          precision: 2,
        });
  if (!parsed) return null;
  const value =
    explicitUnit === "em"
      ? Number((parsed.value * 100).toFixed(2))
      : parsed.value;
  const text = formatScrubValue(value, { unit, precision: 2 });
  return { text, value, unit, cssValue: letterSpacingCssValue(value, unit) };
}

export function letterSpacingScrubCssValue(
  value: number,
  unit: LetterSpacingUnit,
): string {
  return letterSpacingCssValue(value, unit);
}

export function resolveFixedResizeDimension(
  authoredValue: string | undefined,
  isAuto: boolean,
  boundingSizePx: number,
): string {
  if (authoredValue && !isAuto) return authoredValue;
  const size = Number.isFinite(boundingSizePx) ? Math.round(boundingSizePx) : 0;
  return `${Math.max(1, size)}px`;
}

export function resolveFontFamilyFieldValue(
  computedFontFamily: string | undefined,
): string {
  if (isMixedValue(computedFontFamily)) return MIXED_VALUE;
  return resolveFontFamilySelectValue(computedFontFamily);
}

export type TextDecorationLineToken = "underline" | "line-through" | "overline";

const TEXT_DECORATION_LINE_TOKENS: readonly TextDecorationLineToken[] = [
  "underline",
  "line-through",
  "overline",
];

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

export function isTextDecorationLineActive(
  value: string | undefined,
  line: TextDecorationLineToken,
): boolean {
  if (isMixedValue(value)) return false;
  return parseTextDecorationLineTokens(value).has(line);
}

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

export const TEXT_CASE_OPTIONS = [
  { value: "none", key: "none" },
  { value: "uppercase", key: "uppercase" },
  { value: "lowercase", key: "lowercase" },
  { value: "capitalize", key: "capitalize" },
] as const;

export type TextCaseValue = (typeof TEXT_CASE_OPTIONS)[number]["value"];
