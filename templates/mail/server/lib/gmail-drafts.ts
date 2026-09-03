import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";

import { createOAuth2Client, googleFetch } from "./google-api.js";
import { getOAuth2Credentials } from "./google-auth.js";
import { buildRawEmail } from "./outgoing-email.js";

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
    tokens.refresh_token &&
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    const { clientId, clientSecret } = await getOAuth2Credentials(accountEmail);
    const oauth = createOAuth2Client(clientId, clientSecret, "");
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
  }
  return tokens.access_token;
}

async function resolveAccountEmail(
  requested: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!requested || requested === ownerEmail) return ownerEmail;
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (!accounts.some((account) => account.accountId === requested)) {
    throw new Error("Account not owned by current user");
  }
  return requested;
}

export async function saveGmailDraft(args: {
  ownerEmail: string;
  accountEmail?: string;
  draftId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
}): Promise<{ draftId: string; created: boolean; updated?: boolean } | null> {
  const accountEmail = await resolveAccountEmail(
    args.accountEmail,
    args.ownerEmail,
  );
  const accessToken = await getAccessToken(accountEmail);
  if (!accessToken) return null;

  const raw = buildRawEmail({
    from: accountEmail,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject || "(no subject)",
    body: args.body,
  });
  if (args.draftId) {
    try {
      const updated = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${args.draftId}`,
        accessToken,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw } }),
        },
      );
      return { draftId: updated.id, created: false, updated: true };
    } catch (error) {
      if (!(error instanceof Error) || !/\b404\b/.test(error.message)) {
        throw error;
      }
      // A deleted Gmail draft is safe to replace with a new one.
    }
  }
  const created = await googleFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    },
  );
  return { draftId: created.id, created: true };
}
