import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { updateQueuedDraft } from "../server/lib/queued-drafts.js";

export default defineAction({
  description:
    "Update a queued email draft's recipients, subject, body, context, owner, account, or status.",
  schema: z.object({
    id: z.string().describe("Queued draft ID"),
    ownerEmail: z
      .string()
      .optional()
      .describe("Reassign to another organization member"),
    to: z.string().optional().describe("Recipient email(s), comma-separated"),
    cc: z.string().optional().describe("CC email(s), comma-separated"),
    bcc: z.string().optional().describe("BCC email(s), comma-separated"),
    subject: z.string().optional().describe("Email subject"),
    body: z.string().optional().describe("Email body in markdown"),
    context: z.string().optional().describe("Review context/instructions"),
    status: z
      .enum(["queued", "in_review", "sent", "dismissed"])
      .optional()
      .describe("New status"),
    accountEmail: z
      .string()
      .optional()
      .describe("Connected sender account the owner should use"),
    sentMessageId: z
      .string()
      .optional()
      .describe("Sent email message ID, when marking sent"),
  }),
  run: async (args) => {
    const { id, ...updates } = args;
    return updateQueuedDraft(id, updates);
  },
});
