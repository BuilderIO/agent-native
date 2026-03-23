import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import type { EmailMessage, Label, UserSettings } from "@shared/types.js";
import { google } from "googleapis";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { getSession } from "@agent-native/core/server";
import {
  isConnected,
  getClient,
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
} from "../lib/google-auth.js";

/** Extract the logged-in user's email from the request session. */
async function userEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

// ─── Settings defaults ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS: UserSettings = {
  name: "",
  email: "",
  theme: "dark",
  density: "comfortable",
  previewPane: "right",
  sendAndArchive: false,
  undoSendDelay: 5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readEmails(email: string): Promise<EmailMessage[]> {
  const data = await getUserSetting(email, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

async function writeEmails(
  email: string,
  emails: EmailMessage[],
): Promise<void> {
  await putUserSetting(email, "local-emails", { emails });
}

async function readLabels(email: string): Promise<Label[]> {
  const data = await getUserSetting(email, "labels");
  if (data && Array.isArray((data as any).labels)) {
    return (data as any).labels;
  }
  return [];
}

async function writeLabels(email: string, labels: Label[]): Promise<void> {
  await putUserSetting(email, "labels", { labels });
}

async function readSettings(email: string): Promise<UserSettings> {
  const data = await getUserSetting(email, "mail-settings");
  if (data) {
    return { ...DEFAULT_SETTINGS, ...(data as any) } as UserSettings;
  }
  return { ...DEFAULT_SETTINGS };
}

function recomputeUnreadCounts(
  emails: EmailMessage[],
  labels: Label[],
): Label[] {
  return labels.map((label) => {
    const active = emails.filter(
      (e) => !e.isArchived && !e.isTrashed && e.labelIds.includes(label.id),
    );
    const unread = active.filter((e) => !e.isRead).length;
    return { ...label, unreadCount: unread, totalCount: active.length };
  });
}

// ─── Email list ───────────────────────────────────────────────────────────────

export const listEmails = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { view = "inbox", q } = getQuery(event) as {
    view?: string;
    q?: string;
  };

  // If Google is connected, fetch from Gmail directly (skip demo data)
  if (await isConnected(email)) {
    try {
      // Map view to Gmail search query
      const gmailQuery: Record<string, string> = {
        inbox: "in:inbox",
        unread: "is:unread in:inbox",
        starred: "is:starred",
        sent: "in:sent",
        drafts: "in:drafts",
        archive: "-in:inbox -in:sent -in:drafts -in:trash",
        trash: "in:trash",
        all: "",
      };
      let searchQuery = gmailQuery[view] ?? `label:${view}`;
      if (q) searchQuery += ` ${q}`;

      // Fetch label name mapping from all accounts
      const clients = await getClients(email);
      const labelMap = new Map<string, string>();
      await Promise.all(
        clients.map(async ({ client }) => {
          try {
            const map = await fetchGmailLabelMap(client);
            for (const [id, name] of map) labelMap.set(id, name);
          } catch (err: any) {
            console.error(
              "[listEmails] Failed to fetch label map:",
              err?.message,
            );
          }
        }),
      );
      const { messages, errors } = await listGmailMessages(
        searchQuery,
        undefined,
        email,
      );
      if (messages.length === 0 && errors.length > 0) {
        // All accounts failed — surface as error
        setResponseStatus(event, 502);
        return {
          error: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
        };
      }
      const emails = messages.map((m) =>
        gmailToEmailMessage(m, undefined, labelMap),
      );
      emails.sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      // If some accounts failed but others succeeded, add warning header
      if (errors.length > 0) {
        setResponseHeader(event, "X-Account-Errors", JSON.stringify(errors));
      }
      return emails;
    } catch (error: any) {
      console.error("[listEmails] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  let emails = await readEmails(email);

  // Filter by view
  switch (view) {
    case "inbox":
      emails = emails.filter(
        (e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
      );
      break;
    case "unread":
      emails = emails.filter(
        (e) =>
          !e.isRead && !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
      );
      break;
    case "starred":
      emails = emails.filter((e) => e.isStarred && !e.isTrashed);
      break;
    case "sent":
      emails = emails.filter((e) => e.isSent && !e.isTrashed);
      break;
    case "drafts":
      emails = emails.filter((e) => e.isDraft);
      break;
    case "archive":
      emails = emails.filter((e) => e.isArchived && !e.isTrashed);
      break;
    case "trash":
      emails = emails.filter((e) => e.isTrashed);
      break;
    case "all":
      break;
    default:
      // label: prefixed or raw label id
      const labelId = view.startsWith("label:")
        ? view.replace("label:", "")
        : view;
      emails = emails.filter(
        (e) => e.labelIds.includes(labelId) && !e.isTrashed,
      );
  }

  // Full-text search
  if (q) {
    const query = q.toLowerCase();
    emails = emails.filter(
      (e) =>
        e.subject.toLowerCase().includes(query) ||
        e.snippet.toLowerCase().includes(query) ||
        e.from.name.toLowerCase().includes(query) ||
        e.from.email.toLowerCase().includes(query) ||
        e.body.toLowerCase().includes(query),
    );
  }

  // Sort by date descending
  emails.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return emails;
});

// ─── Thread messages ─────────────────────────────────────────────────────────

export const getThreadMessages = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const threadId = getRouterParam(event, "threadId") as string;

  if (await isConnected(email)) {
    try {
      const clients = await getClients(email);
      const labelMap = new Map<string, string>();
      await Promise.all(
        clients.map(async ({ client }) => {
          try {
            const map = await fetchGmailLabelMap(client);
            for (const [id, name] of map) labelMap.set(id, name);
          } catch {}
        }),
      );

      // Search across all accounts for messages in this thread
      for (const { email, client } of clients) {
        try {
          const gmail = google.gmail({ version: "v1", auth: client });
          const threadRes = await (gmail.users.threads.get as any)({
            userId: "me",
            id: threadId,
            format: "full",
          });
          const messages = ((threadRes as any).data.messages || []).map(
            (m: any) =>
              gmailToEmailMessage(
                { ...m, _accountEmail: email },
                email,
                labelMap,
              ),
          );
          // Sort oldest first
          messages.sort(
            (a: any, b: any) =>
              new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          return messages;
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 404) continue;
          console.error("[getThreadMessages] Gmail error:", error.message);
          setResponseStatus(event, status || 502);
          return { error: error.message };
        }
      }
      if (clients.length > 0) {
        setResponseStatus(event, 404);
        return { error: "Thread not found in any account" };
      }
    } catch (error: any) {
      console.error("[getThreadMessages] error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Demo data: find all emails with matching threadId
  const emails = await readEmails(email);
  const threadMessages = emails
    .filter((e) => e.threadId === threadId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (threadMessages.length === 0) {
    setResponseStatus(event, 404);
    return { error: "Thread not found" };
  }

  return threadMessages;
});

// ─── Single email ─────────────────────────────────────────────────────────────

export const getEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  if (await isConnected(email)) {
    const clients = await getClients(email);
    for (const { email: acctEmail, client } of clients) {
      try {
        const gmail = google.gmail({ version: "v1", auth: client });
        const labelMap = await fetchGmailLabelMap(client);
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: getRouterParam(event, "id") as string,
          format: "full",
        });
        return gmailToEmailMessage((msg as any).data, acctEmail, labelMap);
      } catch (error: any) {
        const status =
          typeof error?.response?.status === "number"
            ? error.response.status
            : undefined;
        if (status === 404) continue;
        console.error("[getEmail] Gmail error:", error.message);
        setResponseStatus(event, status || 502);
        return { error: error.message };
      }
    }
    if (clients.length > 0) {
      setResponseStatus(event, 404);
      return { error: "Message not found in any account" };
    }
  }

  const emails = await readEmails(email);
  const found = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!found) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }
  return found;
});

// ─── Mark read ────────────────────────────────────────────────────────────────

export const markRead = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { isRead, accountEmail } = await readBody(event);

  if (await isConnected(email)) {
    try {
      // Route to specific account if provided, otherwise try first client
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const id = getRouterParam(event, "id") as string;
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: isRead
            ? { removeLabelIds: ["UNREAD"] }
            : { addLabelIds: ["UNREAD"] },
        });
        return { id, isRead };
      }
    } catch (error: any) {
      console.error("[markRead] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const idx = emails.findIndex((e) => e.id === getRouterParam(event, "id"));
  if (idx === -1) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  emails[idx] = { ...emails[idx], isRead };
  await writeEmails(email, emails);

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);

  return emails[idx];
});

// ─── Toggle star ──────────────────────────────────────────────────────────────

export const toggleStar = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { isStarred } = await readBody(event);
  const emails = await readEmails(email);
  const idx = emails.findIndex((e) => e.id === getRouterParam(event, "id"));
  if (idx === -1) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  emails[idx] = { ...emails[idx], isStarred };
  await writeEmails(email, emails);
  return emails[idx];
});

// ─── Archive ──────────────────────────────────────────────────────────────────

export const archiveEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    try {
      const client = await getClient(body?.accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const id = getRouterParam(event, "id") as string;
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        return { id, isArchived: true };
      }
    } catch (error: any) {
      console.error("[archiveEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Archive all messages in the thread, not just the one
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isArchived: true,
        labelIds: emails[i].labelIds.filter((l) => l !== "inbox"),
      };
    }
  }
  await writeEmails(email, emails);

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);

  return { id: getRouterParam(event, "id"), threadId, isArchived: true };
});

// ─── Unarchive ───────────────────────────────────────────────────────────────

export const unarchiveEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    try {
      const client = await getClient(body?.accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const id = getRouterParam(event, "id") as string;
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: { addLabelIds: ["INBOX"] },
        });
        return { id, isArchived: false };
      }
    } catch (error: any) {
      console.error("[unarchiveEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Unarchive all messages in the thread
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isArchived: false,
        labelIds: emails[i].labelIds.includes("inbox")
          ? emails[i].labelIds
          : ["inbox", ...emails[i].labelIds],
      };
    }
  }
  await writeEmails(email, emails);

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);

  return { id: getRouterParam(event, "id"), threadId, isArchived: false };
});

// ─── Trash ────────────────────────────────────────────────────────────────────

export const trashEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    try {
      const client = await getClient(body?.accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const id = getRouterParam(event, "id") as string;
        await gmail.users.messages.trash({
          userId: "me",
          id,
        });
        return { id, isTrashed: true };
      }
    } catch (error: any) {
      console.error("[trashEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Trash all messages in the thread
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = { ...emails[i], isTrashed: true, isArchived: false };
    }
  }
  await writeEmails(email, emails);

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);

  return { id: getRouterParam(event, "id"), threadId, isTrashed: true };
});

// ─── Report spam ──────────────────────────────────────────────────────────────

export const reportSpam = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { accountEmail } = await readBody(event);

  if (await isConnected(email)) {
    try {
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const id = getRouterParam(event, "id") as string;
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: {
            addLabelIds: ["SPAM"],
            removeLabelIds: ["INBOX"],
          },
        });
        return { id, spam: true };
      }
    } catch (error: any) {
      console.error("[reportSpam] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Local fallback: move to trash with a spam label
  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isTrashed: true,
        labelIds: [...emails[i].labelIds.filter((l) => l !== "inbox"), "spam"],
      };
    }
  }
  await writeEmails(email, emails);
  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);
  return { id: getRouterParam(event, "id"), threadId, spam: true };
});

// ─── Block sender ─────────────────────────────────────────────────────────────

async function readBlockedSenders(email: string): Promise<string[]> {
  const data = await getUserSetting(email, "blocked-senders");
  if (data && Array.isArray((data as any).senders)) {
    return (data as any).senders;
  }
  return [];
}

async function writeBlockedSenders(
  email: string,
  senders: string[],
): Promise<void> {
  await putUserSetting(email, "blocked-senders", { senders });
}

export const blockSender = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { senderEmail, accountEmail } = await readBody(event);

  if (!senderEmail) {
    setResponseStatus(event, 400);
    return { error: "Missing senderEmail" };
  }

  // If Gmail is connected, create a filter to auto-delete + report spam
  if (await isConnected(email)) {
    try {
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const id = getRouterParam(event, "id") as string;

        // Also report the current message as spam
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: {
            addLabelIds: ["SPAM"],
            removeLabelIds: ["INBOX"],
          },
        });

        // Create a filter to auto-delete future emails from this sender
        try {
          await (gmail.users.settings.filters.create as any)({
            userId: "me",
            requestBody: {
              criteria: { from: senderEmail },
              action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
            },
          });
        } catch (filterErr: any) {
          // Filter creation may fail (permissions), but spam report still worked
          console.error(
            "[blockSender] filter creation failed:",
            filterErr.message,
          );
        }

        return { id, blocked: senderEmail };
      }
    } catch (error: any) {
      console.error("[blockSender] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Local fallback: add to blocked list + trash the thread
  const blocked = await readBlockedSenders(email);
  if (!blocked.includes(senderEmail.toLowerCase())) {
    blocked.push(senderEmail.toLowerCase());
    await writeBlockedSenders(email, blocked);
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isTrashed: true,
        labelIds: [...emails[i].labelIds.filter((l) => l !== "inbox"), "spam"],
      };
    }
  }
  await writeEmails(email, emails);
  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);
  return { id: getRouterParam(event, "id"), threadId, blocked: senderEmail };
});

// ─── Mute thread ──────────────────────────────────────────────────────────────

async function readMutedThreads(email: string): Promise<string[]> {
  const data = await getUserSetting(email, "muted-threads");
  if (data && Array.isArray((data as any).threads)) {
    return (data as any).threads;
  }
  return [];
}

async function writeMutedThreads(
  email: string,
  threads: string[],
): Promise<void> {
  await putUserSetting(email, "muted-threads", { threads });
}

export const muteThread = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { accountEmail } = await readBody(event);

  if (await isConnected(email)) {
    try {
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const threadId = getRouterParam(event, "threadId") as string;
        // Gmail "mute" = remove from inbox; future replies also skip inbox
        await gmail.users.threads.modify({
          userId: "me",
          id: threadId,
          requestBody: {
            removeLabelIds: ["INBOX"],
          },
        });
        return { threadId, muted: true };
      }
    } catch (error: any) {
      console.error("[muteThread] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Local fallback: archive all messages in thread + record as muted
  const threadId = getRouterParam(event, "threadId") as string;
  const muted = await readMutedThreads(email);
  if (!muted.includes(threadId)) {
    muted.push(threadId);
    await writeMutedThreads(email, muted);
  }

  const emails = await readEmails(email);
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isArchived: true,
        labelIds: emails[i].labelIds.filter((l) => l !== "inbox"),
      };
    }
  }
  await writeEmails(email, emails);
  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels);
  return { threadId, muted: true };
});

// ─── Delete permanently ───────────────────────────────────────────────────────

export const deleteEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const emails = await readEmails(email);
  const filtered = emails.filter((e) => e.id !== getRouterParam(event, "id"));
  if (filtered.length === emails.length) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }
  await writeEmails(email, filtered);
  return { ok: true };
});

// ─── Send / compose ───────────────────────────────────────────────────────────

export const sendEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const settings = await readSettings(email);
  const { to, cc, bcc, subject, body, replyToId, accountEmail } =
    await readBody(event);

  if (!to || subject === undefined || body === undefined) {
    setResponseStatus(event, 400);
    return { error: "Missing required fields: to, subject, body" };
  }

  // If Gmail is connected, send via Gmail API
  if (await isConnected(email)) {
    try {
      const clients = await getClients(email);
      let selectedClient = clients[0]?.client;
      let selectedEmail = accountEmail || clients[0]?.email || "me";

      let threadId: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;

      if (replyToId) {
        // Find which account owns the original message and use that for the reply
        for (const { email, client } of clients) {
          try {
            const gmail = google.gmail({ version: "v1", auth: client });
            const original = await gmail.users.messages.get({
              userId: "me",
              id: replyToId,
              format: "metadata",
              metadataHeaders: ["Message-Id", "References"],
            });

            threadId = original.data.threadId ?? undefined;
            const headers = original.data.payload?.headers || [];
            inReplyTo =
              headers.find((h) => h.name === "Message-Id")?.value ?? undefined;
            const refs = headers.find((h) => h.name === "References")?.value;
            references = [refs, inReplyTo].filter(Boolean).join(" ");
            if (!accountEmail) {
              selectedClient = client;
              selectedEmail = email;
            }
            break;
          } catch (err: any) {
            if (err?.response?.status === 404) continue;
          }
        }
      }

      if (accountEmail) {
        const match = clients.find((c) => c.email === accountEmail);
        if (match) {
          selectedClient = match.client;
          selectedEmail = match.email;
        }
      }

      if (selectedClient) {
        const gmail = google.gmail({ version: "v1", auth: selectedClient });
        const raw = buildRawEmail({
          from: selectedEmail,
          to: to || "",
          cc: cc || "",
          bcc: bcc || "",
          subject: subject || "(no subject)",
          body: body || "",
          inReplyTo,
          references,
        });

        const requestBody: any = { raw };
        if (threadId) requestBody.threadId = threadId;

        const sent = await (gmail.users.messages.send as any)({
          userId: "me",
          requestBody,
        });

        setResponseStatus(event, 201);
        return {
          id: sent.data.id,
          threadId: sent.data.threadId,
          labelIds: sent.data.labelIds || ["SENT"],
        };
      }
    } catch (error: any) {
      console.error("[sendEmail] Gmail API error:", error.message);
      setResponseStatus(event, 500);
      return { error: "Failed to send email via Gmail" };
    }
  }

  // Local fallback: store as sent email
  const emails = await readEmails(email);

  const newEmail: EmailMessage = {
    id: `msg-${nanoid(8)}`,
    threadId: replyToId
      ? (emails.find((e) => e.id === replyToId)?.threadId ??
        `thread-${nanoid(8)}`)
      : `thread-${nanoid(8)}`,
    from: { name: settings.name, email: settings.email },
    to: (to as string).split(",").map((t: string) => {
      const trimmed = t.trim();
      return { name: trimmed, email: trimmed };
    }),
    ...(cc
      ? {
          cc: (cc as string)
            .split(",")
            .map((t: string) => ({ name: t.trim(), email: t.trim() })),
        }
      : {}),
    ...(bcc
      ? {
          bcc: (bcc as string)
            .split(",")
            .map((t: string) => ({ name: t.trim(), email: t.trim() })),
        }
      : {}),
    subject,
    snippet: body.slice(0, 120).replace(/\n/g, " "),
    body,
    date: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    isSent: true,
    isArchived: false,
    isTrashed: false,
    labelIds: ["sent"],
  };

  emails.push(newEmail);
  await writeEmails(email, emails);

  setResponseStatus(event, 201);
  return newEmail;
});

// ─── Save draft (persistent, Gmail-style) ─────────────────────────────────────

export const saveDraft = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const settings = await readSettings(email);
  const reqBody = await readBody(event);
  const { to, cc, bcc, subject, body, draftId, replyToId, replyToThreadId } =
    reqBody;

  // If Gmail is connected, create/update a Gmail draft
  if (await isConnected(email)) {
    try {
      const client = await getClient(reqBody?.accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        const draftFrom = reqBody?.accountEmail || "me";
        const raw = buildRawEmail({
          from: draftFrom,
          to: to || "",
          cc: cc || "",
          bcc: bcc || "",
          subject: subject || "(no subject)",
          body: body || "",
        });

        if (draftId) {
          // Update existing Gmail draft
          try {
            const updated = await (gmail.users.drafts.update as any)({
              userId: "me",
              id: draftId,
              requestBody: { message: { raw } },
            });
            return { draftId: (updated as any).data.id, updated: true };
          } catch {
            // Draft may have been deleted; create new
          }
        }
        // Create new Gmail draft
        const created = await (gmail.users.drafts.create as any)({
          userId: "me",
          requestBody: { message: { raw } },
        });
        return { draftId: (created as any).data.id, created: true };
      }
    } catch (error: any) {
      console.error("[saveDraft] Gmail error:", error.message);
      // Fall through to local storage
    }
  }

  // Local fallback: save as EmailMessage with isDraft=true
  const emails = await readEmails(email);
  const existingIdx = draftId
    ? emails.findIndex((e) => e.id === draftId && e.isDraft)
    : -1;

  const draftEmail: EmailMessage = {
    id: existingIdx >= 0 ? emails[existingIdx].id : `draft-${nanoid(8)}`,
    threadId:
      existingIdx >= 0
        ? emails[existingIdx].threadId
        : replyToId
          ? (emails.find((e) => e.id === replyToId)?.threadId ??
            `thread-${nanoid(8)}`)
          : `thread-${nanoid(8)}`,
    from: { name: settings.name, email: settings.email },
    to: to
      ? (to as string)
          .split(",")
          .filter((t: string) => t.trim())
          .map((t: string) => ({ name: t.trim(), email: t.trim() }))
      : [],
    ...(cc
      ? {
          cc: (cc as string)
            .split(",")
            .filter((t: string) => t.trim())
            .map((t: string) => ({ name: t.trim(), email: t.trim() })),
        }
      : {}),
    ...(bcc
      ? {
          bcc: (bcc as string)
            .split(",")
            .filter((t: string) => t.trim())
            .map((t: string) => ({ name: t.trim(), email: t.trim() })),
        }
      : {}),
    subject: subject || "(no subject)",
    snippet: (body || "").slice(0, 120).replace(/\n/g, " "),
    body: body || "",
    date: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    isDraft: true,
    isArchived: false,
    isTrashed: false,
    labelIds: ["drafts"],
    ...(replyToId ? { replyToId } : {}),
    ...(replyToThreadId ? { replyToThreadId } : {}),
  };

  if (existingIdx >= 0) {
    emails[existingIdx] = draftEmail;
  } else {
    emails.push(draftEmail);
  }
  await writeEmails(email, emails);

  return {
    draftId: draftEmail.id,
    [existingIdx >= 0 ? "updated" : "created"]: true,
  };
});

/** Build RFC 2822 raw email for Gmail API */
function buildRawEmail(opts: {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    opts.body,
  ];
  // Gmail API expects URL-safe base64
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Delete draft ─────────────────────────────────────────────────────────────

export const deleteDraft = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const id = getRouterParam(event, "id") as string;

  if (await isConnected(email)) {
    try {
      const body = await readBody(event).catch(() => ({}));
      const client = await getClient(body?.accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        try {
          await (gmail.users.drafts.delete as any)({
            userId: "me",
            id,
          });
        } catch {
          // Draft may not exist in Gmail
        }
        return { ok: true };
      }
    } catch (error: any) {
      console.error("[deleteDraft] Gmail error:", error.message);
    }
  }

  // Local fallback
  const emails = await readEmails(email);
  const filtered = emails.filter((e) => !(e.id === id && e.isDraft));
  if (filtered.length !== emails.length) {
    await writeEmails(email, filtered);
  }
  return { ok: true };
});

// ─── Contacts (extracted from email history) ─────────────────────────────────

export const listContacts = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  if (await isConnected(email)) {
    try {
      const clients = await getClients(email);
      const contactMap = new Map<
        string,
        { name: string; email: string; count: number }
      >();

      for (const { client } of clients) {
        const people = google.people({ version: "v1", auth: client });

        // Fetch saved contacts (People API connections)
        try {
          let nextPageToken: string | undefined;
          do {
            const resp = await people.people.connections.list({
              resourceName: "people/me",
              pageSize: 200,
              personFields: "names,emailAddresses",
              pageToken: nextPageToken,
            });
            for (const person of resp.data.connections || []) {
              const emails = person.emailAddresses || [];
              const name =
                person.names?.[0]?.displayName || emails[0]?.value || "";
              for (const em of emails) {
                if (!em.value) continue;
                const key = em.value.toLowerCase();
                const existing = contactMap.get(key);
                if (existing) {
                  existing.count += 5; // boost saved contacts
                  if (
                    name &&
                    name !== em.value &&
                    existing.name === existing.email
                  ) {
                    existing.name = name;
                  }
                } else {
                  contactMap.set(key, {
                    name: name || em.value,
                    email: em.value,
                    count: 5,
                  });
                }
              }
            }
            nextPageToken = resp.data.nextPageToken ?? undefined;
          } while (nextPageToken);
        } catch (err: any) {
          console.error("[listContacts] connections error:", err.message);
        }

        // Fetch "other contacts" (people you've interacted with but haven't saved)
        try {
          let nextPageToken: string | undefined;
          do {
            const resp = await people.otherContacts.list({
              pageSize: 200,
              readMask: "names,emailAddresses",
              pageToken: nextPageToken,
            });
            for (const person of resp.data.otherContacts || []) {
              const emails = person.emailAddresses || [];
              const name =
                person.names?.[0]?.displayName || emails[0]?.value || "";
              for (const em of emails) {
                if (!em.value) continue;
                const key = em.value.toLowerCase();
                if (!contactMap.has(key)) {
                  contactMap.set(key, {
                    name: name || em.value,
                    email: em.value,
                    count: 1,
                  });
                }
              }
            }
            nextPageToken = resp.data.nextPageToken ?? undefined;
          } while (nextPageToken);
        } catch (err: any) {
          console.error("[listContacts] otherContacts error:", err.message);
        }
      }

      // If People API returned nothing (e.g. missing scopes), extract from Gmail
      if (contactMap.size === 0) {
        try {
          const { messages } = await listGmailMessages("", 100, email);
          for (const msg of messages) {
            const headers = msg.payload?.headers || [];
            for (const field of ["From", "To", "Cc", "Bcc"]) {
              const raw =
                headers.find(
                  (h: any) => h.name?.toLowerCase() === field.toLowerCase(),
                )?.value || "";
              if (!raw) continue;
              for (const part of raw.split(",")) {
                const trimmed = part.trim();
                if (!trimmed) continue;
                const match = trimmed.match(/^(.+?)\s*<(.+?)>$/);
                const name = match
                  ? match[1].trim().replace(/^"|"$/g, "")
                  : trimmed;
                const addr = match ? match[2].trim() : trimmed;
                if (!addr || !addr.includes("@")) continue;
                const key = addr.toLowerCase();
                const existing = contactMap.get(key);
                if (existing) {
                  existing.count++;
                  if (
                    name &&
                    name !== addr &&
                    existing.name === existing.email
                  ) {
                    existing.name = name;
                  }
                } else {
                  contactMap.set(key, {
                    name: name || addr,
                    email: addr,
                    count: 1,
                  });
                }
              }
            }
          }
        } catch (err: any) {
          console.error("[listContacts] Gmail fallback error:", err.message);
        }
      }

      const contacts = Array.from(contactMap.values()).sort(
        (a, b) => b.count - a.count,
      );
      return contacts;
    } catch (error: any) {
      console.error("[listContacts] error:", error.message);
      // Fall through to demo data
    }
  }

  const emails = await readEmails(email);
  const contactMap = new Map<
    string,
    { name: string; email: string; count: number }
  >();

  for (const msg of emails) {
    const addresses = [
      msg.from,
      ...(msg.to || []),
      ...(msg.cc || []),
      ...(msg.bcc || []),
    ];
    for (const addr of addresses) {
      if (!addr?.email) continue;
      const key = addr.email.toLowerCase();
      const existing = contactMap.get(key);
      if (existing) {
        existing.count++;
        if (
          addr.name &&
          addr.name !== addr.email &&
          (!existing.name || existing.name === existing.email)
        ) {
          existing.name = addr.name;
        }
      } else {
        contactMap.set(key, {
          name: addr.name || addr.email,
          email: addr.email,
          count: 1,
        });
      }
    }
  }

  const contacts = Array.from(contactMap.values()).sort(
    (a, b) => b.count - a.count,
  );
  return contacts;
});

// ─── Labels ───────────────────────────────────────────────────────────────────

export const listLabels = defineEventHandler(async (_event: H3Event) => {
  const email = await userEmail(_event);
  if (await isConnected(email)) {
    try {
      const clients = await getClients(email);
      // Deduplicate by derived short-name id (not Gmail label ID)
      const labelMap = new Map<
        string,
        { id: string; name: string; type: "system" | "user" }
      >();
      // Fetch labels from each account sequentially to avoid race conditions on the shared map
      for (const { client } of clients) {
        try {
          const map = await fetchGmailLabelMap(client);
          for (const [gmailId, name] of map) {
            const isSystem = !gmailId.startsWith("Label_");
            // Use the full label name (preserving hierarchy) as the id,
            // but display the short name (last segment, underscores -> spaces)
            const fullId = name.toLowerCase().replace(/_/g, " ");
            let shortName = name;
            const lastSlash = shortName.lastIndexOf("/");
            if (lastSlash >= 0) shortName = shortName.slice(lastSlash + 1);
            shortName = shortName.replace(/_/g, " ");
            if (!labelMap.has(fullId)) {
              labelMap.set(fullId, {
                id: fullId,
                name: shortName,
                type: isSystem ? ("system" as const) : ("user" as const),
              });
            }
          }
        } catch {}
      }
      const labels: Label[] = Array.from(labelMap.values()).map((l) => ({
        ...l,
        unreadCount: 0,
      }));
      return labels;
    } catch {}
  }
  return readLabels(email);
});

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  return readSettings(email);
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const current = await readSettings(email);
  const body = await readBody(event);
  const updated = { ...current, ...body };
  await putUserSetting(
    email,
    "mail-settings",
    updated as Record<string, unknown>,
  );
  return updated;
});

// ─── Calendar RSVP ───────────────────────────────────────────────────────────

export const calendarRsvp = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { eventId, calendarId, response, accountEmail } = (await readBody(
    event,
  )) as {
    eventId: string;
    calendarId?: string;
    response: "accepted" | "declined" | "tentative";
    accountEmail?: string;
  };

  if (!eventId || !response) {
    setResponseStatus(event, 400);
    return { error: "eventId and response are required" };
  }

  if (!(await isConnected(email))) {
    setResponseStatus(event, 401);
    return { error: "No Google account connected" };
  }

  try {
    const client = await getClient(accountEmail);
    if (!client) {
      setResponseStatus(event, 401);
      return { error: "Google account not found" };
    }

    const calendar = google.calendar({ version: "v3", auth: client });
    const calId = calendarId || "primary";

    // Get the event first to preserve existing data
    const eventRes = await calendar.events.get({
      calendarId: calId,
      eventId,
    });

    const calEvent = eventRes.data;
    if (!calEvent) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    // Find the current user's attendee entry and update their response
    const settings = await readSettings(email);
    const myEmail = settings.email?.toLowerCase();
    const attendees = calEvent.attendees || [];
    let found = false;
    for (const attendee of attendees) {
      if (attendee.email?.toLowerCase() === myEmail || attendee.self) {
        attendee.responseStatus = response;
        found = true;
        break;
      }
    }

    if (!found) {
      // Add self as attendee with the response
      attendees.push({
        email: myEmail,
        responseStatus: response,
        self: true,
      });
    }

    await calendar.events.patch({
      calendarId: calId,
      eventId,
      sendUpdates: "all",
      requestBody: { attendees },
    });

    return { ok: true, response };
  } catch (error: any) {
    console.error("[calendarRsvp] error:", error.message);
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
