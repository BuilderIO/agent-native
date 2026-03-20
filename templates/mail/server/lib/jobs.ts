import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { isConnected, getClient } from "./google-auth.js";

const DATA_DIR = path.join(process.cwd(), "data");
const EMAILS_FILE = path.join(DATA_DIR, "emails.json");

function readEmails(): any[] {
  try {
    return JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeEmails(emails: any[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));
}

/**
 * Resurface a snoozed email: remove ARCHIVE label, add UNREAD.
 * The SSE watcher picks up the data/emails.json change and notifies the UI.
 */
export async function resurfaceEmail(emailId: string): Promise<void> {
  if (isConnected()) {
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
  const emails = readEmails();
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
    writeEmails(emails);
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

  if (isConnected()) {
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

  // Local fallback: write to emails.json as sent
  const emails = readEmails();
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
  writeEmails(emails);
}
