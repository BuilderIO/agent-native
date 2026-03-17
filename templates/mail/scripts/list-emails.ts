/**
 * List emails with filtering and search.
 *
 * Fetches from the running dev server API (which uses Gmail when connected).
 * Falls back to reading data/emails.json directly if the server is not running.
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

import fs from "fs";
import path from "path";
import { parseArgs, output, fatal } from "./helpers.js";

const EMAILS_FILE = path.join(process.cwd(), "data", "emails.json");
const API_BASE = "http://localhost:8080";

interface EmailMessage {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  isDraft?: boolean;
  isSent?: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  labelIds: string[];
}

async function fetchFromAPI(
  view: string,
  query?: string,
): Promise<{ emails: EmailMessage[] | null; error?: string }> {
  try {
    const params = new URLSearchParams({ view });
    if (query) params.set("q", query);
    const res = await fetch(`${API_BASE}/api/emails?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        emails: null,
        error: body?.error || `API returned ${res.status}`,
      };
    }
    return { emails: (await res.json()) as EmailMessage[] };
  } catch (err: any) {
    return {
      emails: null,
      error: err?.message || "Failed to connect to dev server",
    };
  }
}

function readFromFile(view: string, query?: string): EmailMessage[] {
  let emails: EmailMessage[];
  try {
    emails = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));
  } catch {
    return [];
  }

  if (emails.length === 0) return [];

  // Filter by view
  let filtered = emails;
  switch (view) {
    case "inbox":
      filtered = emails.filter(
        (e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
      );
      break;
    case "unread":
      filtered = emails.filter(
        (e) =>
          !e.isRead && !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
      );
      break;
    case "starred":
      filtered = emails.filter((e) => e.isStarred && !e.isTrashed);
      break;
    case "sent":
      filtered = emails.filter((e) => e.isSent && !e.isTrashed);
      break;
    case "drafts":
      filtered = emails.filter((e) => e.isDraft);
      break;
    case "archive":
      filtered = emails.filter((e) => e.isArchived && !e.isTrashed);
      break;
    case "trash":
      filtered = emails.filter((e) => e.isTrashed);
      break;
    case "all":
      break;
    default:
      filtered = emails.filter(
        (e) => e.labelIds.includes(view) && !e.isTrashed,
      );
  }

  // Full-text search
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.subject.toLowerCase().includes(q) ||
        e.snippet.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q) ||
        e.from.name.toLowerCase().includes(q) ||
        e.from.email.toLowerCase().includes(q),
    );
  }

  // Sort by date descending (newest first)
  filtered.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return filtered;
}

function toCompact(emails: EmailMessage[]): {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
}[] {
  return emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email,
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

  // Try the API first (uses Gmail when connected)
  const { emails: apiEmails, error: apiError } = await fetchFromAPI(
    view,
    query,
  );
  let emails: EmailMessage[];
  let source: string;

  if (apiEmails !== null) {
    emails = apiEmails;
    source = "api";
  } else {
    // Server not running or errored — fall back to local file
    console.error(
      `API unavailable (${apiError}), falling back to local data...`,
    );
    emails = readFromFile(view, query);
    source = "local";
    if (emails.length === 0) {
      console.error(
        "No emails found. The dev server is not running and data/emails.json is empty.",
      );
      console.error(
        "Start the dev server (pnpm dev) and connect a Google account to see real emails.",
      );
      return;
    }
  }

  // Apply limit
  emails = emails.slice(0, limit);

  console.error(
    `Found ${emails.length} email(s) in "${view}" (source: ${source})`,
  );
  output(compact ? toCompact(emails) : emails);
}
