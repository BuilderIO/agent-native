export const DESIGN_TOKEN_TYPES = [
  "color",
  "typography",
  "spacing",
  "radius",
  "shadow",
  "other",
] as const;

export type DesignTokenType = (typeof DESIGN_TOKEN_TYPES)[number];

export const DESIGN_TOKEN_KINDS = [
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
] as const;

export type DesignTokenKind = (typeof DESIGN_TOKEN_KINDS)[number];

const KIND_GROUP: Record<DesignTokenKind, DesignTokenType> = {
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
};

export function tokenTypeForKind(kind: DesignTokenKind): DesignTokenType {
  return KIND_GROUP[kind];
}

export function isDesignTokenKind(value: unknown): value is DesignTokenKind {
  return (
    typeof value === "string" &&
    (DESIGN_TOKEN_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Reads `designs.data.tokenKinds`. Entries with an unknown kind are dropped so
 * a stale or hand-edited value falls back to name-based classification instead
 * of landing a token in a group the panel cannot render.
 */
export function readTokenKinds(
  data: Record<string, unknown>,
): Record<string, DesignTokenKind> {
  const raw = data.tokenKinds;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const kinds: Record<string, DesignTokenKind> = {};
  for (const [cssVar, kind] of Object.entries(raw)) {
    if (isDesignTokenKind(kind)) kinds[cssVar] = kind;
  }
  return kinds;
}

export interface DesignToken {
  name: string;
  cssVar: string;
  value: string;
  type: DesignTokenType;
  kind?: DesignTokenKind;
  source: string;
  sources?: string[];
  sourceValues?: Record<string, string>;
  isTweakOverride?: boolean;
}

export interface DesignTokenGroup {
  type: DesignTokenType;
  tokens: DesignToken[];
}

/** Groups tokens in panel order, omitting empty groups. */
export function groupDesignTokens(tokens: DesignToken[]): DesignTokenGroup[] {
  return DESIGN_TOKEN_TYPES.map((type) => ({
    type,
    tokens: tokens.filter((token) => token.type === type),
  })).filter((group) => group.tokens.length > 0);
}
