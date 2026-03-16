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
        starred: "is:starred",
        sent: "in:sent",
        drafts: "in:drafts",
        archive: "-in:inbox -in:sent -in:drafts -in:trash",
        trash: "in:trash",
        all: "",
      };
      let searchQuery = gmailQuery[view] ?? `label:${view}`;
      if (q) searchQuery += ` ${q}`;

      const { messages, errors } = await listGmailMessages(searchQuery);
      if (messages.length === 0 && errors.length > 0) {
        // All accounts failed — surface as error
        res
          .status(502)
          .json({
            error: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
          });
        return;
      }
      const emails = messages.map((m) => gmailToEmailMessage(m));
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

// ─── Single email ─────────────────────────────────────────────────────────────

export async function getEmail(req: Request, res: Response): Promise<void> {
  if (isConnected()) {
    const clients = await getClients();
    for (const { email, client } of clients) {
      try {
        const gmail = google.gmail({ version: "v1", auth: client });
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: req.params.id as string,
          format: "full",
        });
        res.json(gmailToEmailMessage((msg as any).data, email));
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

export function archiveEmail(req: Request, res: Response) {
  const emails = readEmails();
  const idx = emails.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Email not found" });

  emails[idx] = {
    ...emails[idx],
    isArchived: true,
    labelIds: emails[idx].labelIds.filter((l) => l !== "inbox"),
  };
  writeEmails(emails);

  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);

  res.json(emails[idx]);
}

// ─── Trash ────────────────────────────────────────────────────────────────────

export function trashEmail(req: Request, res: Response) {
  const emails = readEmails();
  const idx = emails.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Email not found" });

  emails[idx] = { ...emails[idx], isTrashed: true, isArchived: false };
  writeEmails(emails);

  const labels = recomputeUnreadCounts(emails, readLabels());
  writeLabels(labels);

  res.json(emails[idx]);
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

// ─── Labels ───────────────────────────────────────────────────────────────────

export function listLabels(_req: Request, res: Response) {
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
