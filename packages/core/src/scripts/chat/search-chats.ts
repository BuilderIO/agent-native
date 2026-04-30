/**
 * Core script: search-chats
 *
 * Search or list past agent chat threads.
 *
 * Usage:
 *   pnpm action search-chats [--query "search term"] [--limit N] [--format json]
 */

import { parseArgs, fail } from "../utils.js";
import { searchThreads, listThreads } from "../../chat-threads/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { DEV_MODE_USER_EMAIL } from "../../server/auth.js";

function getOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email || email === DEV_MODE_USER_EMAIL) return DEV_MODE_USER_EMAIL;
  return email;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default async function searchChats(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action search-chats [options]

Options:
  --query <text>  Search chats by title, preview, or content
  --limit N       Max results (default: 20)
  --format json   Output as JSON
  --help          Show this help message

Examples:
  pnpm action search-chats --query "email setup"
  pnpm action search-chats --limit 5
  pnpm action search-chats --format json`);
    return;
  }

  const owner = getOwnerEmail();
  const limit = parsed.limit ? parseInt(parsed.limit, 10) : 20;
  if (isNaN(limit) || limit < 1) fail("--limit must be a positive integer");

  const query = parsed.query;
  const threads = query
    ? await searchThreads(owner, query, limit)
    : await listThreads(owner, limit, 0);

  if (parsed.format === "json") {
    console.log(
      JSON.stringify(
        {
          query: query ?? null,
          threads: threads.map((t) => ({
            id: t.id,
            title: t.title,
            preview: t.preview,
            messageCount: t.messageCount,
            updatedAt: t.updatedAt,
          })),
          count: threads.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (threads.length === 0) {
    console.log(query ? `No chats matching "${query}"` : "No chat history");
    return;
  }

  console.log(
    query
      ? `Chats matching "${query}" (${threads.length}):`
      : `Recent chats (${threads.length}):`,
  );
  console.log();

  for (const t of threads) {
    const title = t.title || t.preview || "(untitled)";
    const msgs = t.messageCount === 1 ? "1 msg" : `${t.messageCount} msgs`;
    const time = formatTime(t.updatedAt);
    console.log(`  ${title}`);
    console.log(`    ID: ${t.id}  |  ${msgs}  |  ${time}`);
    if (t.preview && t.title && t.preview !== t.title) {
      console.log(
        `    ${t.preview.slice(0, 80)}${t.preview.length > 80 ? "..." : ""}`,
      );
    }
    console.log();
  }
}
