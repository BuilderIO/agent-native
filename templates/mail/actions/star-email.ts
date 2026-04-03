/**
 * Star or unstar one or more emails.
 *
 * Usage:
 *   pnpm action star-email --id=msg123
 *   pnpm action star-email --id=msg123,msg456
 *   pnpm action star-email --id=msg123 --unstar
 *
 * Options:
 *   --id      Email ID(s), comma-separated (required)
 *   --unstar  Remove star instead of adding it
 */

import { parseArgs, output, fatal, getAccessTokens } from "./helpers.js";
import { gmailModifyMessage } from "../server/lib/google-api.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description: "Star or unstar one or more emails.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Email ID(s), comma-separated" },
      unstar: {
        type: "string",
        description: "Set to 'true' to remove star",
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
  const unstar = args.unstar === "true";

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
          unstar ? undefined : ["STARRED"],
          unstar ? ["STARRED"] : undefined,
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

  const action = unstar ? "Unstarred" : "Starred";
  const succeeded = results.filter((r) => r.success).length;
  return `${action} ${succeeded}/${ids.length} email(s)`;
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const ids = args.id
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unstar = args.unstar === "true";

  if (!ids || ids.length === 0) {
    fatal(
      "--id is required. Usage: pnpm action star-email --id=msg123 [--unstar]",
    );
  }

  const accounts = await getAccessTokens();
  if (accounts.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const id of ids) {
    let success = false;
    const errors: string[] = [];
    for (const { accessToken } of accounts) {
      try {
        await gmailModifyMessage(
          accessToken,
          id,
          unstar ? undefined : ["STARRED"],
          unstar ? ["STARRED"] : undefined,
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

  const action = unstar ? "unstarred" : "starred";
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.error(
    `${action.charAt(0).toUpperCase() + action.slice(1)} ${succeeded}/${ids.length} email(s)${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
  output(results);
}
