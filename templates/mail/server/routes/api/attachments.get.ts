import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { getSession } from "@agent-native/core/server";
import { isConnected } from "../../lib/google-auth.js";
import {
  createOAuth2Client,
  gmailGetAttachment,
} from "../../lib/google-api.js";

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

async function getAccessToken(accountEmail: string): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountEmail)) as unknown as
    | StoredTokens
    | undefined;
  if (!tokens?.access_token) return null;

  if (
    tokens.expiry_date &&
    tokens.refresh_token &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID!;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
      const oauth = createOAuth2Client(
        clientId,
        clientSecret,
        "http://localhost:8080/_agent-native/google/callback",
      );
      const refreshed = await oauth.refreshToken(tokens.refresh_token);
      const updated = {
        ...tokens,
        access_token: refreshed.access_token,
        expiry_date: Date.now() + refreshed.expires_in * 1000,
      };
      await saveOAuthTokens(
        "google",
        accountEmail,
        updated as unknown as Record<string, unknown>,
      );
      return refreshed.access_token;
    } catch {
      // Use existing token
    }
  }

  return tokens.access_token;
}

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  const userEmail = session?.email ?? "local@localhost";

  if (!(await isConnected(userEmail))) {
    setResponseStatus(event, 404);
    return { error: "No Google account connected" };
  }

  const { messageId, id, mimeType } = getQuery(event) as {
    messageId?: string;
    id?: string;
    mimeType?: string;
  };

  if (!messageId || !id) {
    setResponseStatus(event, 400);
    return { error: "messageId and id are required" };
  }

  // Allowlist of safe content types for inline display
  const SAFE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
  ]);
  const contentType =
    mimeType && SAFE_TYPES.has(mimeType)
      ? mimeType
      : "application/octet-stream";

  const accounts = await listOAuthAccountsByOwner("google", userEmail);
  for (const account of accounts) {
    try {
      const accessToken = await getAccessToken(account.accountId);
      if (!accessToken) continue;

      const res = await gmailGetAttachment(accessToken, messageId, id);
      const data = res.data;
      if (!data) {
        continue;
      }

      const buffer = Buffer.from(data, "base64url");

      setResponseHeader(event, "Cache-Control", "private, max-age=31536000");
      setResponseHeader(event, "Content-Length", buffer.length);
      // X-Content-Type-Options prevents MIME sniffing of HTML for XSS
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      setResponseHeader(event, "Content-Type", contentType);

      return buffer;
    } catch {
      // Try next account
      continue;
    }
  }

  setResponseStatus(event, 404);
  return { error: "Attachment not found" };
});
