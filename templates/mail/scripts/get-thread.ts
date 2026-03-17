/**
 * Get all messages in an email thread.
 *
 * Usage:
 *   pnpm script get-thread --id=thread-123
 *   pnpm script get-thread --id=thread-123 --compact
 *
 * Options:
 *   --id       Thread ID (required)
 *   --compact  Show compact summary (from, subject, snippet, date)
 */

import { parseArgs, output, fatal } from "./helpers.js";

const API_BASE = "http://localhost:8080";

interface ThreadMessage {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isRead: boolean;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const threadId = args.id;
  const compact = args.compact === "true";

  if (!threadId) {
    fatal("--id is required. Usage: pnpm script get-thread --id=thread-123");
  }

  try {
    const res = await fetch(`${API_BASE}/api/threads/${threadId}/messages`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      fatal(`API error: ${body?.error || `HTTP ${res.status}`}`);
    }

    let messages = (await res.json()) as ThreadMessage[];
    console.error(`Thread ${threadId}: ${messages.length} message(s)`);

    if (compact) {
      output(messages.map((m) => ({
        id: m.id,
        from: m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email,
        subject: m.subject,
        snippet: m.snippet,
        date: m.date,
      })));
    } else {
      output(messages);
    }
  } catch (err: any) {
    fatal(`Could not connect to dev server at ${API_BASE}. Start it with: pnpm dev\n  (${err?.message})`);
  }
}
