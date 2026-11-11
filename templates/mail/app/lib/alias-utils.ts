import { aliasIdFromToken, isAliasToken } from "@shared/alias-tokens";
import type { Alias } from "@shared/types";

export {
  ALIAS_PREFIX,
  aliasIdFromToken,
  expandAliasTokens,
  isAliasToken,
} from "@shared/alias-tokens";

export class AliasResolutionError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AliasResolutionError";
    this.cause = options?.cause;
  }
}

export function unresolvedAliasIds(
  recipients: string,
  aliases: Alias[],
): string[] {
  const known = new Set(aliases.map((a) => a.id));
  return recipients
    .split(",")
    .map((s) => s.trim())
    .filter(isAliasToken)
    .map(aliasIdFromToken)
    .filter((id) => !known.has(id));
}
