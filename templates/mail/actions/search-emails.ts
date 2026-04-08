import { defineAction } from "@agent-native/core";
import {
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  getClients,
} from "../server/lib/google-auth.js";

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
    from: e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email,
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
    accountEmail: e.accountEmail,
  }));
}

export default defineAction({
  description: "Search emails across all views using Gmail search syntax.",
  parameters: {
    q: {
      type: "string",
      description:
        "Search query (required), supports Gmail search operators like from:, to:, subject:, is:unread",
    },
    view: {
      type: "string",
      description: "Limit search to a view (default: all)",
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
    limit: { type: "string", description: "Max results (default: 25)" },
    account: {
      type: "string",
      description:
        "Filter to a specific account email address. By default searches all connected accounts.",
    },
    compact: {
      type: "string",
      description: "Set to 'true' for compact output",
      enum: ["true", "false"],
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (!args.q) return "Error: --q is required";
    const view = args.view ?? "all";
    const limit = args.limit ? parseInt(args.limit, 10) : 25;
    const compact = args.compact !== "false";
    const accountFilter = args.account?.toLowerCase();
    const ownerEmail = process.env.AGENT_USER_EMAIL || "local@localhost";

    const clients = await getClients(ownerEmail);
    if (clients.length === 0) return "Error: No Google account connected.";

    const viewPrefix = VIEW_QUERIES[view] ?? `label:${view}`;
    const gmailQuery = viewPrefix ? `${viewPrefix} ${args.q}` : args.q;

    const labelMap = new Map<string, string>();
    await Promise.all(
      clients.map(async ({ accessToken }) => {
        try {
          const map = await fetchGmailLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    const { messages, errors } = await listGmailMessages(
      gmailQuery,
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
  },
});
