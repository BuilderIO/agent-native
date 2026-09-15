import { listOAuthAccountsByOwner } from "../oauth-tokens/index.js";

/**
 * Check if any OAuth tokens exist for a provider, scoped to the given owner.
 * Always scopes by owner email — never returns tokens across users.
 *
 * `forEmail` is required. Calling this without an email used to fall
 * through to an unscoped `hasOAuthTokens(provider)` which leaked the fact
 * that ANY user in the deployment had connected the provider — see the
 * `hasOAuthTokens` rationale.
 */
export async function isOAuthConnected(
  provider: string,
  forEmail: string,
): Promise<boolean> {
  if (!forEmail) return false;
  const accounts = await listOAuthAccountsByOwner(provider, forEmail);
  // A row whose token bundle parses to an empty object is unusable — the
  // typical cause is a stored record that failed to decrypt after a
  // SECRETS_ENCRYPTION_KEY / BETTER_AUTH_SECRET rotation (parseStoredTokens
  // returns `{}` rather than throwing). Counting it as "connected" hides the
  // reconnect banner while every provider call fails with an undefined
  // bearer token. Ignore empty records here; we deliberately do not delete
  // them, because this process may simply hold the wrong key (e.g. a dev
  // server sharing a prod DB) while the row is still decryptable elsewhere.
  return accounts.some(
    (account) => Object.keys(account.tokens ?? {}).length > 0,
  );
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
