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

const STATE_DIR = path.join(process.cwd(), "application-state");

export default async function main(): Promise<void> {
  const args = parseArgs();
  const action = args.action;

  if (!action) {
    fatal("--action is required (create, update, delete, delete-all)");
  }

  if (action === "delete-all") {
    const files = fs.readdirSync(STATE_DIR).filter((f) => f.startsWith("compose-") && f.endsWith(".json"));
    for (const f of files) fs.unlinkSync(path.join(STATE_DIR, f));
    console.error(`Deleted ${files.length} draft(s)`);
    output({ deleted: files.length });
    return;
  }

  if (action === "delete") {
    if (!args.id) fatal("--id is required for delete");
    const filePath = path.join(STATE_DIR, `compose-${args.id}.json`);
    try {
      fs.unlinkSync(filePath);
      console.error(`Deleted draft ${args.id}`);
      output({ id: args.id, deleted: true });
    } catch {
      fatal(`Draft "${args.id}" not found`);
    }
    return;
  }

  if (action === "create") {
    const id = args.id || `draft-${Date.now()}`;
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

    const filePath = path.join(STATE_DIR, `compose-${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(draft, null, 2));
    console.error(`Created draft ${id}`);
    output(draft);
    return;
  }

  if (action === "update") {
    if (!args.id) fatal("--id is required for update");
    const filePath = path.join(STATE_DIR, `compose-${args.id}.json`);
    let draft: Record<string, string>;
    try {
      draft = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      fatal(`Draft "${args.id}" not found`);
    }

    // Update only provided fields
    for (const key of ["to", "cc", "bcc", "subject", "body", "mode", "replyToId", "replyToThreadId"]) {
      if (args[key] !== undefined) draft[key] = args[key];
    }

    fs.writeFileSync(filePath, JSON.stringify(draft, null, 2));
    console.error(`Updated draft ${args.id}`);
    output(draft);
    return;
  }

  fatal(`Unknown action "${action}". Valid: create, update, delete, delete-all`);
}
