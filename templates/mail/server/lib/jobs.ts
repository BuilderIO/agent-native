import { google } from "googleapis";
import { getSetting, putSetting } from "@agent-native/core/settings";
import { isConnected, getClient } from "./google-auth.js";
import type { EmailMessage } from "@shared/types.js";

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
export async function resurfaceEmail(emailId: string): Promise<void> {
  if (await isConnected()) {
    const client = await getClient();
    if (client) {
      const gmail = google.gmail({ version: "v1", auth: client });
      await gmail.users.messages.modify({
        userId: "me",
        id: emailId,
        requestBody: {
          addLabelIds: ["INBOX", "UNREAD"],
          removeLabelIds: [],
        },
      });
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
): Promise<void> {
  const { to, cc, bcc, subject, body, from, replyToId, threadId } = payload;

  if (await isConnected()) {
    const client = await getClient(from);
    if (client) {
      const gmail = google.gmail({ version: "v1", auth: client });
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

      const requestBody: any = { raw };
      if (threadId) requestBody.threadId = threadId;

      await (gmail.users.messages.send as any)({
        userId: "me",
        requestBody,
      });
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
