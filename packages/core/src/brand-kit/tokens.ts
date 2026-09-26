
import type { BrandKitToken, BrandKitTokenType } from "./types.js";

const BRAND_KIT_TOKEN_TYPES: readonly BrandKitTokenType[] = [
  "color",
  "typography",
  "spacing",
  "radius",
  "shadow",
  "other",
];

export const MAX_BRAND_KIT_TOKENS = 500;

const CSS_CUSTOM_PROPERTY_NAME = /^--[-_a-zA-Z0-9]+$/;

const COLOR_FUNCTION_OR_HEX =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/i;

const NAMED_CSS_COLORS = new Set([
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "cyan",
  "magenta",
  "teal",
  "navy",
  "maroon",
  "coral",
  "salmon",
  "gold",
  "silver",
  "gray",
  "grey",
  "indigo",
  "violet",
  "lime",
  "olive",
  "aqua",
  "fuchsia",
  "crimson",
  "turquoise",
  "ivory",
  "beige",
  "lavender",
  "tan",
  "khaki",
  "plum",
  "orchid",
  "sienna",
]);

export function isSafeCssVarName(value: string): boolean {
  return CSS_CUSTOM_PROPERTY_NAME.test(value);
}

export function isSafeCssTokenValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !/[;{}<>]/.test(value) &&
    !/\/\*/.test(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function isColorTokenValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    COLOR_FUNCTION_OR_HEX.test(normalized) || NAMED_CSS_COLORS.has(normalized)
  );
}

const COLOR_NAME_HINT =
  /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground|fill|stroke/i;

const DIMENSION_VALUE =
  /^-?\d*\.?\d+(px|rem|em|ex|ch|%|vh|vw|vmin|vmax|pt|pc|cm|mm|in|s|ms|deg|fr)?$/i;

/**
 * Bucket a token, trusting the value's shape over the name's keywords.
 *
 * Name-first classification called Primer's `--text-body-size-medium: 1rem` a
 * color because the name contains "text", which then rendered a swatch with
 * `background: 1rem`. A dimension is never a color however the token is named.
 */
export function classifyBrandKitToken(
  name: string,
  value: string,
): BrandKitTokenType {
  const n = name.toLowerCase();
  if (isColorTokenValue(value)) return "color";
  if (/radius|rounded/i.test(n)) return "radius";
  if (
    /font|size|leading|line-?height|letter|tracking|weight|heading|body|type/i.test(
      n,
    )
  ) {
    return "typography";
  }
  if (/spacing|gap|padding|margin|space/i.test(n)) return "spacing";
  if (/shadow|blur|drop/i.test(n)) return "shadow";
  if (COLOR_NAME_HINT.test(n) && !DIMENSION_VALUE.test(value.trim())) {
    return "color";
  }
  return "other";
}

export function friendlyTokenName(cssVar: string): string {
  return cssVar
    .replace(/^--/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type BrandKitTokenRejectionReason =
  | "malformed"
  | "unsafe-css-var"
  | "unsafe-value"
  | "over-limit";

export interface BrandKitTokenRejection {
  reason: BrandKitTokenRejectionReason;
  label: string;
}

export interface NormalizedBrandKitTokens {
  tokens: BrandKitToken[];
  /**
   * Entries that could not be stored. Callers must surface these - a kit that
   * silently kept 4 of 40 tokens reads downstream as a 4-token design system.
   */
  rejected: BrandKitTokenRejection[];
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBrandKitTokens(
  input: unknown,
): NormalizedBrandKitTokens {
  if (input === undefined || input === null) {
    return { tokens: [], rejected: [] };
  }
  if (!Array.isArray(input)) {
    return { tokens: [], rejected: [{ reason: "malformed", label: "tokens" }] };
  }

  const byCssVar = new Map<string, BrandKitToken>();
  const rejected: BrandKitTokenRejection[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      rejected.push({ reason: "malformed", label: String(entry) });
      continue;
    }
    const record = entry as Record<string, unknown>;
    const cssVar = readString(record, "cssVar");
    const value = readString(record, "value");
    const name = readString(record, "name") || friendlyTokenName(cssVar);

    if (!cssVar || !isSafeCssVarName(cssVar)) {
      rejected.push({ reason: "unsafe-css-var", label: cssVar || name });
      continue;
    }
    if (!isSafeCssTokenValue(value)) {
      rejected.push({ reason: "unsafe-value", label: cssVar });
      continue;
    }

    const declaredType = readString(record, "type") as BrandKitTokenType;
    const group = readString(record, "group");
    const source = readString(record, "source");

    byCssVar.set(cssVar, {
      name,
      cssVar,
      value,
      type: BRAND_KIT_TOKEN_TYPES.includes(declaredType)
        ? declaredType
        : classifyBrandKitToken(cssVar, value),
      ...(group ? { group } : {}),
      ...(source ? { source } : {}),
    });
  }

  const tokens = [...byCssVar.values()];
  if (tokens.length > MAX_BRAND_KIT_TOKENS) {
    for (const token of tokens.slice(MAX_BRAND_KIT_TOKENS)) {
      rejected.push({ reason: "over-limit", label: token.cssVar });
    }
  }

  return { tokens: tokens.slice(0, MAX_BRAND_KIT_TOKENS), rejected };
}

export function describeBrandKitTokenRejections(
  rejected: readonly BrandKitTokenRejection[],
): string {
  return rejected
    .slice(0, 10)
    .map((entry) => `${entry.label} (${entry.reason})`)
    .join(", ");
}

const BRAND_KIT_COLOR_ROLE_VARS: Record<string, string> = {
  primary: "--color-primary",
  secondary: "--color-secondary",
  accent: "--color-accent",
  background: "--color-background",
  surface: "--color-surface",
  text: "--color-text",
  textMuted: "--color-text-muted",
};

export function brandKitRoleTokens(
  data:
    | {
        colors?: object | null;
        borders?: { radius?: string } | null;
        spacing?: object | null;
      }
    | null
    | undefined,
  source = "Brand Kit",
): BrandKitToken[] {
  if (!data) return [];
  const out: BrandKitToken[] = [];

  const push = (cssVar: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!isSafeCssVarName(cssVar) || !isSafeCssTokenValue(value.trim())) return;
    out.push({
      name: friendlyTokenName(cssVar),
      cssVar,
      value: value.trim(),
      type: classifyBrandKitToken(cssVar, value.trim()),
      source,
    });
  };

  const colors = (data.colors ?? {}) as Record<string, unknown>;
  const spacing = (data.spacing ?? {}) as Record<string, unknown>;
  for (const [role, cssVar] of Object.entries(BRAND_KIT_COLOR_ROLE_VARS)) {
    push(cssVar, colors[role]);
  }
  push("--radius", data.borders?.radius);
  push("--spacing-element-gap", spacing.elementGap);
  push("--spacing-page-padding", spacing.pagePadding);

  return out;
}

const CSS_CUSTOM_PROPERTY_DECLARATION =
  /(--[-_a-zA-Z0-9]+)\s*:\s*([^;{}]+)[;}]/g;

export function parseBrandKitTokensFromCss(
  css: string,
  source?: string,
): BrandKitToken[] {
  const byCssVar = new Map<string, BrandKitToken>();

  for (const match of css.matchAll(CSS_CUSTOM_PROPERTY_DECLARATION)) {
    const cssVar = match[1];
    const value = match[2].trim();
    if (!isSafeCssVarName(cssVar) || !isSafeCssTokenValue(value)) continue;
    byCssVar.set(cssVar, {
      name: cssVar.replace(/^--/, ""),
      cssVar,
      value,
      type: classifyBrandKitToken(cssVar, value),
      ...(source ? { source } : {}),
    });
  }

  return [...byCssVar.values()].slice(0, MAX_BRAND_KIT_TOKENS);
}

export function resolveBrandKitTokens(
  data: { tokens?: unknown; customCSS?: unknown } | null | undefined,
  cssSource?: string,
): BrandKitToken[] {
  if (!data) return [];
  const stored = normalizeBrandKitTokens(data.tokens).tokens;
  if (stored.length > 0) return stored;
  return typeof data.customCSS === "string"
    ? parseBrandKitTokensFromCss(data.customCSS, cssSource)
    : [];
}

export interface BrandKitTokenGroup {
  label: string;
  type: BrandKitTokenType;
  tokens: BrandKitToken[];
}

export function groupBrandKitTokens(
  tokens: readonly BrandKitToken[],
): BrandKitTokenGroup[] {
  const groups = new Map<string, BrandKitTokenGroup>();

  for (const token of tokens) {
    const label = token.group?.trim() || token.type;
    const key = `${token.type}::${label}`;
    const existing = groups.get(key);
    if (existing) {
      existing.tokens.push(token);
      continue;
    }
    groups.set(key, { label, type: token.type, tokens: [token] });
  }

  return [...groups.values()].sort((a, b) => {
    const byType =
      BRAND_KIT_TOKEN_TYPES.indexOf(a.type) -
      BRAND_KIT_TOKEN_TYPES.indexOf(b.type);
    return byType !== 0 ? byType : a.label.localeCompare(b.label);
  });
}
