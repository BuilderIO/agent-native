import {
  hasOAuthTokens,
  listOAuthAccountsByOwner,
  listOAuthAccounts,
} from "../oauth-tokens/index.js";

/**
 * Check if any OAuth tokens exist for a provider.
 * Handles dev mode correctly — when session email is "local@localhost",
 * checks ALL tokens regardless of owner.
 */
export async function isOAuthConnected(
  provider: string,
  forEmail?: string,
): Promise<boolean> {
  if (forEmail && forEmail !== "local@localhost") {
    const accounts = await listOAuthAccountsByOwner(provider, forEmail);
    return accounts.length > 0;
  }
  return hasOAuthTokens(provider);
}

/**
 * Get OAuth accounts for a provider.
 * Handles dev mode correctly — when session email is "local@localhost",
 * returns ALL accounts regardless of owner.
 */
export async function getOAuthAccounts(
  provider: string,
  forEmail?: string,
): Promise<Array<{ accountId: string; tokens: Record<string, unknown> }>> {
  if (forEmail && forEmail !== "local@localhost") {
    return listOAuthAccountsByOwner(provider, forEmail);
  }
  return listOAuthAccounts(provider);
}
