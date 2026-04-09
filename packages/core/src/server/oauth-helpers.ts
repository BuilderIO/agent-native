import {
  hasOAuthTokens,
  listOAuthAccountsByOwner,
  listOAuthAccounts,
} from "../oauth-tokens/index.js";

/**
 * Check if any OAuth tokens exist for a provider, scoped to the given owner.
 * Always scopes by owner email — never returns tokens across users.
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
 */
export async function getOAuthAccounts(
  provider: string,
  forEmail?: string,
): Promise<Array<{ accountId: string; tokens: Record<string, unknown> }>> {
  if (forEmail) {
    return listOAuthAccountsByOwner(provider, forEmail);
  }
  return listOAuthAccounts(provider);
}
