/**
 * List emails with filtering and search.
 *
 * Fetches directly from Gmail API. Falls back to local store if no account is connected.
 *
 * Usage:
 *   pnpm script list-emails
 *   pnpm script list-emails --view=inbox
 *   pnpm script list-emails --view=unread
 *   pnpm script list-emails --view=starred --q=meeting
 *   pnpm script list-emails --view=inbox --fields=from,subject,date,snippet
 *   pnpm script list-emails --compact
 *
 * Options:
 *   --view     inbox (default), unread, starred, sent, drafts, archive, trash, all
 *   --q        Full-text search across subject, body, sender
 *   --limit    Max number of emails to return (default: 50)
 *   --fields   Comma-separated fields to include (default: all)
 *   --compact  Output compact summary (id, from, subject, date, snippet)
 *   --grep     Filter output by keyword (built-in helper)
 */

import { parseArgs, output } from "./helpers.js";
import { getSetting } from "@agent-native/core/settings";
import {
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  isConnected,
} from "../server/lib/google-auth.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "List emails from a view (inbox, unread, starred, sent, drafts, archive, trash) with optional search query.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description: "View to list (default: inbox)",
        enum: [
          "inbox",
          "unread",
          "starred",
          "sent",
          "drafts",
          "archive",
          "trash",
          "all",
        ],
      },
      q: { type: "string", description: "Full-text search query" },
      limit: {
        type: "string",
        description: "Max number of emails to return (default: 50)",
      },
      compact: {
        type: "string",
        description: "Set to 'true' for compact output",
        enum: ["true", "false"],
      },
    },
  },
};

async function readLocalEmails(): Promise<any[]> {
  const data = await getSetting("local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

export async function run(args: Record<string, string>): Promise<string> {
  const view = args.view ?? "inbox";
  const query = args.q;
  const limit = args.limit ? parseInt(args.limit, 10) : 50;
  const compact = args.compact !== "false";

  if (await isConnected()) {
    const clients = await getClients();
    const labelMap = new Map<string, string>();
    await Promise.all(
      clients.map(async ({ accessToken }) => {
        try {
          const map = await fetchGmailLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    const viewPrefix = VIEW_QUERIES[view] ?? `label:${view}`;
    const gmailQuery = [viewPrefix, query].filter(Boolean).join(" ");
    const { messages, errors } = await listGmailMessages(
      gmailQuery || "in:inbox",
      limit,
    );

    if (errors.length > 0 && messages.length === 0) {
      return `Error: ${errors.map((e) => `${e.email}: ${e.error}`).join("; ")}`;
    }

    const emails = messages
      .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
      .sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      )
      .slice(0, limit);

    return JSON.stringify(compact ? toCompact(emails) : emails, null, 2);
  }

  // Fallback: local store
  let emails = await readLocalEmails();

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
  }

  if (query) {
    const q = query.toLowerCase();
    emails = emails.filter(
      (e) =>
        e.subject?.toLowerCase().includes(q) ||
        e.snippet?.toLowerCase().includes(q) ||
        e.body?.toLowerCase().includes(q) ||
        e.from?.name?.toLowerCase().includes(q) ||
        e.from?.email?.toLowerCase().includes(q),
    );
  }

  return JSON.stringify(
    compact ? toCompact(emails.slice(0, limit)) : emails.slice(0, limit),
    null,
    2,
  );
}

const VIEW_QUERIES: Record<string, string> = {
  inbox: "in:inbox",
  unread: "is:unread in:inbox",
  starred: "is:starred",
  sent: "in:sent",
  drafts: "in:drafts",
  archive: "-in:inbox -in:sent -in:drafts -in:trash",
  trash: "in:trash",
  all: "",
};

function toCompact(emails: any[]): any[] {
  return emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from?.name
      ? `${e.from.name} <${e.from.email}>`
      : (e.from?.email ?? e.from),
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
    isStarred: e.isStarred,
  }));
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const view = args.view ?? "inbox";
  const query = args.q;
  const limit = args.limit ? parseInt(args.limit, 10) : 50;
  const compact = args.compact === "true";

  if (await isConnected()) {
    const clients = await getClients();
    const labelMap = new Map<string, string>();
    await Promise.all(
      clients.map(async ({ accessToken }) => {
        try {
          const map = await fetchGmailLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    const viewPrefix = VIEW_QUERIES[view] ?? `label:${view}`;
    const gmailQuery = [viewPrefix, query].filter(Boolean).join(" ");

    const { messages, errors } = await listGmailMessages(
      gmailQuery || "in:inbox",
      limit,
    );

    if (errors.length > 0 && messages.length === 0) {
      console.error(
        `Gmail error: ${errors.map((e) => `${e.email}: ${e.error}`).join("; ")}`,
      );
      process.exit(1);
    }

    const emails = messages
      .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
      .sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      )
      .slice(0, limit);

    console.error(
      `Found ${emails.length} email(s) in "${view}" (source: gmail)`,
    );
    output(compact ? toCompact(emails) : emails);
    return;
  }

  // Fallback: local store
  let emails = await readLocalEmails();

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
  }

  if (query) {
    const q = query.toLowerCase();
    emails = emails.filter(
      (e) =>
        e.subject?.toLowerCase().includes(q) ||
        e.snippet?.toLowerCase().includes(q) ||
        e.body?.toLowerCase().includes(q) ||
        e.from?.name?.toLowerCase().includes(q) ||
        e.from?.email?.toLowerCase().includes(q),
    );
  }

  emails = emails
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  console.error(`Found ${emails.length} email(s) in "${view}" (source: local)`);
  output(compact ? toCompact(emails) : emails);
}
