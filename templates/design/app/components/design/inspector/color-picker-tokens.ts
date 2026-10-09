import { parseCssColorExtended } from "@shared/color-utils";

/**
 * The design's color tokens as the picker's Libraries pane and the token-bound
 * fills see them. A fill bound to a token is written as `var(--token)`, which
 * `parseCssColor` cannot read, so everything that draws such a fill resolves
 * it through this list first.
 */

export interface DesignColorToken {
  /** Friendly label, e.g. `Brand Primary`. */
  name: string;
  /** The custom property the token is written as, e.g. `--brand-primary`. */
  cssVar: string;
  /** The declared value, which can itself be another `var()` or any CSS color. */
  value: string;
}

/**
 * Where the token list stands. "Not loaded" and "could not load" are their own
 * states so a fill bound to a token is never reported as unresolved just
 * because the list has not arrived.
 */
export type DesignColorTokens =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; tokens: DesignColorToken[] };

export interface VarReference {
  name: string;
  fallback?: string;
}

const VAR_REFERENCE = /^var\(\s*(--[-_a-zA-Z0-9]+)\s*(?:,([\s\S]*))?\)$/;

/** `var(--name)` or `var(--name, fallback)`, or null for any other string. */
export function parseVarReference(css: string): VarReference | null {
  const match = css.trim().match(VAR_REFERENCE);
  if (!match) return null;
  const fallback = match[2]?.trim();
  return fallback ? { name: match[1]!, fallback } : { name: match[1]! };
}

export function tokenVarCss(cssVar: string): string {
  return `var(${cssVar})`;
}

export type TokenResolution =
  | {
      kind: "color";
      /** The color the reference stands for, as CSS the editor can read. */
      css: string;
      name: string;
      /** The token that supplied it; null when the `var()` fallback did. */
      token: DesignColorToken | null;
    }
  | {
      kind: "unresolved";
      name: string;
      reason: "loading" | "failed" | "missing" | "not-a-color" | "cycle";
    };

const MAX_ALIAS_DEPTH = 8;

function readableColor(css: string): boolean {
  return parseCssColorExtended(css) !== null;
}

/**
 * The color a `var()` reference stands for, or null when `css` is not a
 * reference at all. A reference that cannot be turned into a color is
 * `unresolved` with the reason, never a stand-in color.
 */
export function resolveVarColor(
  css: string,
  tokens: DesignColorTokens | undefined,
): TokenResolution | null {
  const reference = parseVarReference(css);
  if (!reference) return null;
  if (!tokens || tokens.status === "loading") {
    return { kind: "unresolved", name: reference.name, reason: "loading" };
  }
  if (tokens.status === "error") {
    return { kind: "unresolved", name: reference.name, reason: "failed" };
  }
  const byVar = new Map(tokens.tokens.map((token) => [token.cssVar, token]));

  const walk = (
    current: VarReference,
    seen: readonly string[],
  ): TokenResolution => {
    const token = byVar.get(current.name);
    if (!token) {
      if (current.fallback && readableColor(current.fallback)) {
        return {
          kind: "color",
          css: current.fallback,
          name: reference.name,
          token: null,
        };
      }
      return { kind: "unresolved", name: reference.name, reason: "missing" };
    }
    if (seen.includes(current.name) || seen.length >= MAX_ALIAS_DEPTH) {
      return { kind: "unresolved", name: reference.name, reason: "cycle" };
    }
    const alias = parseVarReference(token.value);
    if (alias) return walk(alias, [...seen, current.name]);
    const value = token.value.trim();
    if (!readableColor(value)) {
      return {
        kind: "unresolved",
        name: reference.name,
        reason: "not-a-color",
      };
    }
    return { kind: "color", css: value, name: reference.name, token };
  };

  return walk(reference, []);
}

/** The token a `var()` reference names, found in a loaded list. */
export function findToken(
  tokens: DesignColorTokens | undefined,
  cssVar: string,
): DesignColorToken | null {
  if (tokens?.status !== "ready") return null;
  return tokens.tokens.find((token) => token.cssVar === cssVar) ?? null;
}

/** Tokens whose name, custom property or value contains the query, in list order. */
export function filterTokens(
  tokens: readonly DesignColorToken[],
  query: string,
): DesignColorToken[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tokens];
  return tokens.filter(
    (token) =>
      token.name.toLowerCase().includes(needle) ||
      token.cssVar.toLowerCase().includes(needle) ||
      token.value.toLowerCase().includes(needle),
  );
}
