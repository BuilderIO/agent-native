/**
 * Search emails across all views.
 *
 * Convenience wrapper around list-emails with --view=all.
 * Searches across subject, body, sender name, and sender email.
 *
 * Usage:
 *   pnpm script search-emails --q=meeting
 *   pnpm script search-emails --q="from:alice budget"
 *   pnpm script search-emails --q=quarterly --view=sent
 *   pnpm script search-emails --q=receipt --compact
 *
 * Options:
 *   --q        Search query (required)
 *   --view     Limit search to a view (default: all)
 *   --limit    Max results (default: 25)
 *   --compact  Output compact summary
 *   --fields   Comma-separated fields to include
 *   --grep     Further filter output by keyword
 */

import { parseArgs, output, fatal } from "./helpers.js";

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

function toCompact(emails: EmailMessage[]): {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isRead: boolean;
}[] {
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

  if (!query) {
    fatal("--q is required. Usage: pnpm script search-emails --q=meeting");
  }

  try {
    const params = new URLSearchParams({ view, q: query });
    const res = await fetch(`${API_BASE}/api/emails?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      fatal(
        `API error: ${body?.error || res.status}. Is the dev server running? (pnpm dev)`,
      );
    }

    let emails = (await res.json()) as EmailMessage[];
    emails = emails.slice(0, limit);

    console.error(
      `Found ${emails.length} result(s) for "${query}" in "${view}"`,
    );
    output(compact ? toCompact(emails) : emails);
  } catch (err: any) {
    fatal(
      `Could not connect to dev server at ${API_BASE}. Start it with: pnpm dev\n  (${err?.message})`,
    );
  }
}
