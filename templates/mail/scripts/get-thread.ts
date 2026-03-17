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

import { google } from "googleapis";
import { parseArgs, output, fatal } from "./helpers.js";
import {
  getClients,
  gmailToEmailMessage,
  fetchGmailLabelMap,
} from "../server/lib/google-auth.js";

export default async function main(): Promise<void> {
  const args = parseArgs();
  const threadId = args.id;
  const compact = args.compact === "true";

  if (!threadId) {
    fatal("--id is required. Usage: pnpm script get-thread --id=thread-123");
  }

  const clients = await getClients();
  if (clients.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

  const labelMap = new Map<string, string>();
  await Promise.all(
    clients.map(async ({ client }) => {
      try {
        const map = await fetchGmailLabelMap(client);
        for (const [id, name] of map) labelMap.set(id, name);
      } catch {}
    }),
  );

  for (const { email, client } of clients) {
    const gmail = google.gmail({ version: "v1", auth: client });
    try {
      const threadRes = await (gmail.users.threads.get as any)({
        userId: "me",
        id: threadId,
        format: "full",
      });
      const messages = ((threadRes as any).data.messages || [])
        .map((m: any) =>
          gmailToEmailMessage({ ...m, _accountEmail: email }, email, labelMap),
        )
        .sort(
          (a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

      console.error(`Thread ${threadId}: ${messages.length} message(s)`);

      if (compact) {
        output(
          messages.map((m: any) => ({
            id: m.id,
            from: m.from.name
              ? `${m.from.name} <${m.from.email}>`
              : m.from.email,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
          })),
        );
      } else {
        output(messages);
      }
      return;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) continue;
      fatal(`Gmail error: ${err?.message}`);
    }
  }

  fatal("Thread not found in any connected account.");
}
