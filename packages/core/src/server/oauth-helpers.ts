import { listOAuthAccountsByOwner } from "../oauth-tokens/index.js";

/**
 * Check if any OAuth tokens exist for a provider, scoped to the given owner.
 * Always scopes by owner email — never returns tokens across users.
 *
 * `forEmail` is now required. Calling this without an email used to fall
 * through to an unscoped `hasOAuthTokens(provider)` which leaked the fact
 * that ANY user in the deployment had connected the provider — see the
 * `hasOAuthTokens` rationale. Callers without a session must pass the
 * dev sentinel `"local@localhost"` if they genuinely want the dev-mode
 * "any row exists" semantics.
 */
export async function isOAuthConnected(
  provider: string,
  forEmail: string,
): Promise<boolean> {
  if (!forEmail) return false;
  const accounts = await listOAuthAccountsByOwner(provider, forEmail);
  return accounts.length > 0;
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
