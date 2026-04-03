import {
  createOAuth2Client,
  SCOPES,
  getAccessibleResources,
  jiraGetMyself,
} from "./jira-api.js";
import {
  getOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  hasOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { isOAuthConnected, getOAuthAccounts } from "@agent-native/core/server";

interface AtlassianTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
  cloud_id?: string;
  cloud_name?: string;
}

function getOAuth2Credentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET must be set in environment",
    );
  }
  return { clientId, clientSecret };
}

async function getValidAccessToken(
  accountId: string,
  tokens: AtlassianTokens,
  owner?: string,
): Promise<string> {
  if (
    tokens.expiry_date &&
    tokens.access_token &&
    Date.now() < tokens.expiry_date - 5 * 60 * 1000
  ) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    throw new Error(
      `No refresh token available for ${accountId}, cannot refresh access token`,
    );
  }

  const { clientId, clientSecret } = getOAuth2Credentials();
  const redirectUri = "http://localhost:8080/api/atlassian/callback";
  const oauth2 = createOAuth2Client(clientId, clientSecret, redirectUri);
  const refreshed = await oauth2.refreshToken(tokens.refresh_token);

  const updatedTokens: AtlassianTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || tokens.refresh_token,
    expiry_date: Date.now() + refreshed.expires_in * 1000,
    token_type: refreshed.token_type,
    scope: refreshed.scope,
  };

  await saveOAuthTokens(
    "atlassian",
    accountId,
    updatedTokens as unknown as Record<string, unknown>,
    owner,
  );

  return refreshed.access_token;
}

export function getAuthUrl(
  origin?: string,
  redirectUri?: string,
  state?: string,
): string {
  const { clientId, clientSecret } = getOAuth2Credentials();
  const uri =
    redirectUri ||
    (origin
      ? `${origin}/api/atlassian/callback`
      : "http://localhost:8080/api/atlassian/callback");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  return oauth2.generateAuthUrl({
    scope: SCOPES,
    state,
    prompt: "consent",
  });
}

export async function exchangeCode(
  code: string,
  origin?: string,
  redirectUri?: string,
  owner?: string,
): Promise<string> {
  const { clientId, clientSecret } = getOAuth2Credentials();
  const uri =
    redirectUri ||
    (origin
      ? `${origin}/api/atlassian/callback`
      : "http://localhost:8080/api/atlassian/callback");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  const tokenResponse = await oauth2.getToken(code);

  const tokens: AtlassianTokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expiry_date: Date.now() + tokenResponse.expires_in * 1000,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
  };

  // Get accessible resources (cloud ID)
  const resources = await getAccessibleResources(tokens.access_token);
  if (resources.length === 0) {
    throw new Error(
      "No Jira sites found. Make sure you have access to at least one Jira site.",
    );
  }
  const resource = resources[0];
  tokens.cloud_id = resource.id;
  tokens.cloud_name = resource.name;

  // Get user identity
  const myself = await jiraGetMyself(resource.id, tokens.access_token);
  const accountId = myself.accountId as string;
  const email = (myself.emailAddress as string) || `${accountId}@atlassian.com`;

  await saveOAuthTokens(
    "atlassian",
    email,
    tokens as unknown as Record<string, unknown>,
    owner ?? email,
  );

  return email;
}

export async function getClient(email?: string): Promise<{
  accessToken: string;
  cloudId: string;
  email: string;
  cloudName?: string;
} | null> {
  const accounts = await listOAuthAccounts("atlassian");
  if (accounts.length === 0) return null;

  let account: (typeof accounts)[0] | undefined;
  if (email && email !== "local@localhost") {
    account = accounts.find((a) => a.accountId === email);
    if (!account) return null;
  } else {
    account = accounts[0];
  }

  const tokens = account.tokens as unknown as AtlassianTokens;
  if (!tokens || !tokens.cloud_id) return null;

  const accountId = account.accountId;
  const accessToken = await getValidAccessToken(accountId, tokens);

  return {
    accessToken,
    cloudId: tokens.cloud_id,
    email: accountId,
    cloudName: tokens.cloud_name,
  };
}

export async function getClients(forEmail?: string): Promise<
  Array<{
    email: string;
    accessToken: string;
    cloudId: string;
    cloudName?: string;
  }>
> {
  const accounts = forEmail
    ? await listOAuthAccountsByOwner("atlassian", forEmail)
    : await listOAuthAccounts("atlassian");

  const results: Array<{
    email: string;
    accessToken: string;
    cloudId: string;
    cloudName?: string;
  }> = [];

  for (const account of accounts) {
    const tokens = account.tokens as unknown as AtlassianTokens;
    if (!tokens || !tokens.cloud_id) continue;

    const accountId = account.accountId;
    const ownerForRefresh: string =
      forEmail ??
      ("owner" in account && typeof account.owner === "string"
        ? account.owner
        : undefined) ??
      accountId;

    try {
      const accessToken = await getValidAccessToken(
        accountId,
        tokens,
        ownerForRefresh,
      );
      results.push({
        email: accountId,
        accessToken,
        cloudId: tokens.cloud_id,
        cloudName: tokens.cloud_name,
      });
    } catch {
      // Skip accounts with expired/invalid tokens
    }
  }

  return results;
}

export async function isConnected(forEmail?: string): Promise<boolean> {
  return isOAuthConnected("atlassian", forEmail);
}

export interface AtlassianAuthStatus {
  connected: boolean;
  accounts: Array<{
    email: string;
    cloudId?: string;
    cloudName?: string;
    expiresAt?: string;
  }>;
}

export async function getAuthStatus(
  forEmail?: string,
): Promise<AtlassianAuthStatus> {
  const oauthAccounts = await getOAuthAccounts("atlassian", forEmail);

  if (oauthAccounts.length === 0) {
    return { connected: false, accounts: [] };
  }

  const accounts: Array<{
    email: string;
    cloudId?: string;
    cloudName?: string;
    expiresAt?: string;
  }> = [];

  for (const account of oauthAccounts) {
    const tokens = account.tokens as unknown as AtlassianTokens;
    if (!tokens) continue;
    accounts.push({
      email: account.accountId,
      cloudId: tokens.cloud_id,
      cloudName: tokens.cloud_name,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
    });
  }

  return { connected: accounts.length > 0, accounts };
}

export async function disconnect(email?: string): Promise<void> {
  if (email) {
    await deleteOAuthTokens("atlassian", email);
  } else {
    await deleteOAuthTokens("atlassian");
  }
}
