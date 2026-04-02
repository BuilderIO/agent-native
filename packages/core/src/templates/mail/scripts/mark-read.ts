/**
 * Mark one or more emails as read or unread.
 *
 * Usage:
 *   pnpm script mark-read --id=msg123
 *   pnpm script mark-read --id=msg123,msg456 --unread
 *
 * Options:
 *   --id      Email ID(s), comma-separated (required)
 *   --unread  Mark as unread instead of read
 */

import { parseArgs, output, fatal, getAccessTokens } from "./helpers.js";
import { gmailModifyMessage } from "../server/lib/google-api.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Mark one or more emails as read or unread.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Email ID(s), comma-separated" },
      unread: {
        type: "string",
        description: "Set to 'true' to mark as unread instead of read",
        enum: ["true", "false"],
      },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const ids = args.id
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids || ids.length === 0) return "Error: --id is required";
  const markUnread = args.unread === "true";

  const accounts = await getAccessTokens();
  if (accounts.length === 0) return "Error: No Google account connected.";

  const results: { id: string; success: boolean; error?: string }[] = [];
  for (const id of ids) {
    let success = false;
    const errors: string[] = [];
    for (const { accessToken } of accounts) {
      try {
        await gmailModifyMessage(
          accessToken,
          id,
          markUnread ? ["UNREAD"] : undefined,
          markUnread ? undefined : ["UNREAD"],
        );
        success = true;
        break;
      } catch (err: any) {
        errors.push(err?.message || "Gmail API error");
      }
    }
    results.push(
      success
        ? { id, success: true }
        : { id, success: false, error: errors.join("; ") },
    );
  }

  const action = markUnread ? "unread" : "read";
  const succeeded = results.filter((r) => r.success).length;
  return `Marked ${succeeded}/${ids.length} email(s) as ${action}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.id)
    fatal(
      "--id is required. Usage: pnpm script mark-read --id=msg123 [--unread]",
    );
  const result = await run(args);
  console.error(result);
  output({ result });
}
