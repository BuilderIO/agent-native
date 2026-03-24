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

import {
  parseArgs,
  output,
  fatal,
  getAccessTokens,
  fetchLabelMap,
} from "./helpers.js";
import { gmailGetThread } from "../server/lib/google-api.js";
import { gmailToEmailMessage } from "../server/lib/google-auth.js";
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

  const accounts = await getAccessTokens();
  if (accounts.length === 0) return "Error: No Google account connected.";

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
      const threadRes = await gmailGetThread(accessToken, args.id, "full");
      const messages = (threadRes.messages || [])
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
      if (err?.message?.includes("404")) continue;
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

  const accounts = await getAccessTokens();
  if (accounts.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

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
      if (err?.message?.includes("404")) continue;
      fatal(`Gmail error: ${err?.message}`);
    }
  }

  fatal("Thread not found in any connected account.");
}
