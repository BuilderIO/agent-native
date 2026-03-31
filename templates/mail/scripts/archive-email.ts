/**
 * Archive one or more emails by ID.
 *
 * Usage:
 *   pnpm script archive-email --id=msg123
 *   pnpm script archive-email --id=msg123,msg456,msg789
 *
 * Options:
 *   --id    Email ID(s) to archive, comma-separated (required)
 */

import { parseArgs, output, fatal, getAccessTokens } from "./helpers.js";
import { gmailModifyMessage } from "../server/lib/google-api.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Archive one or more emails by ID. The UI handles navigation to the next email automatically.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Email ID(s) to archive, comma-separated",
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

  if (!ids || ids.length === 0) {
    return "Error: --id is required";
  }

  const accounts = await getAccessTokens();
  if (accounts.length === 0) {
    return "Error: No Google account connected. Connect an account in the app first.";
  }

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const id of ids) {
    let success = false;
    const errors: string[] = [];
    for (const { accessToken } of accounts) {
      try {
        await gmailModifyMessage(accessToken, id, undefined, ["INBOX"]);
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

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  // Trigger UI refresh
  await writeAppState("refresh-signal", { ts: Date.now() });

  if (failed > 0) {
    const failedItems = results.filter((r) => !r.success);
    return `Archived ${succeeded}/${ids.length} email(s). Failures: ${failedItems.map((r) => `${r.id}: ${r.error}`).join("; ")}`;
  }
  return `Archived ${succeeded} email(s) successfully`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;

  if (!args.id) {
    fatal("--id is required. Usage: pnpm script archive-email --id=msg123");
  }

  const result = await run(args);
  console.error(result);
  output({ result });
}
