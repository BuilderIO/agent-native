import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { and, eq, inArray, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { EmailMessage } from "@shared/types.js";
import { db, schema } from "../db/index.js";
import { isConnected, gmailToEmailMessage } from "./google-auth.js";
import {
  createOAuth2Client,
  gmailGetMessage,
  gmailGetThread,
  gmailListLabels,
  gmailModifyMessage,
  gmailModifyThread,
  googleFetch,
} from "./google-api.js";

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

export interface SnoozeJobPayload {
  snoozedAt: number;
  snapshot: EmailMessage;
}

export interface SendLaterPayload {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  from?: string;
  accountEmail?: string;
  replyToId?: string;
  threadId?: string;
}

export interface ScheduledJobRecord {
  id: string;
  type: "snooze" | "send_later";
  ownerEmail?: string | null;
  emailId?: string | null;
  threadId?: string | null;
  accountEmail?: string | null;
  payload: string;
  runAt: number;
  status: "pending" | "processing" | "done" | "cancelled";
  createdAt: number;
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
    } catch (err: any) {
      console.error(
        `[getAccessToken] refresh failed for ${accountEmail}:`,
        err.message,
      );
    }
  }

  return tokens.access_token;
}

async function getFirstAccountToken(
  preferEmail?: string,
  ownerEmail?: string,
): Promise<{ email: string; accessToken: string } | null> {
  if (preferEmail) {
    const token = await getAccessToken(preferEmail);
    if (token) return { email: preferEmail, accessToken: token };
  }

  // Only return accounts owned by the given owner
  const accounts = ownerEmail
    ? await listOAuthAccountsByOwner("google", ownerEmail)
    : await listOAuthAccounts("google");
  for (const account of accounts) {
    const token = await getAccessToken(account.accountId);
    if (token) return { email: account.accountId, accessToken: token };
  }

  return null;
}

async function readEmails(ownerEmail: string): Promise<EmailMessage[]> {
  const data = await getUserSetting(ownerEmail, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

async function writeEmails(
  ownerEmail: string,
  emails: EmailMessage[],
): Promise<void> {
  await putUserSetting(ownerEmail, "local-emails", { emails });
}

async function fetchLabelMap(
  accessToken: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await gmailListLabels(accessToken);
    for (const label of res.labels || []) {
      if (label.id && label.name) map.set(label.id, label.name);
    }
  } catch {}
  return map;
}

async function fetchEmailSnapshot(
  ownerEmail: string,
  emailId: string,
  preferredAccountEmail?: string,
): Promise<EmailMessage | null> {
  if (await isConnected(ownerEmail)) {
    const account = await getFirstAccountToken(
      preferredAccountEmail,
      ownerEmail,
    );
    if (account) {
      const labelMap = await fetchLabelMap(account.accessToken);
      const message = await gmailGetMessage(
        account.accessToken,
        emailId,
        "full",
      );
      return gmailToEmailMessage(
        { ...message, _accountEmail: account.email },
        account.email,
        labelMap,
      );
    }
  }

  const emails = await readEmails(ownerEmail);
  return emails.find((email) => email.id === emailId) ?? null;
}

async function archiveThreadForSnooze(
  ownerEmail: string,
  emailId: string,
  threadId: string,
  accountEmail?: string,
): Promise<void> {
  if (await isConnected(ownerEmail)) {
    const account = await getFirstAccountToken(accountEmail, ownerEmail);
    if (account) {
      await gmailModifyThread(account.accessToken, threadId, undefined, [
        "INBOX",
      ]);
      return;
    }
  }

  const emails = await readEmails(ownerEmail);
  for (let i = 0; i < emails.length; i++) {
    const currentThreadId = emails[i].threadId || emails[i].id;
    if (currentThreadId === threadId) {
      emails[i] = {
        ...emails[i],
        isArchived: true,
        labelIds: emails[i].labelIds.filter((label) => label !== "inbox"),
      };
    }
  }
  await writeEmails(ownerEmail, emails);
}

async function threadHasReplySinceSnooze(
  ownerEmail: string,
  emailId: string,
  threadId: string,
  snoozedAt: number,
  accountEmail?: string,
): Promise<boolean> {
  if (await isConnected(ownerEmail)) {
    const account = await getFirstAccountToken(accountEmail, ownerEmail);
    if (account) {
      const thread = await gmailGetThread(
        account.accessToken,
        threadId,
        "full",
      );
      return (thread.messages || []).some((message: any) => {
        const internalDate = Number(message.internalDate || 0);
        return message.id !== emailId && internalDate > snoozedAt;
      });
    }
  }

  const emails = await readEmails(ownerEmail);
  return emails.some((email) => {
    const currentThreadId = email.threadId || email.id;
    return (
      currentThreadId === threadId &&
      email.id !== emailId &&
      new Date(email.date).getTime() > snoozedAt
    );
  });
}

export async function listPendingJobs(
  ownerEmail: string,
): Promise<ScheduledJobRecord[]> {
  const jobs = await db
    .select()
    .from(schema.scheduledJobs)
    .where(inArray(schema.scheduledJobs.status, ["pending", "processing"]));

  return jobs.filter((job) => {
    const jobOwner = job.ownerEmail || job.accountEmail;
    return !jobOwner || jobOwner === ownerEmail;
  }) as ScheduledJobRecord[];
}

export async function createScheduledJobRecord(input: {
  type: "snooze" | "send_later";
  ownerEmail: string;
  emailId?: string | null;
  threadId?: string | null;
  accountEmail?: string | null;
  payload?: Record<string, unknown>;
  runAt: number;
}): Promise<ScheduledJobRecord> {
  const job: ScheduledJobRecord = {
    id: nanoid(12),
    type: input.type,
    ownerEmail: input.ownerEmail,
    emailId: input.emailId ?? null,
    threadId: input.threadId ?? null,
    accountEmail: input.accountEmail ?? null,
    payload: JSON.stringify(input.payload ?? {}),
    runAt: input.runAt,
    status: "pending",
    createdAt: Date.now(),
  };

  await db.insert(schema.scheduledJobs).values(job as any);
  return job;
}

export async function scheduleSnooze(input: {
  ownerEmail: string;
  emailId: string;
  runAt: number;
  accountEmail?: string;
}): Promise<ScheduledJobRecord> {
  const snapshot = await fetchEmailSnapshot(
    input.ownerEmail,
    input.emailId,
    input.accountEmail,
  );
  if (!snapshot) {
    throw new Error("Email not found");
  }

  await archiveThreadForSnooze(
    input.ownerEmail,
    snapshot.id,
    snapshot.threadId || snapshot.id,
    input.accountEmail || snapshot.accountEmail,
  );

  return createScheduledJobRecord({
    type: "snooze",
    ownerEmail: input.ownerEmail,
    emailId: snapshot.id,
    threadId: snapshot.threadId || snapshot.id,
    accountEmail: input.accountEmail || snapshot.accountEmail || null,
    payload: {
      snoozedAt: Date.now(),
      snapshot,
    } satisfies SnoozeJobPayload,
    runAt: input.runAt,
  });
}

export async function scheduleEmailSend(input: {
  ownerEmail: string;
  runAt: number;
  payload: SendLaterPayload;
}): Promise<ScheduledJobRecord> {
  return createScheduledJobRecord({
    type: "send_later",
    ownerEmail: input.ownerEmail,
    threadId: input.payload.threadId ?? null,
    accountEmail: input.payload.accountEmail || input.payload.from || null,
    payload: input.payload as unknown as Record<string, unknown>,
    runAt: input.runAt,
  });
}

export async function resurfaceEmail(
  ownerEmail: string,
  emailId: string,
  threadId?: string,
  accountEmail?: string,
): Promise<void> {
  if (await isConnected(ownerEmail)) {
    const account = await getFirstAccountToken(accountEmail, ownerEmail);
    if (account) {
      if (threadId) {
        await gmailModifyThread(account.accessToken, threadId, ["INBOX"]);
      } else {
        await gmailModifyMessage(account.accessToken, emailId, ["INBOX"], []);
      }
      await gmailModifyMessage(account.accessToken, emailId, ["UNREAD"], []);
      return;
    }
  }

  const emails = await readEmails(ownerEmail);
  const targetThreadId = threadId || emailId;
  for (let i = 0; i < emails.length; i++) {
    const currentThreadId = emails[i].threadId || emails[i].id;
    if (currentThreadId === targetThreadId) {
      emails[i] = {
        ...emails[i],
        isArchived: false,
        isRead: false,
        labelIds: emails[i].labelIds.includes("inbox")
          ? emails[i].labelIds
          : ["inbox", ...emails[i].labelIds],
      };
    }
  }
  await writeEmails(ownerEmail, emails);
}

export function getSnoozeThreadId(job: ScheduledJobRecord): string | undefined {
  if (job.threadId) return job.threadId;
  const payload = JSON.parse(job.payload || "{}") as Partial<SnoozeJobPayload>;
  return payload.snapshot?.threadId || undefined;
}

export async function shouldResurfaceSnoozedThread(
  job: ScheduledJobRecord,
): Promise<boolean> {
  if (job.type !== "snooze" || !job.emailId) {
    return false;
  }

  const payload = JSON.parse(job.payload || "{}") as Partial<SnoozeJobPayload>;
  const ownerEmail = job.ownerEmail || job.accountEmail;
  if (!ownerEmail) return true;
  const threadId = getSnoozeThreadId(job);
  if (!threadId) {
    // Back-compat: older snooze jobs had no thread metadata. Resurface rather
    // than silently dropping them when they come due.
    return true;
  }

  const snoozedAt = payload.snoozedAt || job.createdAt;
  const hasReply = await threadHasReplySinceSnooze(
    ownerEmail,
    job.emailId,
    threadId,
    snoozedAt,
    job.accountEmail ?? undefined,
  );

  return !hasReply;
}

export async function getSyntheticEmailsForView(
  ownerEmail: string,
  view: "snoozed" | "scheduled",
): Promise<EmailMessage[]> {
  const jobs = await listPendingJobs(ownerEmail);

  if (view === "snoozed") {
    return jobs
      .filter((job) => job.type === "snooze")
      .map((job) => {
        const payload = JSON.parse(
          job.payload || "{}",
        ) as Partial<SnoozeJobPayload>;
        const snapshot = payload.snapshot;
        if (!snapshot) return null;
        return {
          ...snapshot,
          labelIds: ["snoozed"],
          isArchived: true,
          accountEmail: job.accountEmail || snapshot.accountEmail,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) => new Date(b!.date).getTime() - new Date(a!.date).getTime(),
      ) as EmailMessage[];
  }

  return jobs
    .filter((job) => job.type === "send_later")
    .map((job) => {
      const payload = JSON.parse(job.payload || "{}") as SendLaterPayload;
      const sender = payload.accountEmail || payload.from || ownerEmail;
      const threadId = payload.threadId || `scheduled-${job.id}`;
      return {
        id: `scheduled-${job.id}`,
        threadId,
        from: { name: sender, email: sender },
        to: payload.to
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((email) => ({ name: email, email })),
        ...(payload.cc
          ? {
              cc: payload.cc
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
                .map((email) => ({ name: email, email })),
            }
          : {}),
        ...(payload.bcc
          ? {
              bcc: payload.bcc
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
                .map((email) => ({ name: email, email })),
            }
          : {}),
        subject: payload.subject,
        snippet: payload.body.slice(0, 120).replace(/\n/g, " "),
        body: payload.body,
        date: new Date(job.runAt).toISOString(),
        isRead: true,
        isStarred: false,
        isArchived: false,
        isTrashed: false,
        labelIds: ["scheduled"],
        accountEmail: payload.accountEmail || undefined,
      } satisfies EmailMessage;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function sendScheduledEmail(
  payload: SendLaterPayload,
  accountEmail?: string,
  ownerEmail?: string,
): Promise<void> {
  const { to, cc, bcc, subject, body, from, replyToId, threadId } = payload;
  const effectiveOwner = ownerEmail || accountEmail || from;

  if (await isConnected(effectiveOwner)) {
    const account = await getFirstAccountToken(
      accountEmail || from,
      effectiveOwner,
    );
    if (account) {
      let inReplyTo: string | undefined;
      let references: string | undefined;

      if (replyToId) {
        try {
          const original = await gmailGetMessage(
            account.accessToken,
            replyToId,
            "metadata",
          );
          const headers = original.payload?.headers || [];
          inReplyTo =
            headers.find((header: any) => header.name === "Message-Id")
              ?.value ?? undefined;
          const refs = headers.find(
            (header: any) => header.name === "References",
          )?.value;
          references = [refs, inReplyTo].filter(Boolean).join(" ");
        } catch {}
      }

      // Resolve sender display name
      let senderFrom = from || account.email || "me";
      if (!senderFrom.includes("<")) {
        try {
          const profile = await googleFetch(
            `https://www.googleapis.com/oauth2/v2/userinfo`,
            account.accessToken,
          );
          if (profile?.name) {
            senderFrom = `${profile.name} <${senderFrom}>`;
          }
        } catch {
          // Fall back to email-only
        }
      }

      const lines = [
        `From: ${senderFrom}`,
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        ...(bcc ? [`Bcc: ${bcc}`] : []),
        `Subject: ${subject}`,
        ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
        ...(references ? [`References: ${references}`] : []),
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

  const fallbackOwner = ownerEmail || from || accountEmail || "local@localhost";
  const emails = await readEmails(fallbackOwner);
  emails.push({
    id: `msg-${nanoid(8)}`,
    threadId: threadId || `thread-${nanoid(8)}`,
    from: { name: fallbackOwner, email: fallbackOwner },
    to: to.split(",").map((item) => {
      const email = item.trim();
      return { name: email, email };
    }),
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
  await writeEmails(fallbackOwner, emails);
}

export async function markJobCancelled(id: string): Promise<void> {
  await db
    .update(schema.scheduledJobs)
    .set({ status: "cancelled" } as any)
    .where(eq(schema.scheduledJobs.id, id));
}

export async function markJobDone(id: string): Promise<void> {
  await db
    .update(schema.scheduledJobs)
    .set({ status: "done" } as any)
    .where(eq(schema.scheduledJobs.id, id));
}

export async function markJobProcessing(id: string): Promise<void> {
  await db
    .update(schema.scheduledJobs)
    .set({ status: "processing" } as any)
    .where(eq(schema.scheduledJobs.id, id));
}

export async function getDuePendingJobs(
  now: number,
): Promise<ScheduledJobRecord[]> {
  const due = await db
    .select()
    .from(schema.scheduledJobs)
    .where(
      and(
        eq(schema.scheduledJobs.status, "pending"),
        lte(schema.scheduledJobs.runAt, now),
      ),
    );

  return due as ScheduledJobRecord[];
}
