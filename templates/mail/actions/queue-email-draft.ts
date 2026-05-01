import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createQueuedDraft } from "../server/lib/queued-drafts.js";

export default defineAction({
  description:
    "Queue an email draft for an organization member to review, edit, and send. Returns reviewUrl for a direct link to the queued draft. Use this for Slack or teammate requests instead of sending directly.",
  schema: z.object({
    ownerEmail: z
      .string()
      .describe(
        "Organization member who should review/send the draft. Email is best; an unambiguous email prefix also works.",
      ),
    to: z.string().describe("Recipient email(s), comma-separated"),
    cc: z.string().optional().describe("CC email(s), comma-separated"),
    bcc: z.string().optional().describe("BCC email(s), comma-separated"),
    subject: z.string().describe("Email subject"),
    body: z
      .string()
      .describe("Draft body in markdown. The owner can edit before sending."),
    context: z
      .string()
      .optional()
      .describe("Optional request context or instructions for the owner"),
    source: z
      .enum(["agent", "slack", "ui", "api"])
      .optional()
      .describe("Where this queue request came from"),
    sourceThreadId: z
      .string()
      .optional()
      .describe("Optional Slack/thread identifier for traceability"),
    requesterName: z
      .string()
      .optional()
      .describe("Optional display name of the person requesting the draft"),
    accountEmail: z
      .string()
      .optional()
      .describe("Optional connected sender account the owner should use"),
  }),
  run: async (args) => {
    return createQueuedDraft(args);
  },
});
