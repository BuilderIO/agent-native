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

import { parseArgs, output, fatal, getAccessTokens } from "./helpers.js";
import { gmailModifyMessage } from "../server/lib/google-api.js";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Archive one or more emails by ID. After archiving, automatically navigates to the next email if the archived email is currently open.",
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

async function fetchEmailList(view: string): Promise<any[]> {
  try {
    const port = process.env.PORT || "8080";
    const res = await fetch(
      `http://localhost:${port}/api/emails?view=${encodeURIComponent(view)}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

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

  const navigation = (await readAppState("navigation")) as any;
  const thread = (await readAppState("thread")) as any;

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

  // Auto-navigate if the archived email was open
  if (succeeded > 0 && thread) {
    const archivedIds = new Set(ids);
    const openThreadMessageIds = new Set<string>(
      (thread.messages ?? []).map((m: any) => m.id),
    );
    const openThreadId: string | undefined =
      navigation?.threadId ?? thread.messages?.[0]?.threadId;

    const view = navigation?.view ?? "inbox";

    // Fetch the current email list via API to find next email
    const emails = await fetchEmailList(view);

    const isActiveThreadArchived =
      ids.some((id) => openThreadMessageIds.has(id)) ||
      (openThreadId &&
        ids.some((id) => {
          const email = emails.find((e: any) => e.id === id);
          return email?.threadId === openThreadId;
        }));

    if (isActiveThreadArchived && emails.length > 0) {
      const idx = emails.findIndex(
        (e: any) => archivedIds.has(e.id) || archivedIds.has(e.threadId),
      );
      const nextEmail = emails[idx + 1] ?? emails[idx - 1] ?? null;
      const nav: Record<string, string> = { view };
      if (nextEmail?.threadId) nav.threadId = nextEmail.threadId;
      await writeAppState("navigate", nav);
    }
  }

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
