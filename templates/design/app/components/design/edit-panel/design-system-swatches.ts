import { parseCssColorExtended, rgbaToHex } from "@shared/color-utils";

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

/** Extended: the classifier stores `oklch()`/`color()` tokens as colours. */
function normalizeHex(value: string): string | null {
  const parsed = parseCssColorExtended(value.trim());
  return parsed ? rgbaToHex(parsed).toUpperCase() : null;
}

/** Guards a cyclic alias chain (`--a: var(--b); --b: var(--a)`). */
const MAX_ALIAS_DEPTH = 8;

/**
 * A token's value as a paintable literal, following aliases through the kit's
 * own vocabulary. A kit legitimately defines one token as another, and dropping
 * those loses a selectable token; painting them raw gives an empty swatch.
 */
function paintableTokenValue(
  value: string,
  byCssVar: ReadonlyMap<string, string>,
  depth = 0,
): string | null {
  if (normalizeHex(value)) return value;
  if (depth >= MAX_ALIAS_DEPTH) return null;
  const reference = parseTokenReference(value);
  if (!reference) return null;

  const aliased = byCssVar.get(reference.cssVar);
  if (aliased !== undefined) {
    const resolved = paintableTokenValue(aliased, byCssVar, depth + 1);
    if (resolved) return resolved;
  }
  return reference.fallback
    ? paintableTokenValue(reference.fallback, byCssVar, depth + 1)
    : null;
}

/**
 * The linked kit's swatchable colour tokens from an `index-design-tokens`
 * result, which mixes the design's own `:root` colours into the same list.
 * Values that resolve to no colour at all are dropped, since they would paint
 * an empty swatch.
 */
export function toDesignSystemColorSwatches(
  tokens: readonly IndexedToken[] | undefined,
  limit = 48,
): DesignSystemColorSwatch[] {
  if (!tokens) return [];
  // Every token, not just kit ones: a kit alias may point at a design `:root`
  // variable, and that still resolves to a real colour.
  const byCssVar = new Map(tokens.map((token) => [token.cssVar, token.value]));
  const seen = new Set<string>();
  const out: DesignSystemColorSwatch[] = [];

  for (const token of tokens) {
    if (token.type !== "color") continue;
    if (token.origin !== "brand-kit") continue;
    const value = paintableTokenValue(token.value, byCssVar);
    if (!value) continue;
    if (seen.has(token.cssVar)) continue;
    seen.add(token.cssVar);
    out.push({
      name: token.name,
      cssVar: token.cssVar,
      value,
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

const TOKEN_REFERENCE_HEAD = /^var\(\s*(--[-_a-zA-Z0-9]+)\s*(,?)/;

export interface TokenReference {
  cssVar: string;
  /** Literal after the comma. Absent for a bare `var(--x)`. */
  fallback: string | null;
}

/**
 * A fallback is itself a CSS value, so it can nest parentheses. Scanning to the
 * balanced close rather than matching `[^()]+` is what keeps a function-valued
 * token from reading as "not a token" and being dropped by the commit guard.
 */
export function parseTokenReference(value: string): TokenReference | null {
  const trimmed = value.trim();
  const head = TOKEN_REFERENCE_HEAD.exec(trimmed);
  if (!head) return null;

  let depth = 1;
  let index = head[0].length;
  for (; index < trimmed.length && depth > 0; index += 1) {
    const char = trimmed[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
  }
  // Anything after the matching `)` means this is not a lone reference.
  if (depth !== 0 || index !== trimmed.length) return null;

  const fallback = trimmed.slice(head[0].length, index - 1).trim();
  if (fallback && !head[2]) return null;
  return { cssVar: head[1], fallback: fallback || null };
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

const HIDDEN_TOKEN_MIX =
  /^color-mix\(\s*in\s+srgb\s*,\s*(var\(.+\))\s+0%\s*,\s*transparent\s*\)$/i;

/**
 * What to write when hiding a colour. Zeroing alpha needs literal channels,
 * which a `var()` reference has none of — so a token is hidden as a 0% mix that
 * keeps the reference inside the persisted CSS. React state would not survive
 * the deselect/reselect that unmounts the inspector.
 */
export function hiddenColorWrite(
  color: string,
  zeroAlpha: (literal: string) => string | null,
): string {
  const reference = parseTokenReference(color);
  if (reference) return `color-mix(in srgb, ${color} 0%, transparent)`;
  return zeroAlpha(color) ?? "transparent";
}

/** The reference a hidden token colour carries, or null if it is not one. */
export function hiddenTokenReference(value: string): string | null {
  return HIDDEN_TOKEN_MIX.exec(value.trim())?.[1] ?? null;
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
