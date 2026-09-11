import {
  listOAuthAccountsByOwner,
  saveOAuthTokens,
  setOAuthDisplayName,
} from "@agent-native/core/oauth-tokens";

import type { CredentialContext } from "./credentials";
import {
  resolveLocalAnalyticsProviderCredential,
  resolveWorkspaceConnectionProviderCredential,
} from "./provider-credentials";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";
const PROVIDER = "github";

export const GITHUB_OAUTH_SCOPES = [
  "repo",
  "read:org",
  "read:user",
  "user:email",
];

export interface GitHubOAuthViewer {
  login: string;
  id: number;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  htmlUrl?: string | null;
}

export interface GitHubOAuthStatus {
  configured: boolean;
  connected: boolean;
  valid?: boolean;
  viewer?: GitHubOAuthViewer;
  scopes?: string[];
  error?: string;
}

function getGitHubOAuthConfig() {
  const clientId =
    process.env.GITHUB_INTEGRATION_CLIENT_ID || process.env.GITHUB_CLIENT_ID;
  const clientSecret =
    process.env.GITHUB_INTEGRATION_CLIENT_SECRET ||
    process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isGitHubOAuthConfigured(): boolean {
  return getGitHubOAuthConfig() != null;
}

export function getGitHubOAuthAuthUrl(redirectUri: string, state: string) {
  const config = getGitHubOAuthConfig();
  if (!config) throw new Error("GitHub OAuth is not configured");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_OAUTH_SCOPES.join(" "),
    state,
    allow_signup: "true",
  });
  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGitHubOAuthCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; scopes: string[] }> {
  const config = getGitHubOAuthConfig();
  if (!config) throw new Error("GitHub OAuth is not configured");

  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `GitHub token exchange failed: ${res.status} ${await res.text()}`,
    );
  }

  const body = (await res.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (body.error || !body.access_token) {
    throw new Error(
      body.error_description || body.error || "GitHub did not return a token",
    );
  }

  return {
    accessToken: body.access_token,
    scopes: (body.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

export async function saveGitHubOAuthToken(
  accessToken: string,
  ctx: CredentialContext,
  viewer: GitHubOAuthViewer,
  scopes: string[] = [],
): Promise<void> {
  const accountId = viewer.login || String(viewer.id);
  await saveOAuthTokens(
    PROVIDER,
    accountId,
    {
      accessToken,
      scopes,
      login: viewer.login,
      email: viewer.email,
      avatarUrl: viewer.avatarUrl,
      htmlUrl: viewer.htmlUrl,
    },
    ctx.userEmail,
  );
  const displayName = viewer.name || viewer.login || viewer.email;
  if (displayName) {
    await setOAuthDisplayName(PROVIDER, accountId, displayName);
  }
}

export async function fetchGitHubViewer(
  accessToken: string,
): Promise<GitHubOAuthViewer> {
  const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userRes.ok) {
    throw new Error(`GitHub user lookup failed: ${userRes.status}`);
  }

  const user = (await userRes.json()) as {
    login?: string;
    id?: number;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
    html_url?: string | null;
  };

  let email = user.email ?? null;
  if (!email) {
    const emailRes = await fetch(`${GITHUB_API_BASE}/user/emails`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (emailRes.ok) {
      const emails = (await emailRes.json()) as Array<{
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }>;
      email =
        emails.find((item) => item.primary && item.verified)?.email ??
        emails.find((item) => item.verified)?.email ??
        null;
    }
  }

  return {
    login: user.login ?? "",
    id: user.id ?? 0,
    name: user.name ?? null,
    email,
    avatarUrl: user.avatar_url ?? null,
    htmlUrl: user.html_url ?? null,
  };
}

export async function getGitHubOAuthStatus(
  ctx: CredentialContext,
): Promise<GitHubOAuthStatus> {
  const { token, scopes } = await getGitHubAccessToken(ctx);
  const configured = isGitHubOAuthConfigured();
  if (!token) return { configured, connected: false };

  try {
    const viewer = await fetchGitHubViewer(token);
    return {
      configured,
      connected: true,
      valid: true,
      viewer,
      scopes,
    };
  } catch (err) {
    return {
      configured,
      connected: true,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getGitHubAccessToken(ctx: CredentialContext): Promise<{
  token?: string;
  scopes: string[];
  source?: "workspace_connection" | "oauth" | "credential";
}> {
  const workspaceCredential =
    await resolveWorkspaceConnectionProviderCredential({
      provider: "github",
      keys: ["GITHUB_TOKEN"],
      ctx,
    });
  if (workspaceCredential) {
    return {
      token: workspaceCredential.value,
      scopes: [],
      source: "workspace_connection",
    };
  }

  if (ctx.userEmail) {
    const accounts = await listOAuthAccountsByOwner(PROVIDER, ctx.userEmail);
    const account = accounts.find(
      (item) => typeof item.tokens?.accessToken === "string",
    );
    const token = account?.tokens?.accessToken;
    if (typeof token === "string" && token) {
      const scopes = Array.isArray(account.tokens.scopes)
        ? account.tokens.scopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : [];
      return { token, scopes, source: "oauth" };
    }
  }

  const credential = await resolveLocalAnalyticsProviderCredential({
    provider: "github",
    keys: ["GITHUB_TOKEN"],
    ctx,
    workspaceConnection: false,
  });
  return credential
    ? { token: credential.value, scopes: [], source: "credential" }
    : { scopes: [] };
}
