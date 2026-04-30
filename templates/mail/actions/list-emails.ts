import { defineAction } from "@agent-native/core";
import { getUserSetting } from "@agent-native/core/settings";
import { getRequestUserEmail } from "@agent-native/core/server";
import {
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  isConnected,
} from "../server/lib/google-auth.js";
import { z } from "zod";

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
    accountEmail: e.accountEmail,
  }));
}

async function readLocalEmails(ownerEmail: string): Promise<any[]> {
  const data = await getUserSetting(ownerEmail, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

export default defineAction({
  description:
    "List emails from a view (inbox, unread, starred, sent, drafts, archive, trash) with optional search query.",
  schema: z.object({
    view: z
      .enum([
        "inbox",
        "unread",
        "starred",
        "sent",
        "drafts",
        "archive",
        "trash",
        "all",
      ])
      .optional()
      .describe("View to list (default: inbox)"),
    q: z.string().optional().describe("Full-text search query"),
    account: z
      .string()
      .optional()
      .describe(
        "Filter to a specific account email address. By default searches all connected accounts.",
      ),
    limit: z.coerce
      .number()
      .optional()
      .describe("Max number of emails to return (default: 50)"),
    compact: z.coerce
      .boolean()
      .optional()
      .describe("Set to true for compact output"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const view = args.view ?? "inbox";
    const query = args.q;
    const limit = args.limit ?? 50;
    const compact = args.compact !== false;
    const accountFilter = args.account?.toLowerCase();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (await isConnected(ownerEmail)) {
      const clients = await getClients(ownerEmail);
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
        ownerEmail,
      );

      if (errors.length > 0 && messages.length === 0) {
        return `Error: ${errors.map((e) => `${e.email}: ${e.error}`).join("; ")}`;
      }

      let emails = messages
        .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
        .sort(
          (a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        );

      if (accountFilter) {
        emails = emails.filter(
          (e: any) => e.accountEmail?.toLowerCase() === accountFilter,
        );
      }

      emails = emails.slice(0, limit);

      return JSON.stringify(compact ? toCompact(emails) : emails, null, 2);
    }

    // Fallback: local store
    let emails = await readLocalEmails(ownerEmail);

    switch (view) {
      case "inbox":
        emails = emails.filter(
          (e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
        );
        break;
      case "unread":
        emails = emails.filter(
          (e) =>
            !e.isRead &&
            !e.isArchived &&
            !e.isTrashed &&
            !e.isDraft &&
            !e.isSent,
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
  },
});
