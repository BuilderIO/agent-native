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

export default async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.id) {
    fatal("--id is required. Usage: pnpm script get-email --id=msg123");
  }

  const clients = await getClients();
  if (clients.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

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
      console.error(
        `Email: ${parsed.subject} from ${parsed.from?.name || parsed.from?.email}`,
      );
      output(parsed);
      return;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) continue;
      fatal(`Gmail error: ${err?.message}`);
    }
  }

  fatal("Email not found in any connected account.");
}
