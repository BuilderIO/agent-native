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

import { google } from "googleapis";
import { parseArgs, output, fatal } from "./helpers.js";
import { getClients } from "../server/lib/google-auth.js";

export default async function main(): Promise<void> {
  const args = parseArgs();
  const ids = args.id
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const markUnread = args.unread === "true";

  if (!ids || ids.length === 0) {
    fatal(
      "--id is required. Usage: pnpm script mark-read --id=msg123 [--unread]",
    );
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
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: markUnread
            ? { addLabelIds: ["UNREAD"] }
            : { removeLabelIds: ["UNREAD"] },
        });
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
  const failed = results.filter((r) => !r.success).length;

  console.error(
    `Marked ${succeeded}/${ids.length} email(s) as ${action}${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
  output(results);
}
