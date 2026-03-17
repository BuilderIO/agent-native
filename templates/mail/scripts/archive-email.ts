/**
 * Archive one or more emails by ID.
 *
 * After archiving, if the archived email is currently open in the thread view,
 * automatically navigates to the next email in the list (or previous if it was last).
 *
 * Usage:
 *   pnpm script archive-email --id=msg123
 *   pnpm script archive-email --id=msg123,msg456,msg789
 *
 * Options:
 *   --id    Email ID(s) to archive, comma-separated (required)
 */

import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { parseArgs, output, fatal } from "./helpers.js";
import { getClients } from "../server/lib/google-auth.js";

const STATE_DIR = path.join(process.cwd(), "application-state");

function readJson(filename: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, filename), "utf-8"));
  } catch {
    return null;
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const ids = args.id
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids || ids.length === 0) {
    fatal("--id is required. Usage: pnpm script archive-email --id=msg123");
  }

  const clients = await getClients();
  if (clients.length === 0) {
    fatal("No Google account connected. Connect an account in the app first.");
  }

  // Snapshot UI state before archiving so we can navigate after
  const navigation = readJson("navigation.json");
  const emailList = readJson("email-list.json");
  const thread = readJson("thread.json");

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
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        success = true;
        break;
      } catch (err: any) {
        errors.push(err?.message || "Gmail API error");
      }
    }
    if (success) {
      results.push({ id, success: true });
    } else {
      results.push({ id, success: false, error: errors.join("; ") });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.error(
    `Archived ${succeeded}/${ids.length} email(s)${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
  output(results);

  // If a thread is currently open, check if it was one of the archived emails.
  // If so, navigate to the next (or previous) email in the list.
  if (succeeded > 0 && thread && emailList?.emails?.length) {
    const archivedIds = new Set(ids);

    // Collect all message IDs in the open thread
    const openThreadMessageIds = new Set<string>(
      (thread.messages ?? []).map((m: any) => m.id),
    );
    const openThreadId: string | undefined =
      navigation?.threadId ?? thread.messages?.[0]?.threadId;

    const isActiveThreadArchived =
      ids.some((id) => openThreadMessageIds.has(id)) ||
      (openThreadId &&
        ids.some((id) => {
          const email = emailList.emails.find((e: any) => e.id === id);
          return email?.threadId === openThreadId;
        }));

    if (isActiveThreadArchived) {
      const emails: any[] = emailList.emails;
      // Find the index of the archived email in the list
      const idx = emails.findIndex(
        (e) => archivedIds.has(e.id) || archivedIds.has(e.threadId),
      );

      // Pick the next email, falling back to the previous one
      const nextEmail = emails[idx + 1] ?? emails[idx - 1] ?? null;

      if (nextEmail) {
        const nav: Record<string, string> = {
          view: emailList.view ?? navigation?.view ?? "inbox",
        };
        if (nextEmail.threadId) nav.threadId = nextEmail.threadId;
        fs.writeFileSync(
          path.join(STATE_DIR, "navigate.json"),
          JSON.stringify(nav, null, 2),
        );
        console.error(
          `Navigated to next email: "${nextEmail.subject}" (${nextEmail.threadId})`,
        );
      } else {
        // No adjacent email — go back to inbox list
        const nav = { view: emailList.view ?? navigation?.view ?? "inbox" };
        fs.writeFileSync(
          path.join(STATE_DIR, "navigate.json"),
          JSON.stringify(nav, null, 2),
        );
        console.error("No adjacent email found, navigated back to inbox.");
      }
    }
  }
}
