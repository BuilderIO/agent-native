import { listOAuthAccountsByOwner } from "../oauth-tokens/index.js";

export async function isOAuthConnected(
  provider: string,
  forEmail: string,
): Promise<boolean> {
  if (!forEmail) return false;
  const accounts = await listOAuthAccountsByOwner(provider, forEmail);
  // bearer token. Ignore empty records here; we deliberately do not delete
  return accounts.some(
    (account) => Object.keys(account.tokens ?? {}).length > 0,
  );
}

export async function getOAuthAccounts(
  provider: string,
  forEmail?: string,
): Promise<Array<{ accountId: string; tokens: Record<string, unknown> }>> {
  if (!forEmail) {
    return [];
  }
  return listOAuthAccountsByOwner(provider, forEmail);
}
