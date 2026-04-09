import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { z } from "zod";

/** Reject IDs that could escape via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

export default defineAction({
  description:
    "Create, update, or delete a compose draft. Opening a draft makes it appear in the compose panel UI automatically.",
  schema: z.object({
    action: z
      .enum(["create", "update", "delete", "delete-all"])
      .optional()
      .describe("Action to perform"),
    id: z
      .string()
      .optional()
      .describe(
        "Draft ID (auto-generated for create; required for update/delete)",
      ),
    to: z.string().optional().describe("Recipient email(s)"),
    cc: z.string().optional().describe("CC email(s)"),
    bcc: z.string().optional().describe("BCC email(s)"),
    subject: z.string().optional().describe("Email subject"),
    body: z
      .string()
      .optional()
      .describe(
        "Email body in markdown. Use [text](url) for links, **bold**, *italic*, - lists, etc.",
      ),
    mode: z
      .enum(["compose", "reply", "forward"])
      .optional()
      .describe("compose, reply, or forward"),
    replyToId: z.string().optional().describe("Message ID being replied to"),
    replyToThreadId: z.string().optional().describe("Thread ID for grouping"),
    accountEmail: z
      .string()
      .optional()
      .describe("The 'from' account email address to send from"),
  }),
  run: async (args) => {
    const action = args.action;
    if (!action)
      return "Error: --action is required (create, update, delete, delete-all)";

    if (action === "delete-all") {
      const count = await deleteAppStateByPrefix("compose-");
      return `Deleted ${count} draft(s)`;
    }

    if (action === "delete") {
      if (!args.id) return "Error: --id is required for delete";
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
      const deleted = await deleteAppState(`compose-${safeId}`);
      return deleted
        ? `Deleted draft ${safeId}`
        : `Error: Draft "${safeId}" not found`;
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
      if (args.accountEmail) draft.accountEmail = args.accountEmail;
      await writeAppState(`compose-${id}`, draft);
      return `Created draft ${id}`;
    }

    if (action === "update") {
      if (!args.id) return "Error: --id is required for update";
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
      const draft = await readAppState(`compose-${safeId}`);
      if (!draft) return `Error: Draft "${safeId}" not found`;
      for (const key of [
        "to",
        "cc",
        "bcc",
        "subject",
        "body",
        "mode",
        "replyToId",
        "replyToThreadId",
        "accountEmail",
      ]) {
        if (args[key] !== undefined) (draft as any)[key] = args[key];
      }
      await writeAppState(`compose-${safeId}`, draft);
      return `Updated draft ${safeId}`;
    }

    return `Error: Unknown action "${action}". Valid: create, update, delete, delete-all`;
  },
});
