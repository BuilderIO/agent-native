/**
 * Refresh the email list in the UI.
 *
 * Fetches fresh emails from Gmail, writes them to application-state/email-list.json,
 * and touches data/refresh-trigger.json to trigger the UI's file watcher to refetch.
 *
 * Run this after making backend changes (archive, trash, mark-read, star, etc.)
 * to ensure the UI reflects the latest state.
 *
 * Usage:
 *   pnpm script refresh-list
 *   pnpm script refresh-list --view=inbox
 *   pnpm script refresh-list --view=starred
 */

import { parseArgs, output } from "./helpers.js";
import {
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  isConnected,
} from "../server/lib/google-auth.js";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Refresh the email list displayed in the UI. Fetches fresh emails from Gmail and triggers the UI to refetch. Call this after any backend change (archive, trash, star, mark-read, send, etc.).",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description:
          "View to refresh (default: current view from navigation state)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  let view = args.view;
  if (!view) {
    const nav = await readAppState("navigation");
    view = (nav as any)?.view ?? "inbox";
  }

  if (!isConnected()) {
    return "No Google account connected — skipping Gmail refresh.";
  }

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

  const viewPrefix = VIEW_QUERIES[view] ?? `label:${view}`;
  const { messages, errors } = await listGmailMessages(
    viewPrefix || "in:inbox",
    50,
  );

  if (errors.length > 0 && messages.length === 0) {
    return `Gmail error: ${errors.map((e) => `${e.email}: ${e.error}`).join("; ")}`;
  }

  const emails = messages
    .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
    .sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
    .slice(0, 50);

  const compact = emails.map((e: any) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from?.name
      ? `${e.from.name} <${e.from.email}>`
      : (e.from?.email ?? ""),
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
    isStarred: e.isStarred,
  }));

  await writeAppState("email-list", {
    view,
    label: null,
    count: emails.length,
    emails: compact,
  });

  return `Refreshed ${emails.length} email(s) in "${view}"`;
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

export default async function main(): Promise<void> {
  const args = parseArgs();

  // Detect current view from navigation state if not specified
  let view = args.view;
  if (!view) {
    const nav = await readAppState("navigation");
    view = (nav as any)?.view ?? "inbox";
  }

  if (!isConnected()) {
    console.error("No Google account connected — skipping Gmail refresh.");
    return;
  }

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

  const viewPrefix = VIEW_QUERIES[view] ?? `label:${view}`;
  const { messages, errors } = await listGmailMessages(
    viewPrefix || "in:inbox",
    50,
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
    .slice(0, 50);

  const compact = emails.map((e: any) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from?.name
      ? `${e.from.name} <${e.from.email}>`
      : (e.from?.email ?? ""),
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
    isStarred: e.isStarred,
  }));

  // Update application state (triggers SSE for UI refresh)
  await writeAppState("email-list", {
    view,
    label: null,
    count: emails.length,
    emails: compact,
  });

  console.error(`Refreshed ${emails.length} email(s) in "${view}"`);
  output({ refreshed: true, view, count: emails.length });
}
