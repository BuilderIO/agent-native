import type { Alias } from "@shared/types";

export const ALIAS_PREFIX = "alias:";

export function isAliasToken(token: string): boolean {
  return token.startsWith(ALIAS_PREFIX);
}

export function aliasIdFromToken(token: string): string {
  return token.slice(ALIAS_PREFIX.length);
}

export function expandAliasTokens(
  recipients: string,
  aliases: Alias[],
): string {
  const aliasMap = new Map(aliases.map((a) => [a.id, a]));
  const tokens = recipients
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const expanded: string[] = [];
  for (const token of tokens) {
    if (isAliasToken(token)) {
      const id = aliasIdFromToken(token);
      const alias = aliasMap.get(id);
      if (alias) expanded.push(...alias.emails);
    } else {
      expanded.push(token);
    }
  }
  return [...new Set(expanded)].join(", ");
}
