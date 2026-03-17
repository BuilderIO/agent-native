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

import fs from "fs";
import path from "path";
import { parseArgs, output } from "./helpers.js";
import {
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  isConnected,
} from "../server/lib/google-auth.js";

const STATE_DIR = path.join(process.cwd(), "application-state");
const DATA_DIR = path.join(process.cwd(), "data");
const EMAIL_LIST_FILE = path.join(STATE_DIR, "email-list.json");
const NAVIGATION_FILE = path.join(STATE_DIR, "navigation.json");
const TRIGGER_FILE = path.join(DATA_DIR, "refresh-trigger.json");

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
    try {
      const nav = JSON.parse(fs.readFileSync(NAVIGATION_FILE, "utf-8"));
      view = nav.view ?? "inbox";
    } catch {
      view = "inbox";
    }
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

  // Update application-state/email-list.json (agent reads this via view-screen)
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    EMAIL_LIST_FILE,
    JSON.stringify(
      { view, label: null, count: emails.length, emails: compact },
      null,
      2,
    ),
  );

  // Touch data/refresh-trigger.json to trigger the UI's file watcher to refetch
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    TRIGGER_FILE,
    JSON.stringify({ refreshedAt: new Date().toISOString(), view }),
  );

  console.error(`Refreshed ${emails.length} email(s) in "${view}"`);
  output({ refreshed: true, view, count: emails.length });
}
