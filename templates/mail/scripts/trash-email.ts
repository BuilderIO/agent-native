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

export default async function main(): Promise<void> {
  const args = parseArgs();
  const ids = args.id
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids || ids.length === 0) {
    fatal("--id is required. Usage: pnpm script trash-email --id=msg123");
  }

  const clients = await getClients();
  if (clients.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

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
    results.push(
      success
        ? { id, success: true }
        : { id, success: false, error: errors.join("; ") },
    );
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.error(
    `Trashed ${succeeded}/${ids.length} email(s)${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
  output(results);
}
