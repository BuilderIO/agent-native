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
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Get all messages in an email thread by thread ID.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Thread ID" },
      compact: {
        type: "string",
        description: "Set to 'true' for compact summary",
        enum: ["true", "false"],
      },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.id) return "Error: --id is required";
  const compact = args.compact === "true";

  const clients = await getClients();
  if (clients.length === 0) return "Error: No Google account connected.";

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
        id: args.id,
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

      const result = compact
        ? messages.map((m: any) => ({
            id: m.id,
            from: m.from.name
              ? `${m.from.name} <${m.from.email}>`
              : m.from.email,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
          }))
        : messages;

      return JSON.stringify(result, null, 2);
    } catch (err: any) {
      if (err?.response?.status === 404) continue;
      return `Error: ${err?.message}`;
    }
  }
  return "Error: Thread not found in any connected account.";
}

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
