import type { DesignTokenType } from "@shared/design-token-types";

import type { DesignToken } from "../edit-panel/design-color-tokens";
import { parseVarReference } from "./color-picker-tokens";

export interface TokenFieldOption {
  cssVar: string;
  name: string;
  value: string;
  resolved: string;
}

export interface TokenFieldGroup {
  type: DesignTokenType;
  tier: "semantic" | "primitive";
  options: TokenFieldOption[];
}

const MAX_ALIAS_DEPTH = 8;

export function tokenFieldName(cssVar: string): string {
  return cssVar.replace(/^--/, "");
}

export function boundTokenVar(authored: string | undefined): string | null {
  if (!authored) return null;
  return parseVarReference(authored)?.name ?? null;
}

export function resolveTokenValue(
  value: string,
  byVar: ReadonlyMap<string, DesignToken>,
): string | null {
  let current = value.trim();
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    const reference = parseVarReference(current);
    if (!reference) return current;
    if (seen.has(reference.name)) return null;
    seen.add(reference.name);
    const next = byVar.get(reference.name);
    if (!next && reference.fallback === undefined) return null;
    current = (next ? next.value : (reference.fallback ?? "")).trim();
  }
  return null;
}

export function unitlessTokenValue(value: string, fieldUnit = "px"): string {
  const trimmed = value.trim();
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(trimmed);
  const number = match?.[1];
  if (number === undefined) return trimmed;
  const unit = (match?.[2] ?? "").toLowerCase();
  if (unit === "deg") return `${number}°`;
  return unit === fieldUnit.toLowerCase() ? number : trimmed;
}

export function buildTokenFieldGroups(
  tokens: readonly DesignToken[],
  accepts: readonly DesignTokenType[],
  query = "",
  fieldUnit = "px",
): TokenFieldGroup[] {
  const byVar = new Map(tokens.map((token) => [token.cssVar, token]));
  const needle = query.trim().replace(/^--/, "").toLowerCase();
  const groups: TokenFieldGroup[] = [];
  for (const type of accepts) {
    const semantic: TokenFieldOption[] = [];
    const primitive: TokenFieldOption[] = [];
    for (const token of tokens) {
      if (token.type !== type) continue;
      const resolved = resolveTokenValue(token.value, byVar);
      if (resolved === null) continue;
      const option = {
        cssVar: token.cssVar,
        name: tokenFieldName(token.cssVar),
        value: unitlessTokenValue(resolved, fieldUnit),
        resolved,
      };
      if (
        needle &&
        !option.name.toLowerCase().includes(needle) &&
        !option.value.toLowerCase().includes(needle)
      ) {
        continue;
      }
      (parseVarReference(token.value) ? semantic : primitive).push(option);
    }
    if (semantic.length)
      groups.push({ type, tier: "semantic", options: semantic });
    if (primitive.length) {
      groups.push({ type, tier: "primitive", options: primitive });
    }
  }
  return groups;
}

export function tokenGroupShowsTier(
  group: TokenFieldGroup,
  groups: readonly TokenFieldGroup[],
): boolean {
  return (
    group.tier === "primitive" &&
    groups.some(
      (other) => other.type === group.type && other.tier === "semantic",
    )
  );
}

export function isNumericDraft(draft: string): boolean {
  const trimmed = draft.trim();
  return trimmed === "" || /^[-+]?[\d.(]/.test(trimmed);
}
