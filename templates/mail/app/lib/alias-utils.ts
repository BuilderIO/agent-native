import type { Alias } from "@shared/types";

/** Token prefix used to identify alias references in recipient strings */
export const ALIAS_PREFIX = "alias:";

/** Returns true if a recipient token is an alias reference */
export function isAliasToken(token: string): boolean {
  return token.startsWith(ALIAS_PREFIX);
}

/** Extracts the alias id from an alias token like "alias:abc123" */
export function aliasIdFromToken(token: string): string {
  return token.slice(ALIAS_PREFIX.length);
}

/**
 * Expands alias tokens in a comma-separated recipients string.
 * "alias:abc123, bob@example.com" → "sarah@example.com, mike@example.com, bob@example.com"
 * Unknown alias IDs are dropped silently.
 */
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
  // Deduplicate
  return [...new Set(expanded)].join(", ");
}
