/**
 * Send an email.
 *
 * Usage:
 *   pnpm script send-email --to=alice@example.com --subject="Hello" --body="Hi there"
 *   pnpm script send-email --to=alice@example.com --cc=bob@example.com --subject="Update" --body="..."
 *   pnpm script send-email --to=alice@example.com --subject="Re: Thread" --body="..." --threadId=thread-123 --replyToId=msg-456
 *
 * Options:
 *   --to          Recipient email(s), comma-separated (required)
 *   --cc          CC email(s), comma-separated
 *   --bcc         BCC email(s), comma-separated
 *   --subject     Email subject (required)
 *   --body        Email body text (required)
 *   --threadId    Thread ID (for replies)
 *   --replyToId   Message ID being replied to (for replies)
 */

import { parseArgs, output, fatal } from "./helpers.js";

const API_BASE = "http://localhost:8080";

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.to) fatal("--to is required");
  if (!args.subject) fatal("--subject is required");
  if (!args.body) fatal("--body is required");

  const payload: Record<string, unknown> = {
    to: args.to,
    subject: args.subject,
    body: args.body,
  };
  if (args.cc) payload.cc = args.cc;
  if (args.bcc) payload.bcc = args.bcc;
  if (args.threadId) payload.threadId = args.threadId;
  if (args.replyToId) payload.replyToId = args.replyToId;

  try {
    const res = await fetch(`${API_BASE}/api/emails/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      fatal(`Failed to send: ${body?.error || `HTTP ${res.status}`}`);
    }

    const result = await res.json();
    console.error("Email sent successfully");
    output(result);
  } catch (err: any) {
    fatal(`Could not connect to dev server at ${API_BASE}. Start it with: pnpm dev\n  (${err?.message})`);
  }
}
