/**
 * Trash one or more emails by ID.
 *
 * Usage:
 *   pnpm script trash-email --id=msg123
 *   pnpm script trash-email --id=msg123,msg456
 *
 * Options:
 *   --id    Email ID(s) to trash, comma-separated (required)
 */

import { google } from "googleapis";
import { parseArgs, output, fatal } from "./helpers.js";
import { getClients } from "../server/lib/google-auth.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Move one or more emails to trash by ID.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Email ID(s) to trash, comma-separated" },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const ids = args.id?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids || ids.length === 0) return "Error: --id is required";

  const clients = await getClients();
  if (clients.length === 0) return "Error: No Google account connected.";

  const results: { id: string; success: boolean; error?: string }[] = [];
  for (const id of ids) {
    let success = false;
    const errors: string[] = [];
    for (const { client } of clients) {
      const gmail = google.gmail({ version: "v1", auth: client });
      try {
        await gmail.users.messages.trash({ userId: "me", id });
        success = true;
        break;
      } catch (err: any) {
        errors.push(err?.message || "Gmail API error");
      }
    }
    results.push(success ? { id, success: true } : { id, success: false, error: errors.join("; ") });
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  if (failed > 0) {
    return `Trashed ${succeeded}/${ids.length} email(s). Failures: ${results.filter((r) => !r.success).map((r) => `${r.id}: ${r.error}`).join("; ")}`;
  }
  return `Trashed ${succeeded} email(s) successfully`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.id) fatal("--id is required. Usage: pnpm script trash-email --id=msg123");
  const result = await run(args);
  console.error(result);
  output({ result });
}
