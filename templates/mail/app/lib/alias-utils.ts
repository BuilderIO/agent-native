export {
  ALIAS_PREFIX,
  aliasIdFromToken,
  expandAliasTokens,
  isAliasToken,
  unresolvedAliasIds,
} from "@shared/alias-tokens";

export class AliasResolutionError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AliasResolutionError";
    this.cause = options?.cause;
  }
}
