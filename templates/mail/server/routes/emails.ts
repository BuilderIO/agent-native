import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { EmailMessage, Label, UserSettings } from "@shared/types.js";
import { google } from "googleapis";
import {
  isConnected,
  getClient,
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
} from "../lib/google-auth.js";

const DATA_DIR = path.join(process.cwd(), "data");
const EMAILS_FILE = path.join(DATA_DIR, "emails.json");
const LABELS_FILE = path.join(DATA_DIR, "labels.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readEmails(): EmailMessage[] {
  try {
    return JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeEmails(emails: EmailMessage[]) {
  fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));
}

function readLabels(): Label[] {
  try {
    return JSON.parse(fs.readFileSync(LABELS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeLabels(labels: Label[]) {
  fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2));
}

function readSettings(): UserSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    // Copy defaults on first run
    const defaultsFile = path.join(DATA_DIR, "settings.defaults.json");
    try {
      const defaults = fs.readFileSync(defaultsFile, "utf-8");
      fs.writeFileSync(SETTINGS_FILE, defaults);
      return JSON.parse(defaults);
    } catch {
      return {
        name: "Alex Johnson",
        email: "me@example.com",
        theme: "dark",
        density: "comfortable",
        previewPane: "right",
        sendAndArchive: false,
        undoSendDelay: 5,
      };
    }
  }
}

function recomputeUnreadCounts(
  emails: EmailMessage[],
  labels: Label[],
): Label[] {
  return labels.map((label) => {
    const unread = emails.filter(
      (e) =>
        !e.isRead &&
        !e.isArchived &&
        !e.isTrashed &&
        e.labelIds.includes(label.id),
    ).length;
    return { ...label, unreadCount: unread };
  });
}

// ─── Email list ───────────────────────────────────────────────────────────────

export async function listEmails(req: Request, res: Response): Promise<void> {
  const { view = "inbox", q } = req.query as { view?: string; q?: string };

  // If Google is connected, fetch from Gmail directly (skip demo data)
  if (isConnected()) {
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
      const clients = await getClients();
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
      const { messages, errors } = await listGmailMessages(searchQuery);
      if (messages.length === 0 && errors.length > 0) {
        // All accounts failed — surface as error
        res.status(502).json({
          error: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
        });
        return;
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
        res.setHeader("X-Account-Errors", JSON.stringify(errors));
      }
      res.json(emails);
      return;
    } catch (error: any) {
      console.error("[listEmails] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  let emails = readEmails();

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

  res.json(emails);
}

// ─── Thread messages ─────────────────────────────────────────────────────────

export async function getThreadMessages(
  req: Request,
  res: Response,
): Promise<void> {
  const { threadId } = req.params;

  if (isConnected()) {
    try {
      const clients = await getClients();
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
          res.json(messages);
          return;
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 404) continue;
          console.error("[getThreadMessages] Gmail error:", error.message);
          res.status(status || 502).json({ error: error.message });
          return;
        }
      }
      if (clients.length > 0) {
        res.status(404).json({ error: "Thread not found in any account" });
        return;
      }
    } catch (error: any) {
      console.error("[getThreadMessages] error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  // Demo data: find all emails with matching threadId
  const emails = readEmails();
  const threadMessages = emails
    .filter((e) => e.threadId === threadId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (threadMessages.length === 0) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  res.json(threadMessages);
}

// ─── Single email ─────────────────────────────────────────────────────────────

export async function getEmail(req: Request, res: Response): Promise<void> {
  if (isConnected()) {
    const clients = await getClients();
    for (const { email, client } of clients) {
      try {
        const gmail = google.gmail({ version: "v1", auth: client });
        const labelMap = await fetchGmailLabelMap(client);
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: req.params.id as string,
          format: "full",
        });
        res.json(gmailToEmailMessage((msg as any).data, email, labelMap));
        return;
      } catch (error: any) {
        const status =
          typeof error?.response?.status === "number"
            ? error.response.status
            : undefined;
        if (status === 404) continue;
        console.error("[getEmail] Gmail error:", error.message);
        res.status(status || 502).json({ error: error.message });
        return;
      }
    }
    if (clients.length > 0) {
      res.status(404).json({ error: "Message not found in any account" });
      return;
    }
  }

  const emails = readEmails();
  const email = emails.find((e) => e.id === req.params.id);
  if (!email) {
    res.status(404).json({ error: "Email not found" });
    return;
  }
  res.json(email);
}

// ─── Mark read ────────────────────────────────────────────────────────────────

export async function markRead(req: Request, res: Response): Promise<void> {
  const { isRead, accountEmail } = req.body;

  if (isConnected()) {
    try {
      // Route to specific account if provided, otherwise try first client
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        await gmail.users.messages.modify({
          userId: "me",
          id: req.params.id as string,
          requestBody: isRead
            ? { removeLabelIds: ["UNREAD"] }
            : { addLabelIds: ["UNREAD"] },
        });
        res.json({ id: req.params.id, isRead });
        return;
      }
    } catch (error: any) {
      console.error("[markRead] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  const emails = readEmails();
  const idx = emails.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  emails[idx] = { ...emails[idx], isRead };
  writeEmails(emails);

  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);

  res.json(emails[idx]);
}

// ─── Toggle star ──────────────────────────────────────────────────────────────

export function toggleStar(req: Request, res: Response) {
  const { isStarred } = req.body;
  const emails = readEmails();
  const idx = emails.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Email not found" });

  emails[idx] = { ...emails[idx], isStarred };
  writeEmails(emails);
  res.json(emails[idx]);
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveEmail(req: Request, res: Response): Promise<void> {
  if (isConnected()) {
    try {
      const client = await getClient();
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        await gmail.users.messages.modify({
          userId: "me",
          id: req.params.id as string,
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        res.json({ id: req.params.id, isArchived: true });
        return;
      }
    } catch (error: any) {
      console.error("[archiveEmail] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  const emails = readEmails();
  const target = emails.find((e) => e.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "Email not found" });
    return;
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
  writeEmails(emails);

  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);

  res.json({ id: req.params.id, threadId, isArchived: true });
}

// ─── Unarchive ───────────────────────────────────────────────────────────────

export async function unarchiveEmail(
  req: Request,
  res: Response,
): Promise<void> {
  if (isConnected()) {
    try {
      const client = await getClient();
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        await gmail.users.messages.modify({
          userId: "me",
          id: req.params.id as string,
          requestBody: { addLabelIds: ["INBOX"] },
        });
        res.json({ id: req.params.id, isArchived: false });
        return;
      }
    } catch (error: any) {
      console.error("[unarchiveEmail] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  const emails = readEmails();
  const target = emails.find((e) => e.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "Email not found" });
    return;
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
  writeEmails(emails);

  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);

  res.json({ id: req.params.id, threadId, isArchived: false });
}

// ─── Trash ────────────────────────────────────────────────────────────────────

export async function trashEmail(req: Request, res: Response): Promise<void> {
  if (isConnected()) {
    try {
      const client = await getClient();
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        await gmail.users.messages.trash({
          userId: "me",
          id: req.params.id as string,
        });
        res.json({ id: req.params.id, isTrashed: true });
        return;
      }
    } catch (error: any) {
      console.error("[trashEmail] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  const emails = readEmails();
  const target = emails.find((e) => e.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  // Trash all messages in the thread
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = { ...emails[i], isTrashed: true, isArchived: false };
    }
  }
  writeEmails(emails);

  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);

  res.json({ id: req.params.id, threadId, isTrashed: true });
}

// ─── Report spam ──────────────────────────────────────────────────────────────

export async function reportSpam(req: Request, res: Response): Promise<void> {
  const { accountEmail } = req.body;

  if (isConnected()) {
    try {
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        await gmail.users.messages.modify({
          userId: "me",
          id: req.params.id as string,
          requestBody: {
            addLabelIds: ["SPAM"],
            removeLabelIds: ["INBOX"],
          },
        });
        res.json({ id: req.params.id, spam: true });
        return;
      }
    } catch (error: any) {
      console.error("[reportSpam] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  // Local fallback: move to trash with a spam label
  const emails = readEmails();
  const target = emails.find((e) => e.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "Email not found" });
    return;
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
  writeEmails(emails);
  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);
  res.json({ id: req.params.id, threadId, spam: true });
}

// ─── Block sender ─────────────────────────────────────────────────────────────

const BLOCKED_SENDERS_FILE = path.join(DATA_DIR, "blocked-senders.json");

function readBlockedSenders(): string[] {
  try {
    return JSON.parse(fs.readFileSync(BLOCKED_SENDERS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeBlockedSenders(senders: string[]) {
  fs.writeFileSync(BLOCKED_SENDERS_FILE, JSON.stringify(senders, null, 2));
}

export async function blockSender(req: Request, res: Response): Promise<void> {
  const { senderEmail, accountEmail } = req.body;

  if (!senderEmail) {
    res.status(400).json({ error: "Missing senderEmail" });
    return;
  }

  // If Gmail is connected, create a filter to auto-delete + report spam
  if (isConnected()) {
    try {
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });

        // Also report the current message as spam
        await gmail.users.messages.modify({
          userId: "me",
          id: req.params.id as string,
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

        res.json({ id: req.params.id, blocked: senderEmail });
        return;
      }
    } catch (error: any) {
      console.error("[blockSender] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  // Local fallback: add to blocked list + trash the thread
  const blocked = readBlockedSenders();
  if (!blocked.includes(senderEmail.toLowerCase())) {
    blocked.push(senderEmail.toLowerCase());
    writeBlockedSenders(blocked);
  }

  const emails = readEmails();
  const target = emails.find((e) => e.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "Email not found" });
    return;
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
  writeEmails(emails);
  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);
  res.json({ id: req.params.id, threadId, blocked: senderEmail });
}

// ─── Mute thread ──────────────────────────────────────────────────────────────

const MUTED_THREADS_FILE = path.join(DATA_DIR, "muted-threads.json");

function readMutedThreads(): string[] {
  try {
    return JSON.parse(fs.readFileSync(MUTED_THREADS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeMutedThreads(threads: string[]) {
  fs.writeFileSync(MUTED_THREADS_FILE, JSON.stringify(threads, null, 2));
}

export async function muteThread(req: Request, res: Response): Promise<void> {
  const { accountEmail } = req.body;

  if (isConnected()) {
    try {
      const client = await getClient(accountEmail);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        // Gmail "mute" = remove from inbox; future replies also skip inbox
        await gmail.users.threads.modify({
          userId: "me",
          id: req.params.threadId as string,
          requestBody: {
            removeLabelIds: ["INBOX"],
          },
        });
        res.json({ threadId: req.params.threadId, muted: true });
        return;
      }
    } catch (error: any) {
      console.error("[muteThread] Gmail error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
  }

  // Local fallback: archive all messages in thread + record as muted
  const threadId = req.params.threadId as string;
  const muted = readMutedThreads();
  if (!muted.includes(threadId)) {
    muted.push(threadId);
    writeMutedThreads(muted);
  }

  const emails = readEmails();
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
  writeEmails(emails);
  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);
  res.json({ threadId, muted: true });
}

// ─── Delete permanently ───────────────────────────────────────────────────────

export function deleteEmail(req: Request, res: Response) {
  const emails = readEmails();
  const filtered = emails.filter((e) => e.id !== req.params.id);
  if (filtered.length === emails.length)
    return res.status(404).json({ error: "Email not found" });
  writeEmails(filtered);
  res.json({ ok: true });
}

// ─── Send / compose ───────────────────────────────────────────────────────────

export function sendEmail(req: Request, res: Response) {
  const settings = readSettings();
  const { to, cc, bcc, subject, body, replyToId } = req.body;

  if (!to || !subject === undefined || body === undefined) {
    return res
      .status(400)
      .json({ error: "Missing required fields: to, subject, body" });
  }

  const emails = readEmails();

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
  writeEmails(emails);

  res.status(201).json(newEmail);
}

// ─── Contacts (extracted from email history) ─────────────────────────────────

export async function listContacts(
  _req: Request,
  res: Response,
): Promise<void> {
  if (isConnected()) {
    try {
      const clients = await getClients();
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
          const { messages } = await listGmailMessages("", 100);
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
      res.json(contacts);
      return;
    } catch (error: any) {
      console.error("[listContacts] error:", error.message);
      // Fall through to demo data
    }
  }

  const emails = readEmails();
  const contactMap = new Map<
    string,
    { name: string; email: string; count: number }
  >();

  for (const email of emails) {
    const addresses = [
      email.from,
      ...(email.to || []),
      ...(email.cc || []),
      ...(email.bcc || []),
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
  res.json(contacts);
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export async function listLabels(_req: Request, res: Response) {
  if (isConnected()) {
    try {
      const clients = await getClients();
      const labelMap = new Map<
        string,
        { id: string; name: string; type: "system" | "user" }
      >();
      await Promise.all(
        clients.map(async ({ client }) => {
          try {
            const map = await fetchGmailLabelMap(client);
            for (const [id, name] of map) {
              const isSystem = !id.startsWith("Label_");
              if (!labelMap.has(id)) {
                // Derive short name: last segment of nested labels, underscores → spaces
                let shortName = name;
                const lastSlash = shortName.lastIndexOf("/");
                if (lastSlash >= 0) shortName = shortName.slice(lastSlash + 1);
                shortName = shortName.replace(/_/g, " ");
                labelMap.set(id, {
                  id: shortName.toLowerCase(),
                  name: shortName,
                  type: isSystem ? ("system" as const) : ("user" as const),
                });
              }
            }
          } catch {}
        }),
      );
      const labels: Label[] = Array.from(labelMap.values()).map((l) => ({
        ...l,
        unreadCount: 0,
      }));
      res.json(labels);
      return;
    } catch {}
  }
  res.json(readLabels());
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(_req: Request, res: Response) {
  res.json(readSettings());
}

export function updateSettings(req: Request, res: Response) {
  const current = readSettings();
  const updated = { ...current, ...req.body };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  res.json(updated);
}
