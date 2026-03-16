/**
 * List emails with filtering and search.
 *
 * Usage:
 *   pnpm script list-emails
 *   pnpm script list-emails --view=inbox
 *   pnpm script list-emails --view=unread
 *   pnpm script list-emails --view=starred --q=meeting
 *   pnpm script list-emails --view=inbox --fields=from,subject,date,snippet
 *
 * Options:
 *   --view     inbox (default), unread, starred, sent, drafts, archive, trash, all
 *   --q        Full-text search across subject, body, sender
 *   --limit    Max number of emails to return (default: 50)
 *   --fields   Comma-separated fields to include (default: all)
 *   --grep     Filter output by keyword (built-in helper)
 */

import fs from "fs";
import path from "path";
import { parseArgs, output, fatal } from "./helpers.js";

const EMAILS_FILE = path.join(process.cwd(), "data", "emails.json");

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

export default async function main(): Promise<void> {
  const args = parseArgs();
  const view = args.view ?? "inbox";
  const query = args.q;
  const limit = args.limit ? parseInt(args.limit, 10) : 50;

  let emails: EmailMessage[];
  try {
    emails = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));
  } catch {
    console.log("No emails found (data/emails.json does not exist).");
    return;
  }

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
      // Label-based filter
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

  // Apply limit
  filtered = filtered.slice(0, limit);

  // Output
  console.error(`Found ${filtered.length} email(s) in "${view}"`);
  output(filtered);
}
