import { getSetting, putSetting } from "@agent-native/core/settings";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccounts,
} from "@agent-native/core/oauth-tokens";
import { isConnected } from "./google-auth.js";
import {
  createOAuth2Client,
  gmailModifyMessage,
  googleFetch,
} from "./google-api.js";
import type { EmailMessage } from "@shared/types.js";

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

async function getAccessToken(accountEmail: string): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountEmail)) as
    | StoredTokens
    | undefined;
  if (!tokens?.access_token) return null;

  // If token expires within 5 minutes, refresh it
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
        "http://localhost:8080/api/google/callback",
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
    } catch (err: any) {
      console.error(
        `[getAccessToken] refresh failed for ${accountEmail}:`,
        err.message,
      );
    }
  }

  return tokens.access_token;
}

/** Find the first connected account's email and get its access token. */
async function getFirstAccountToken(
  preferEmail?: string,
): Promise<{ email: string; accessToken: string } | null> {
  if (preferEmail) {
    const token = await getAccessToken(preferEmail);
    if (token) return { email: preferEmail, accessToken: token };
  }
  const accounts = await listOAuthAccounts("google");
  for (const account of accounts) {
    const token = await getAccessToken(account.accountId);
    if (token) return { email: account.accountId, accessToken: token };
  }
  return null;
}

async function readEmails(): Promise<any[]> {
  const data = await getSetting("local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

async function writeEmails(emails: any[]): Promise<void> {
  await putSetting("local-emails", { emails });
}

/**
 * Resurface a snoozed email: remove ARCHIVE label, add UNREAD.
 * The SSE watcher picks up the data change and notifies the UI.
 */
export async function resurfaceEmail(
  emailId: string,
  accountEmail?: string,
): Promise<void> {
  if (await isConnected(accountEmail)) {
    const account = await getFirstAccountToken(accountEmail);
    if (account) {
      await gmailModifyMessage(
        account.accessToken,
        emailId,
        ["INBOX", "UNREAD"],
        [],
      );
      return;
    }
  }

  // Local fallback
  const emails = await readEmails();
  const idx = emails.findIndex((e: any) => e.id === emailId);
  if (idx !== -1) {
    emails[idx] = {
      ...emails[idx],
      isArchived: false,
      isRead: false,
      labelIds: [
        "inbox",
        ...(emails[idx].labelIds || []).filter((l: string) => l !== "inbox"),
      ],
    };
    await writeEmails(emails);
  }
}

export interface SendLaterPayload {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  from?: string;
  replyToId?: string;
  threadId?: string;
}

/**
 * Send a scheduled email via Gmail API or save to local sent.
 */
export async function sendScheduledEmail(
  payload: SendLaterPayload,
  accountEmail?: string,
): Promise<void> {
  const { to, cc, bcc, subject, body, from, replyToId, threadId } = payload;

  if (await isConnected(accountEmail || from)) {
    const account = await getFirstAccountToken(accountEmail || from);
    if (account) {
      const lines = [
        `From: ${from || "me"}`,
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        ...(bcc ? [`Bcc: ${bcc}`] : []),
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        "",
        body,
      ];
      const raw = Buffer.from(lines.join("\r\n"))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const sendBody: any = { raw };
      if (threadId) sendBody.threadId = threadId;

      await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
        account.accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sendBody),
        },
      );
      return;
    }
  }

  // Local fallback: write to emails as sent
  const emails = await readEmails();
  const { nanoid } = await import("nanoid");
  emails.push({
    id: `msg-${nanoid(8)}`,
    threadId: threadId || `thread-${nanoid(8)}`,
    from: { name: from || "me", email: from || "me" },
    to: to.split(",").map((t: string) => ({ name: t.trim(), email: t.trim() })),
    subject,
    snippet: body.slice(0, 120),
    body,
    date: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    isSent: true,
    isArchived: false,
    isTrashed: false,
    labelIds: ["sent"],
  });
  await writeEmails(emails);
}
