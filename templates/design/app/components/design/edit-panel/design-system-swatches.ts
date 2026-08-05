import { parseCssColor, rgbaToHex } from "@shared/color-utils";

/** One colour token from the design's linked Brand Kit, as the kit names it. */
export interface DesignSystemColorSwatch {
  name: string;
  cssVar: string;
  value: string;
  group?: string;
  source?: string;
}

interface IndexedToken {
  name: string;
  cssVar: string;
  value: string;
  type: string;
  group?: string;
  source?: string;
  origin?: string;
}

function normalizeHex(value: string): string | null {
  const parsed = parseCssColor(value.trim());
  return parsed ? rgbaToHex(parsed).toUpperCase() : null;
}

/**
 * The linked kit's swatchable colour tokens from an `index-design-tokens`
 * result, which mixes the design's own `:root` colours into the same list.
 * Unparseable values are dropped — `color` covers unresolved `var(--x)` too,
 * and those paint an empty swatch.
 */
export function toDesignSystemColorSwatches(
  tokens: readonly IndexedToken[] | undefined,
  limit = 48,
): DesignSystemColorSwatch[] {
  if (!tokens) return [];
  const seen = new Set<string>();
  const out: DesignSystemColorSwatch[] = [];

  for (const token of tokens) {
    if (token.type !== "color") continue;
    if (token.origin !== "brand-kit") continue;
    if (!normalizeHex(token.value)) continue;
    if (seen.has(token.cssVar)) continue;
    seen.add(token.cssVar);
    out.push({
      name: token.name,
      cssVar: token.cssVar,
      value: token.value,
      ...(token.group ? { group: token.group } : {}),
      ...(token.source ? { source: token.source } : {}),
    });
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * What to call a token in the picker: its CSS variable, minus the leading `--`.
 *
 * The indexed `name` is title-cased for tokens the kit never named ("Color
 * Primary"), which reads as a different vocabulary than the kit's own
 * `cds-background-brand` sitting next to it. The variable is what the design
 * references, so it is the name worth showing.
 */
export function swatchLabel(swatch: DesignSystemColorSwatch): string {
  return swatch.cssVar.replace(/^--/, "");
}

const TOKEN_REFERENCE = /^var\(\s*(--[-_a-zA-Z0-9]+)\s*(?:,\s*([^()]+))?\)$/;

export interface TokenReference {
  cssVar: string;
  /** Literal after the comma. Absent for a bare `var(--x)`. */
  fallback: string | null;
}

export function parseTokenReference(value: string): TokenReference | null {
  const match = TOKEN_REFERENCE.exec(value.trim());
  if (!match) return null;
  return { cssVar: match[1], fallback: match[2]?.trim() || null };
}

/**
 * The declaration to persist for a picked token.
 *
 * The fallback is not optional padding: outside the editor — an export, a
 * published page, a design whose kit link was removed — nothing defines the
 * custom property, and a bare `var(--x)` renders transparent.
 */
export function tokenReferenceValue(swatch: DesignSystemColorSwatch): string {
  return `var(${swatch.cssVar}, ${swatch.value})`;
}

/**
 * Name the token a value came from, or null when that cannot be known. A
 * `var()` reference names itself; a bare colour is matched by value, and a tie
 * returns null — Carbon points four tokens at one blue.
 */
export function resolveTokenNameForColor(
  value: string,
  swatches: readonly DesignSystemColorSwatch[],
): string | null {
  const reference = parseTokenReference(value);
  if (reference) return reference.cssVar.replace(/^--/, "");

  const target = normalizeHex(value);
  if (!target) return null;

  let match: string | null = null;
  for (const swatch of swatches) {
    if (normalizeHex(swatch.value) !== target) continue;
    if (match) return null;
    match = swatchLabel(swatch);
  }
  return match;
}

/** Group swatches under their kit collection path, preserving token order. */
export function groupColorSwatches(
  swatches: readonly DesignSystemColorSwatch[],
): { label: string | null; swatches: DesignSystemColorSwatch[] }[] {
  const groups = new Map<
    string,
    { label: string | null; swatches: DesignSystemColorSwatch[] }
  >();
  for (const swatch of swatches) {
    const label = swatch.group?.trim() || null;
    const key = label ?? "";
    const existing = groups.get(key);
    if (existing) {
      existing.swatches.push(swatch);
      continue;
    }
    groups.set(key, { label, swatches: [swatch] });
  }
  return [...groups.values()];
}
