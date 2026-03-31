import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccounts,
} from "@agent-native/core/oauth-tokens";

interface AtlassianTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  cloud_id?: string;
  cloud_name?: string;
}

export async function getAtlassianClient(): Promise<{
  accessToken: string;
  cloudId: string;
  email: string;
}> {
  const accounts = await listOAuthAccounts("atlassian");
  if (accounts.length === 0) {
    throw new Error(
      "No Atlassian account connected. Please connect via the Settings page.",
    );
  }

  const account = accounts[0];
  const tokens = account.tokens as unknown as AtlassianTokens;
  if (!tokens?.access_token || !tokens?.cloud_id) {
    throw new Error("Invalid Atlassian tokens. Please reconnect.");
  }

  // Check if token needs refresh
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 5 * 60 * 1000) {
    if (!tokens.refresh_token) {
      throw new Error("Token expired and no refresh token available.");
    }

    const clientId = process.env.ATLASSIAN_CLIENT_ID;
    const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET required.",
      );
    }

    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const refreshed = await res.json();

    const updated: AtlassianTokens = {
      ...tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expiry_date: Date.now() + refreshed.expires_in * 1000,
    };

    await saveOAuthTokens(
      "atlassian",
      account.accountId,
      updated as unknown as Record<string, unknown>,
    );

    return {
      accessToken: updated.access_token,
      cloudId: tokens.cloud_id,
      email: account.accountId,
    };
  }

  return {
    accessToken: tokens.access_token,
    cloudId: tokens.cloud_id,
    email: account.accountId,
  };
}

export function jiraUrl(cloudId: string, path: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
}

export function agileUrl(cloudId: string, path: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0${path}`;
}

export async function jiraFetch(
  url: string,
  accessToken: string,
  opts?: RequestInit,
): Promise<any> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jira API ${res.status}: ${text}`);
  }
  if (res.status === 204) return {};
  return res.json();
}
