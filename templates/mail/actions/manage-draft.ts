import { defineAction } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";

/** Reject IDs that could escape via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

export default defineAction({
  description:
    "Create, update, or delete a compose draft. Opening a draft makes it appear in the compose panel UI automatically.",
  parameters: {
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
    body: {
      type: "string",
      description:
        "Email body in markdown. Use [text](url) for links, **bold**, *italic*, - lists, etc.",
    },
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
    accountEmail: {
      type: "string",
      description: "The 'from' account email address to send from",
    },
  },
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
