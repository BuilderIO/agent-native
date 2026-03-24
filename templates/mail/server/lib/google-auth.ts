import {
  createOAuth2Client,
  gmailGetProfile,
  gmailListMessages,
  gmailGetMessage,
  gmailListLabels,
  peopleGetProfile,
} from "./google-api.js";
import {
  getOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  hasOAuthTokens,
} from "@agent-native/core/oauth-tokens";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function getOAuth2Credentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Get a valid access token for the given stored tokens, refreshing if expired.
 * Returns the (possibly refreshed) access token and updates stored tokens if refreshed.
 */
async function getValidAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
): Promise<string> {
  // If token is not expired (with 5-minute buffer), return it directly
  if (
    tokens.expiry_date &&
    tokens.access_token &&
    Date.now() < tokens.expiry_date - 5 * 60 * 1000
  ) {
    return tokens.access_token;
  }

  // Token is expired or about to expire — refresh it
  if (!tokens.refresh_token) {
    throw new Error(
      `No refresh token available for ${accountId}, cannot refresh access token`,
    );
  }

  const { clientId, clientSecret } = getOAuth2Credentials();
  const redirectUri = "http://localhost:8080/api/google/callback";
  const oauth2 = createOAuth2Client(clientId, clientSecret, redirectUri);
  const refreshed = await oauth2.refreshToken(tokens.refresh_token);

  const updatedTokens: GoogleTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + refreshed.expires_in * 1000,
    token_type: refreshed.token_type,
    scope: refreshed.scope,
  };

  await saveOAuthTokens(
    "google",
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
      ? `${origin}/api/google/callback`
      : "http://localhost:8080/api/google/callback");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
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
      ? `${origin}/api/google/callback`
      : "http://localhost:8080/api/google/callback");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  const tokenResponse = await oauth2.getToken(code);

  const tokens: GoogleTokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expiry_date: Date.now() + tokenResponse.expires_in * 1000,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
  };

  // Determine the email address for this account
  const profile = await gmailGetProfile(tokens.access_token);
  const email = profile.emailAddress;
  if (!email) throw new Error("Google returned no email address");

  await saveOAuthTokens(
    "google",
    email,
    tokens as unknown as Record<string, unknown>,
    owner ?? email,
  );

  return email;
}

export async function getClient(
  email?: string,
): Promise<{ accessToken: string; email: string } | null> {
  const accounts = await listOAuthAccounts("google");
  if (accounts.length === 0) return null;

  let account: (typeof accounts)[0] | undefined;
  if (email) {
    account = accounts.find((a) => a.accountId === email);
    if (!account) return null;
  } else {
    account = accounts[0];
  }

  const tokens = account.tokens as unknown as GoogleTokens;
  if (!tokens) return null;

  const accountId = account.accountId;
  const accessToken = await getValidAccessToken(accountId, tokens);

  return { accessToken, email: accountId };
}

/**
 * Get OAuth credentials. When `forEmail` is provided, returns only that
 * user's credentials (multi-user mode). Otherwise returns all (legacy).
 */
export async function getClients(
  forEmail?: string,
): Promise<
  Array<{ email: string; accessToken: string; refreshToken: string }>
> {
  // When forEmail is provided, get all accounts owned by that user
  // Otherwise return all accounts globally (legacy)
  const accounts = forEmail
    ? await listOAuthAccountsByOwner("google", forEmail)
    : await listOAuthAccounts("google");

  const results: Array<{
    email: string;
    accessToken: string;
    refreshToken: string;
  }> = [];

  for (const account of accounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    if (!tokens) continue;

    const accountId = account.accountId;
    // Preserve the stored owner on token refresh to avoid ownership conflicts
    const ownerForRefresh: string =
      forEmail ??
      ("owner" in account && typeof account.owner === "string"
        ? account.owner
        : undefined) ??
      accountId;

    const accessToken = await getValidAccessToken(
      accountId,
      tokens,
      ownerForRefresh,
    );

    results.push({
      email: accountId,
      accessToken,
      refreshToken: tokens.refresh_token || "",
    });
  }

  return results;
}

/**
 * Check if a Google account is connected. When `forEmail` is provided,
 * checks only that specific account.
 */
export async function isConnected(forEmail?: string): Promise<boolean> {
  if (forEmail) {
    const accounts = await listOAuthAccountsByOwner("google", forEmail);
    return accounts.length > 0;
  }
  return hasOAuthTokens("google");
}

export async function getConnectedAccounts(): Promise<string[]> {
  const accounts = await listOAuthAccounts("google");
  return accounts.map((a) => a.accountId);
}

export interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string; photoUrl?: string }>;
}

/**
 * Get the OAuth status. When `forEmail` is provided, only returns
 * status for that specific account (multi-user mode).
 */
export async function getAuthStatus(
  forEmail?: string,
): Promise<GoogleAuthStatus> {
  let oauthAccounts: Array<{
    accountId: string;
    tokens: Record<string, unknown>;
  }>;
  if (forEmail) {
    oauthAccounts = await listOAuthAccountsByOwner("google", forEmail);
  } else {
    oauthAccounts = await listOAuthAccounts("google");
  }

  if (oauthAccounts.length === 0) {
    return { connected: false, accounts: [] };
  }

  const accounts: Array<{
    email: string;
    expiresAt?: string;
    photoUrl?: string;
  }> = [];
  for (const account of oauthAccounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    if (!tokens) continue;
    const email = account.accountId;
    let photoUrl: string | undefined;
    try {
      const accessToken = await getValidAccessToken(email, tokens);
      const profile = await peopleGetProfile(accessToken, "photos");
      photoUrl = profile.photos?.[0]?.url ?? undefined;
    } catch {}
    accounts.push({
      email,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
      photoUrl,
    });
  }

  return {
    connected: accounts.length > 0,
    accounts,
  };
}

export async function disconnect(email?: string): Promise<void> {
  if (email) {
    await deleteOAuthTokens("google", email);
  } else {
    await deleteOAuthTokens("google");
  }
}

export async function listGmailMessages(
  query?: string,
  maxResults = 50,
  forEmail?: string,
): Promise<{
  messages: any[];
  errors: Array<{ email: string; error: string }>;
}> {
  const clients = await getClients(forEmail);
  if (clients.length === 0) return { messages: [], errors: [] };

  const errors: Array<{ email: string; error: string }> = [];

  const allResults = await Promise.all(
    clients.map(async ({ email, accessToken }) => {
      try {
        const listRes = await gmailListMessages(accessToken, {
          q: query || "in:inbox",
          maxResults,
        });

        const messageIds = listRes.messages || [];
        if (messageIds.length === 0) return [];

        const messages = await Promise.all(
          messageIds.map(async (m: any) => {
            const msg = await gmailGetMessage(accessToken, m.id, "full");
            return { ...msg, _accountEmail: email };
          }),
        );

        return messages;
      } catch (error: any) {
        console.error(
          `[listGmailMessages] Error fetching from ${email}:`,
          error.message,
        );
        errors.push({ email, error: error.message });
        return [];
      }
    }),
  );

  return { messages: allResults.flat(), errors };
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: raw, email: raw };
}

function parseAddressList(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw.split(",").map((a) => parseEmailAddress(a.trim()));
}

function getBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    // Prefer text/plain, fallback to text/html
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain",
    );
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    // Recurse into multipart
    for (const p of payload.parts) {
      const body = getBody(p);
      if (body) return body;
    }
  }
  return "";
}

function getBodyHtml(payload: any): string | undefined {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, "base64url").toString("utf-8");
    }
    // Recurse into multipart
    for (const p of payload.parts) {
      const html = getBodyHtml(p);
      if (html) return html;
    }
  }
  return undefined;
}

/** Build a map of Content-ID -> attachmentId from inline parts */
function getInlineAttachments(
  payload: any,
): Map<string, { attachmentId: string; mimeType: string }> {
  const map = new Map<string, { attachmentId: string; mimeType: string }>();
  function walk(part: any) {
    const headers = part.headers || [];
    const contentId = headers.find(
      (h: any) => h.name.toLowerCase() === "content-id",
    )?.value;
    const attachmentId = part.body?.attachmentId;
    if (contentId && attachmentId) {
      // Strip angle brackets: <image001> -> image001
      const cid = contentId.replace(/^<|>$/g, "");
      map.set(cid, { attachmentId, mimeType: part.mimeType || "image/png" });
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return map;
}

/** Replace cid: URLs in HTML with proxy API URLs */
function replaceCidUrls(
  html: string,
  messageId: string,
  inlineAttachments: Map<string, { attachmentId: string; mimeType: string }>,
): string {
  if (inlineAttachments.size === 0) return html;
  return html.replace(/\bcid:([^\s"'<>]+)/g, (_match, cid) => {
    const att = inlineAttachments.get(cid);
    if (att) {
      return `/api/attachments?messageId=${messageId}&id=${encodeURIComponent(att.attachmentId)}`;
    }
    return _match;
  });
}

export async function fetchGmailLabelMap(
  accessToken: string,
): Promise<Map<string, string>> {
  const res = await gmailListLabels(accessToken);
  const map = new Map<string, string>();
  for (const label of res.labels || []) {
    if (label.id && label.name) {
      map.set(label.id, label.name);
    }
  }
  return map;
}

export function gmailToEmailMessage(
  msg: any,
  accountEmail?: string,
  labelMap?: Map<string, string>,
): any {
  const headers = msg.payload?.headers || [];
  const from = parseEmailAddress(getHeader(headers, "From"));
  const to = parseAddressList(getHeader(headers, "To"));
  const cc = parseAddressList(getHeader(headers, "Cc"));
  const subject = getHeader(headers, "Subject");
  const date = getHeader(headers, "Date");
  const labels: string[] = msg.labelIds || [];

  const payload = msg.payload || {};
  const inlineAttachments = getInlineAttachments(payload);
  let bodyHtml = getBodyHtml(payload);
  if (bodyHtml && inlineAttachments.size > 0) {
    bodyHtml = replaceCidUrls(bodyHtml, msg.id, inlineAttachments);
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    snippet: msg.snippet || "",
    body: getBody(payload),
    bodyHtml,
    date: new Date(date).toISOString(),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    isDraft: labels.includes("DRAFT"),
    isSent: labels.includes("SENT"),
    isArchived:
      !labels.includes("INBOX") &&
      !labels.includes("DRAFT") &&
      !labels.includes("SENT") &&
      !labels.includes("TRASH"),
    isTrashed: labels.includes("TRASH"),
    labelIds: labels
      .filter(
        (l: string) =>
          ![
            "UNREAD",
            "STARRED",
            "IMPORTANT",
            "CATEGORY_PERSONAL",
            "CATEGORY_SOCIAL",
            "CATEGORY_UPDATES",
            "CATEGORY_PROMOTIONS",
            "CATEGORY_FORUMS",
          ].includes(l),
      )
      .map((l: string) => {
        let name = labelMap?.get(l) || l;
        // Use last segment of nested labels (e.g. "[Superhuman]/AI/Respond" -> "Respond")
        const lastSlash = name.lastIndexOf("/");
        if (lastSlash >= 0) name = name.slice(lastSlash + 1);
        return name.replace(/_/g, " ").toLowerCase();
      }),
    accountEmail: accountEmail || msg._accountEmail,
  };
}
