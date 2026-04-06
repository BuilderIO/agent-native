/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching email list directly
 * from Gmail API (or local store fallback). No HTTP self-requests.
 *
 * Usage:
 *   pnpm action view-screen
 */

import {
  parseArgs,
  output,
  getAccessTokens,
  fetchLabelMap,
} from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import {
  isConnected,
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
} from "../server/lib/google-auth.js";
import { gmailGetThread } from "../server/lib/google-api.js";
import { getSetting } from "@agent-native/core/settings";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view, email list, and open thread (if any). Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {
      full: {
        type: "string",
        description:
          "Set to 'true' for full detail (deprecated, now always returns full detail)",
        enum: ["true", "false"],
      },
    },
  },
};

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

async function fetchEmailList(
  view: string,
  search?: string,
  _label?: string,
): Promise<any[]> {
  try {
    const ownerEmail = process.env.AGENT_USER_EMAIL || "local@localhost";
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
      const gmailQuery = [viewPrefix, search].filter(Boolean).join(" ");
      const { messages } = await listGmailMessages(
        gmailQuery || "in:inbox",
        50,
        ownerEmail,
      );

      return messages
        .map((m: any) => gmailToEmailMessage(m, m._accountEmail, labelMap))
        .sort(
          (a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        )
        .slice(0, 50);
    }

    // Fallback: local store
    const data = await getSetting("local-emails");
    if (data && Array.isArray((data as any).emails)) {
      let emails = (data as any).emails;
      switch (view) {
        case "inbox":
          emails = emails.filter(
            (e: any) =>
              !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
          );
          break;
        case "unread":
          emails = emails.filter(
            (e: any) =>
              !e.isRead &&
              !e.isArchived &&
              !e.isTrashed &&
              !e.isDraft &&
              !e.isSent,
          );
          break;
        case "starred":
          emails = emails.filter((e: any) => e.isStarred && !e.isTrashed);
          break;
        case "sent":
          emails = emails.filter((e: any) => e.isSent && !e.isTrashed);
          break;
        case "drafts":
          emails = emails.filter((e: any) => e.isDraft);
          break;
        case "archive":
          emails = emails.filter((e: any) => e.isArchived && !e.isTrashed);
          break;
        case "trash":
          emails = emails.filter((e: any) => e.isTrashed);
          break;
      }
      if (search) {
        const q = search.toLowerCase();
        emails = emails.filter(
          (e: any) =>
            e.subject?.toLowerCase().includes(q) ||
            e.snippet?.toLowerCase().includes(q) ||
            e.body?.toLowerCase().includes(q) ||
            e.from?.name?.toLowerCase().includes(q) ||
            e.from?.email?.toLowerCase().includes(q),
        );
      }
      return emails.slice(0, 50);
    }
    return [];
  } catch {
    return [];
  }
}

async function fetchThreadMessages(threadId: string): Promise<any | null> {
  try {
    const accounts = await getAccessTokens();
    if (accounts.length === 0) return null;

    const labelMap = new Map<string, string>();
    await Promise.all(
      accounts.map(async ({ accessToken }) => {
        try {
          const map = await fetchLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    for (const { email, accessToken } of accounts) {
      try {
        const threadRes = await gmailGetThread(accessToken, threadId, "full");
        const messages = (threadRes.messages || [])
          .map((m: any) =>
            gmailToEmailMessage(
              { ...m, _accountEmail: email },
              email,
              labelMap,
            ),
          )
          .sort(
            (a: any, b: any) =>
              new Date(a.date).getTime() - new Date(b.date).getTime(),
          );

        return {
          threadId,
          messages: messages.map((m: any) => ({
            id: m.id,
            from: m.from?.name
              ? `${m.from.name} <${m.from.email}>`
              : (m.from?.email ?? ""),
            to: (m.to || []).map((t: any) =>
              t.name ? `${t.name} <${t.email}>` : t.email,
            ),
            subject: m.subject,
            body: m.body,
            date: m.date,
            isRead: m.isRead,
          })),
        };
      } catch (err: any) {
        if (err?.message?.includes("404")) continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  // Fetch emails based on the user's current filter state
  const nav = navigation as any;
  if (nav?.view) {
    const emails = await fetchEmailList(nav.view, nav.search, nav.label);
    const compact = emails.slice(0, 50).map((e: any) => ({
      id: e.id,
      threadId: e.threadId,
      from: e.from?.name
        ? `${e.from.name} <${e.from.email}>`
        : (e.from?.email ?? e.from ?? ""),
      subject: e.subject,
      snippet: e.snippet,
      date: e.date,
      isRead: e.isRead,
      isStarred: e.isStarred,
    }));
    screen.emailList = {
      view: nav.view,
      label: nav.label ?? null,
      search: nav.search ?? null,
      count: compact.length,
      emails: compact,
    };
  }

  // Fetch thread messages directly via Gmail API if the user is viewing a thread
  if (nav?.threadId) {
    const thread = await fetchThreadMessages(nav.threadId);
    if (thread) screen.thread = thread;
  }

  if (Object.keys(screen).length === 0) {
    return "No application state found. Is the app running?";
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  const result = await run(args);

  const parsed = JSON.parse(result);
  const nav = parsed.navigation;
  const emailCount = parsed.emailList?.count ?? 0;

  console.error(
    `Current view: ${nav?.view ?? "unknown"}` +
      (nav?.threadId ? ` (thread: ${nav.threadId})` : "") +
      ` — ${emailCount} email(s) on screen`,
  );
  output(parsed);
}
