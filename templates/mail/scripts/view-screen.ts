/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching email list via API.
 *
 * Usage:
 *   pnpm script view-screen
 */

import { parseArgs, output } from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
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

async function fetchEmailList(
  view: string,
  search?: string,
  label?: string,
): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    params.set("view", view);
    if (search) params.set("q", search);
    if (label) params.set("label", label);
    const port = process.env.PORT || "8080";
    const res = await fetch(
      `http://localhost:${port}/api/emails?${params.toString()}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  const navigation = await readAppState("navigation");
  const thread = await readAppState("thread");

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

  if (thread) screen.thread = thread;

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
