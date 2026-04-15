import {
  hasOAuthTokens,
  listOAuthAccountsByOwner,
} from "../oauth-tokens/index.js";

/**
 * Check if any OAuth tokens exist for a provider, scoped to the given owner.
 * Always scopes by owner email — never returns tokens across users.
 * (`local@localhost` is treated as a wildcard inside the store layer; see
 * `listOAuthAccountsByOwner`.)
 */
export async function isOAuthConnected(
  provider: string,
  forEmail?: string,
): Promise<boolean> {
  if (forEmail) {
    const accounts = await listOAuthAccountsByOwner(provider, forEmail);
    return accounts.length > 0;
  }
  return hasOAuthTokens(provider);
}

/**
 * Get OAuth accounts for a provider, scoped to the given owner.
 * Always scopes by owner email — never returns tokens across users.
 * Returns empty array when forEmail is not provided (prevents leaking all accounts).
 */
export async function getOAuthAccounts(
  provider: string,
  forEmail?: string,
): Promise<Array<{ accountId: string; tokens: Record<string, unknown> }>> {
  if (!forEmail) {
    return [];
  }
  return listOAuthAccountsByOwner(provider, forEmail);
}
