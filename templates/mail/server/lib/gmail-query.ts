import {
  isInboxScopedAppLabel,
  mailLabelsInclude,
} from "@shared/gmail-labels.js";
import { isSelfAddressedThread } from "@shared/self-notes.js";
import type { EmailMessage } from "@shared/types.js";

export const VIEW_QUERIES: Record<string, string> = {
  inbox: "in:inbox -in:sent",
  unread: "is:unread in:inbox -in:sent",
  starred: "is:starred",
  sent: "in:sent",
  drafts: "in:drafts",
  archive: "-in:inbox -in:sent -in:drafts -in:trash",
  trash: "in:trash",
  all: "",
};

const BARE_EMAIL_ADDRESS_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function gmailSearchClause(q: string | undefined): string {
  const trimmed = q?.trim();
  if (!trimmed) return "";
  if (!BARE_EMAIL_ADDRESS_RE.test(trimmed)) return trimmed;

  return `{from:${trimmed} to:${trimmed} cc:${trimmed} bcc:${trimmed} deliveredto:${trimmed} ${trimmed}}`;
}

export function gmailLabelSearchClause(label: string): string {
  const value = label.trim().replace(/\s+/g, "-").replace(/"/g, '\\"');
  if (!value) return "";
  return /[/"()]/.test(value) ? `label:"${value}"` : `label:${value}`;
}

export function gmailAppLabelSearchClause(label: string): string {
  const id = label.toLowerCase();
  const categoryIds = new Set([
    "personal",
    "social",
    "updates",
    "promotions",
    "forums",
  ]);
  if (categoryIds.has(id)) {
    return `category:${id === "personal" ? "primary" : id}`;
  }
  if (id === "important") return "is:important";
  if (id === "note-to-self") return "from:me {to:me cc:me bcc:me}";
  return gmailLabelSearchClause(label);
}

function viewSearchClauseForLabelTab(view: string, label: string): string {
  if (view === "all") return "";
  if (!isInboxScopedAppLabel(label)) {
    return VIEW_QUERIES[view] ?? "";
  }
  if (view === "inbox" && label.toLowerCase() === "note-to-self") {
    // Self-sent notes can carry both INBOX and SENT. Keep them in this inbox
    // tab while still excluding sent-only/archive-only results.
    return "in:inbox";
  }
  return VIEW_QUERIES[view] ?? `label:${view}`;
}

export function buildGmailEmailSearchQuery({
  view = "inbox",
  q,
  label,
}: {
  view?: string;
  q?: string;
  label?: string;
}): string {
  const searchClause = gmailSearchClause(q);

  if (label) {
    const labelClause = gmailAppLabelSearchClause(label);
    const viewClause = viewSearchClauseForLabelTab(view, label);
    return [viewClause, labelClause, searchClause].filter(Boolean).join(" ");
  }

  const viewQuery = VIEW_QUERIES[view] ?? `label:${view}`;
  return [viewQuery, searchClause].filter(Boolean).join(" ");
}

function threadKey(message: EmailMessage): string {
  return `${message.accountEmail ?? ""}:${message.threadId || message.id}`;
}

function qualifiesForInboxThread(
  message: EmailMessage,
  view: string,
  label?: string,
): boolean {
  const allowSentToSelf = label?.toLowerCase() === "note-to-self";
  return (
    mailLabelsInclude(message.labelIds, "inbox") &&
    !message.isDraft &&
    !message.isTrashed &&
    (allowSentToSelf || !message.isSent) &&
    (view !== "unread" || !message.isRead)
  );
}

function noteToSelfThreadKeys(
  emails: EmailMessage[],
  connectedEmails: ReadonlySet<string> | undefined,
): Set<string> {
  if (!connectedEmails || connectedEmails.size === 0) return new Set();

  const threads = new Map<string, EmailMessage[]>();
  for (const message of emails) {
    const key = threadKey(message);
    const thread = threads.get(key) ?? [];
    thread.push(message);
    threads.set(key, thread);
  }

  const keys = new Set<string>();
  for (const [key, thread] of threads) {
    if (isSelfAddressedThread(thread, connectedEmails)) {
      keys.add(key);
    }
  }
  return keys;
}

function qualifiesForThreadPreview(
  message: EmailMessage,
  label?: string,
): boolean {
  const isCustomLabel = label && !isInboxScopedAppLabel(label);
  return (
    !message.isDraft &&
    !message.isTrashed &&
    (!isCustomLabel || !message.isSent)
  );
}

export function filterInboxScopedThreadMessages(
  emails: EmailMessage[],
  view: string,
  label?: string,
  connectedEmails?: ReadonlySet<string>,
): EmailMessage[] {
  if (view !== "inbox" && view !== "unread") return emails;

  const includedThreads = new Set<string>();
  const isNoteToSelf = label?.toLowerCase() === "note-to-self";
  const selfNoteThreads = isNoteToSelf
    ? noteToSelfThreadKeys(emails, connectedEmails)
    : undefined;
  for (const message of emails) {
    const key = threadKey(message);
    if (
      qualifiesForInboxThread(message, view, label) &&
      (!isNoteToSelf || selfNoteThreads?.has(key))
    ) {
      includedThreads.add(key);
    }
  }

  return emails.filter(
    (message) =>
      includedThreads.has(threadKey(message)) &&
      qualifiesForThreadPreview(message, label),
  );
}
