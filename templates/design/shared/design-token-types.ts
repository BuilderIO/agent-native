import { isColorTokenValue } from "@agent-native/core/brand-kit";

/**
 * Every token has one `type`: what the Tokens panel `+` menu offers, what a
 * DTCG `$type` maps to, or a guess from the token's name and value. The panel
 * section a token shows in is derived from it with `tokenGroupForType` and is
 * never stored.
 */
export const DESIGN_TOKEN_TYPES = [
  "color",
  "font-family",
  "font-weight",
  "font-size",
  "line-height",
  "letter-spacing",
  "spacing",
  "container",
  "breakpoint",
  "radius",
  "shadow",
  "opacity",
  "motion",
  "other",
] as const;

export type DesignTokenType = (typeof DESIGN_TOKEN_TYPES)[number];

/** Panel sections, in display order. */
export const DESIGN_TOKEN_GROUPS = [
  "color",
  "typography",
  "spacing",
  "radius",
  "shadow",
  "other",
] as const;

export type DesignTokenGroupName = (typeof DESIGN_TOKEN_GROUPS)[number];

const TYPE_GROUP: Record<DesignTokenType, DesignTokenGroupName> = {
  color: "color",
  "font-family": "typography",
  "font-weight": "typography",
  "font-size": "typography",
  "line-height": "typography",
  "letter-spacing": "typography",
  spacing: "spacing",
  container: "spacing",
  breakpoint: "spacing",
  radius: "radius",
  shadow: "shadow",
  opacity: "shadow",
  motion: "other",
  other: "other",
};

export function tokenGroupForType(type: DesignTokenType): DesignTokenGroupName {
  return TYPE_GROUP[type];
}

export function isDesignTokenType(value: unknown): value is DesignTokenType {
  return (
    typeof value === "string" &&
    (DESIGN_TOKEN_TYPES as readonly string[]).includes(value)
  );
}

const DIMENSION_VALUE =
  /^-?\d*\.?\d+(px|rem|em|ex|ch|%|vh|vw|vmin|vmax|pt|pc|cm|mm|in|s|ms|deg|fr)?$/i;
const MOTION_VALUE =
  /^(-?\d*\.?\d+m?s|(cubic-bezier|steps|linear)\s*\(.*|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/i;

export function isMotionValue(value: string): boolean {
  return MOTION_VALUE.test(value.trim());
}

/**
 * Guesses a token's type from its CSS variable name and value, for tokens with
 * no stored type. Order matters: specific name hints (weight, leading,
 * tracking) are checked before the broad font/size hints that would swallow
 * them.
 */
export function guessTokenType(name: string, value: string): DesignTokenType {
  const n = name.toLowerCase();
  const v = value.trim();
  if (isColorTokenValue(v)) return "color";
  if (/radius|rounded/.test(n)) return "radius";
  if (/shadow|elevation|drop/.test(n)) return "shadow";
  // Not "alpha": color tokens name their alpha channel that way.
  if (/opacity/.test(n)) return "opacity";
  if (/duration|easing|ease|transition|animation|motion|delay/.test(n)) {
    return "motion";
  }
  if (/letter|tracking/.test(n)) return "letter-spacing";
  if (/line-?height|leading/.test(n)) return "line-height";
  if (/weight/.test(n)) return "font-weight";
  if (/breakpoint|screen/.test(n)) return "breakpoint";
  if (/container|max-?width/.test(n)) return "container";
  if (/size/.test(n) && /font|text|type|heading|body/.test(n)) {
    return "font-size";
  }
  // Tailwind-style scales (`--text-lg: 1.125rem`) name font sizes "text-*".
  if (/^(--)?text-/.test(n) && DIMENSION_VALUE.test(v)) return "font-size";
  if (/font|family|typeface/.test(n)) {
    return DIMENSION_VALUE.test(v) ? "font-size" : "font-family";
  }
  if (/spacing|gap|padding|margin|space|gutter/.test(n)) return "spacing";
  if (/heading|body|type|size/.test(n)) return "font-size";
  if (
    /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground|fill|stroke/.test(
      n,
    ) &&
    !DIMENSION_VALUE.test(v)
  ) {
    return "color";
  }
  return "other";
}

/**
 * Reads `designs.data.tokenTypes`. Entries with an unknown type are dropped so
 * a stale or hand-edited value falls back to `guessTokenType` instead of
 * landing a token in a section the panel cannot render.
 */
export function readTokenTypes(
  data: Record<string, unknown>,
): Record<string, DesignTokenType> {
  const raw = data.tokenTypes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const types: Record<string, DesignTokenType> = {};
  for (const [cssVar, type] of Object.entries(raw)) {
    if (isDesignTokenType(type)) types[cssVar] = type;
  }
  return types;
}

export interface DesignToken {
  name: string;
  cssVar: string;
  value: string;
  type: DesignTokenType;
  source: string;
  sources?: string[];
  sourceValues?: Record<string, string>;
  isTweakOverride?: boolean;
}

export interface DesignTokenGroup {
  group: DesignTokenGroupName;
  tokens: DesignToken[];
}

/** Groups tokens into panel sections in display order, omitting empty ones. */
export function groupDesignTokens(tokens: DesignToken[]): DesignTokenGroup[] {
  return DESIGN_TOKEN_GROUPS.map((group) => ({
    group,
    tokens: tokens.filter((token) => tokenGroupForType(token.type) === group),
  })).filter((section) => section.tokens.length > 0);
}
