/**
 * Create, update, or delete a compose draft.
 *
 * Usage:
 *   pnpm script manage-draft --action=create --to=alice@example.com --subject="Hello" --body="Hi there"
 *   pnpm script manage-draft --action=update --id=draft-123 --body="Updated body"
 *   pnpm script manage-draft --action=delete --id=draft-123
 *   pnpm script manage-draft --action=delete-all
 *
 * Options:
 *   --action   create, update, delete, or delete-all (required)
 *   --id       Draft ID (required for update/delete; auto-generated for create)
 *   --to       Recipient email(s)
 *   --cc       CC email(s)
 *   --bcc      BCC email(s)
 *   --subject  Email subject
 *   --body     Email body text
 *   --mode     compose, reply, or forward (default: compose)
 *   --replyToId       Message ID being replied to
 *   --replyToThreadId Thread ID for grouping
 */

import fs from "fs";
import path from "path";
import { parseArgs, output, fatal } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

const STATE_DIR = path.join(process.cwd(), "application-state");

/** Reject IDs that could escape STATE_DIR via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

export const tool: ScriptTool = {
  description:
    "Create, update, or delete a compose draft. Opening a draft makes it appear in the compose panel UI automatically.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action to perform",
        enum: ["create", "update", "delete", "delete-all"],
      },
      id: {
        type: "string",
        description:
          "Draft ID (auto-generated for create; required for update/delete)",
      },
      to: { type: "string", description: "Recipient email(s)" },
      cc: { type: "string", description: "CC email(s)" },
      bcc: { type: "string", description: "BCC email(s)" },
      subject: { type: "string", description: "Email subject" },
      body: { type: "string", description: "Email body text" },
      mode: {
        type: "string",
        description: "compose, reply, or forward",
        enum: ["compose", "reply", "forward"],
      },
      replyToId: { type: "string", description: "Message ID being replied to" },
      replyToThreadId: {
        type: "string",
        description: "Thread ID for grouping",
      },
    },
    required: ["action"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const action = args.action;
  if (!action)
    return "Error: --action is required (create, update, delete, delete-all)";

  if (action === "delete-all") {
    const files = fs
      .readdirSync(STATE_DIR)
      .filter((f) => f.startsWith("compose-") && f.endsWith(".json"));
    for (const f of files) fs.unlinkSync(path.join(STATE_DIR, f));
    return `Deleted ${files.length} draft(s)`;
  }

  if (action === "delete") {
    if (!args.id) return "Error: --id is required for delete";
    const safeId = sanitizeDraftId(args.id);
    if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
    try {
      fs.unlinkSync(path.join(STATE_DIR, `compose-${safeId}.json`));
      return `Deleted draft ${safeId}`;
    } catch {
      return `Error: Draft "${safeId}" not found`;
    }
  }

  if (action === "create") {
    const rawId = args.id || `draft-${Date.now()}`;
    const id = sanitizeDraftId(rawId) ?? `draft-${Date.now()}`;
    const draft: Record<string, string> = {
      id,
      to: args.to || "",
      subject: args.subject || "",
      body: args.body || "",
      mode: args.mode || "compose",
    };
    if (args.cc) draft.cc = args.cc;
    if (args.bcc) draft.bcc = args.bcc;
    if (args.replyToId) draft.replyToId = args.replyToId;
    if (args.replyToThreadId) draft.replyToThreadId = args.replyToThreadId;
    fs.writeFileSync(
      path.join(STATE_DIR, `compose-${id}.json`),
      JSON.stringify(draft, null, 2),
    );
    return `Created draft ${id}`;
  }

  if (action === "update") {
    if (!args.id) return "Error: --id is required for update";
    const safeId = sanitizeDraftId(args.id);
    if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
    let draft: Record<string, string>;
    try {
      draft = JSON.parse(
        fs.readFileSync(
          path.join(STATE_DIR, `compose-${safeId}.json`),
          "utf-8",
        ),
      );
    } catch {
      return `Error: Draft "${safeId}" not found`;
    }
    for (const key of [
      "to",
      "cc",
      "bcc",
      "subject",
      "body",
      "mode",
      "replyToId",
      "replyToThreadId",
    ]) {
      if (args[key] !== undefined) draft[key] = args[key];
    }
    fs.writeFileSync(
      path.join(STATE_DIR, `compose-${safeId}.json`),
      JSON.stringify(draft, null, 2),
    );
    return `Updated draft ${safeId}`;
  }

  return `Error: Unknown action "${action}". Valid: create, update, delete, delete-all`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.action)
    fatal("--action is required (create, update, delete, delete-all)");
  const result = await run(args);
  console.error(result);
  output({ result });
}
