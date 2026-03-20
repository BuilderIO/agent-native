/**
 * Get a single email by ID.
 *
 * Usage:
 *   pnpm script get-email --id=msg123
 *
 * Options:
 *   --id    Email ID (required)
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
  description: "Get a single email by ID, including its full body and metadata.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Email message ID" },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.id) return "Error: --id is required";

  const clients = await getClients();
  if (clients.length === 0) return "Error: No Google account connected.";

  for (const { email, client } of clients) {
    const gmail = google.gmail({ version: "v1", auth: client });
    try {
      const labelMap = await fetchGmailLabelMap(client);
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: args.id,
        format: "full",
      });
      const parsed = gmailToEmailMessage((msg as any).data, email, labelMap);
      return JSON.stringify(parsed, null, 2);
    } catch (err: any) {
      if (err?.response?.status === 404) continue;
      return `Error: ${err?.message}`;
    }
  }
  return "Error: Email not found in any connected account.";
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.id) fatal("--id is required. Usage: pnpm script get-email --id=msg123");

  const clients = await getClients();
  if (clients.length === 0) fatal("No Google account connected. Connect an account in the app first.");

  for (const { email, client } of clients) {
    const gmail = google.gmail({ version: "v1", auth: client });
    try {
      const labelMap = await fetchGmailLabelMap(client);
      const msg = await gmail.users.messages.get({ userId: "me", id: args.id, format: "full" });
      const parsed = gmailToEmailMessage((msg as any).data, email, labelMap);
      console.error(`Email: ${parsed.subject} from ${parsed.from?.name || parsed.from?.email}`);
      output(parsed);
      return;
    } catch (err: any) {
      if (err?.response?.status === 404) continue;
      fatal(`Gmail error: ${err?.message}`);
    }
  }
  fatal("Email not found in any connected account.");
}
