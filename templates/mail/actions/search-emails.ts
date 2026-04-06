/**
 * Search emails across all views using Gmail search syntax.
 *
 * Usage:
 *   pnpm action search-emails --q=meeting
 *   pnpm action search-emails --q="from:alice budget"
 *   pnpm action search-emails --q=quarterly --view=sent
 *   pnpm action search-emails --q=receipt --compact
 *
 * Options:
 *   --q        Search query (required) — supports Gmail search operators
 *   --view     Limit search to a view (default: all)
 *   --limit    Max results (default: 25)
 *   --compact  Output compact summary
 *   --fields   Comma-separated fields to include
 *   --grep     Further filter output by keyword
 */

import { parseArgs, output, fatal } from "./helpers.js";
import {
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  getClients,
} from "../server/lib/google-auth.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "Search emails across all views using Gmail search syntax.",
  parameters: {
    type: "object",
    properties: {
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
      compact: {
        type: "string",
        description: "Set to 'true' for compact output",
        enum: ["true", "false"],
      },
    },
    required: ["q"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.q) return "Error: --q is required";
  const view = args.view ?? "all";
  const limit = args.limit ? parseInt(args.limit, 10) : 25;
  const compact = args.compact !== "false";
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

  const emails = messages
    .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
    .sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
    .slice(0, limit);

  return JSON.stringify(compact ? toCompact(emails) : emails, null, 2);
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
    from: e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email,
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
  }));
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const query = args.q;
  const view = args.view ?? "all";
  const limit = args.limit ? parseInt(args.limit, 10) : 25;
  const compact = args.compact === "true";
  const ownerEmail = process.env.AGENT_USER_EMAIL || "local@localhost";

  if (!query) {
    fatal("--q is required. Usage: pnpm action search-emails --q=meeting");
  }

  const clients = await getClients(ownerEmail);
  if (clients.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

  const viewPrefix = VIEW_QUERIES[view] ?? `label:${view}`;
  const gmailQuery = viewPrefix ? `${viewPrefix} ${query}` : query;

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
    fatal(
      `Gmail error: ${errors.map((e) => `${e.email}: ${e.error}`).join("; ")}`,
    );
  }

  const emails = messages
    .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
    .sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
    .slice(0, limit);

  console.error(`Found ${emails.length} result(s) for "${query}" in "${view}"`);
  output(compact ? toCompact(emails) : emails);
}
