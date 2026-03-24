/**
 * Get a single email by ID.
 *
 * Usage:
 *   pnpm script get-email --id=msg123
 *
 * Options:
 *   --id    Email ID (required)
 */

import {
  parseArgs,
  output,
  fatal,
  getAccessTokens,
  fetchLabelMap,
} from "./helpers.js";
import { gmailGetMessage } from "../server/lib/google-api.js";
import { gmailToEmailMessage } from "../server/lib/google-auth.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Get a single email by ID, including its full body and metadata.",
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

  const accounts = await getAccessTokens();
  if (accounts.length === 0) return "Error: No Google account connected.";

  for (const { email, accessToken } of accounts) {
    try {
      const labelMap = await fetchLabelMap(accessToken);
      const msg = await gmailGetMessage(accessToken, args.id, "full");
      const parsed = gmailToEmailMessage(msg, email, labelMap);
      return JSON.stringify(parsed, null, 2);
    } catch (err: any) {
      if (err?.message?.includes("404")) continue;
      return `Error: ${err?.message}`;
    }
  }
  return "Error: Email not found in any connected account.";
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.id)
    fatal("--id is required. Usage: pnpm script get-email --id=msg123");

  const accounts = await getAccessTokens();
  if (accounts.length === 0)
    fatal("No Google account connected. Connect an account in the app first.");

  for (const { email, accessToken } of accounts) {
    try {
      const labelMap = await fetchLabelMap(accessToken);
      const msg = await gmailGetMessage(accessToken, args.id, "full");
      const parsed = gmailToEmailMessage(msg, email, labelMap);
      console.error(
        `Email: ${parsed.subject} from ${parsed.from?.name || parsed.from?.email}`,
      );
      output(parsed);
      return;
    } catch (err: any) {
      if (err?.message?.includes("404")) continue;
      fatal(`Gmail error: ${err?.message}`);
    }
  }
  fatal("Email not found in any connected account.");
}
