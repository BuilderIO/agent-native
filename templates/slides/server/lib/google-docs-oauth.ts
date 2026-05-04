import {
  deleteOAuthTokens,
  getOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GOOGLE_DOCS_PROVIDER = "google-docs";
export const GOOGLE_DOCS_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

interface GoogleDocsTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

interface GoogleUserInfo {
  email?: string;
  name?: string;
  verified_email?: boolean;
}

function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

export function isGoogleDocsOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGooglePickerConfig(): {
  apiKey: string | null;
  appId: string | null;
} {
  return {
    apiKey:
      process.env.GOOGLE_PICKER_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.VITE_GOOGLE_PICKER_API_KEY ||
      null,
    appId:
      process.env.GOOGLE_PICKER_APP_ID ||
      process.env.GOOGLE_PROJECT_NUMBER ||
      process.env.VITE_GOOGLE_PICKER_APP_ID ||
      null,
  };
}

export function getGoogleDocsAuthUrl(
  redirectUri: string,
  state: string,
): string {
  const { clientId } = getOAuthCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DOCS_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function refreshGoogleDocsToken(
  accountId: string,
  owner: string,
  tokens: GoogleDocsTokens,
): Promise<string> {
  if (
    tokens.expiry_date &&
    tokens.access_token &&
    Date.now() < tokens.expiry_date - 5 * 60 * 1000
  ) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    await deleteOAuthTokens(GOOGLE_DOCS_PROVIDER, accountId);
    throw new Error("Google Docs connection expired. Please reconnect.");
  }

  const { clientId, clientSecret } = getOAuthCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    if (
      data.error === "invalid_grant" ||
      data.error === "unauthorized_client" ||
      data.error === "invalid_client"
    ) {
      await deleteOAuthTokens(GOOGLE_DOCS_PROVIDER, accountId);
    }
    throw new Error(
      data.error_description || data.error || "Could not refresh Google token.",
    );
  }

  const updated: GoogleDocsTokens = {
    ...tokens,
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
    token_type: data.token_type,
    scope: data.scope ?? tokens.scope,
  };
  await saveOAuthTokens(
    GOOGLE_DOCS_PROVIDER,
    accountId,
    updated as unknown as Record<string, unknown>,
    owner,
  );
  return data.access_token;
}

async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not read Google account profile.");
  }
  return (await response.json()) as GoogleUserInfo;
}

export async function exchangeGoogleDocsCode(opts: {
  code: string;
  redirectUri: string;
  owner: string;
}): Promise<{ email: string; name?: string }> {
  const { clientId, clientSecret } = getOAuthCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Google token exchange failed.",
    );
  }

  const user = await getUserInfo(data.access_token);
  if (!user.email) throw new Error("Google returned no email address.");
  if (user.verified_email === false) {
    throw new Error("Google account email is not verified.");
  }

  const tokens: GoogleDocsTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };

  await saveOAuthTokens(
    GOOGLE_DOCS_PROVIDER,
    user.email,
    tokens as unknown as Record<string, unknown>,
    opts.owner,
  );

  return { email: user.email, name: user.name };
}

export async function listGoogleDocsAccounts(owner: string): Promise<
  Array<{
    email: string;
    scope?: string;
  }>
> {
  const accounts = await listOAuthAccountsByOwner(GOOGLE_DOCS_PROVIDER, owner);
  return accounts.map((account) => ({
    email: account.accountId,
    scope:
      typeof account.tokens.scope === "string"
        ? account.tokens.scope
        : undefined,
  }));
}

export async function disconnectGoogleDocs(owner: string): Promise<void> {
  const accounts = await listOAuthAccountsByOwner(GOOGLE_DOCS_PROVIDER, owner);
  await Promise.all(
    accounts.map((account) =>
      deleteOAuthTokens(GOOGLE_DOCS_PROVIDER, account.accountId),
    ),
  );
}

export async function getGoogleDocsAccessToken(owner: string): Promise<{
  accessToken: string;
  accountEmail: string;
} | null> {
  const accounts = await listOAuthAccountsByOwner(GOOGLE_DOCS_PROVIDER, owner);
  if (accounts.length === 0) return null;

  const account = accounts[0];
  const stored = await getOAuthTokens(GOOGLE_DOCS_PROVIDER, account.accountId);
  if (!stored) return null;

  const accessToken = await refreshGoogleDocsToken(
    account.accountId,
    owner,
    stored as unknown as GoogleDocsTokens,
  );
  return { accessToken, accountEmail: account.accountId };
}
