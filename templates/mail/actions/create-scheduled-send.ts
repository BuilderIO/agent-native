import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { requiresEmailSendApproval } from "../server/lib/automation-settings.js";
import { createScheduledJobRecord } from "../server/lib/jobs.js";

export default defineAction({
  description:
    "Schedule an email send for a future timestamp. Interactive and external calls require approval; automations may opt in through Mail settings.",
  schema: z.object({
    emailId: z
      .string()
      .optional()
      .describe("Draft or email the job applies to"),
    threadId: z.string().optional().describe("Thread the job applies to"),
    accountEmail: z
      .string()
      .optional()
      .describe("Connected account the job runs against"),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Scheduled email payload"),
    runAt: z.coerce.number().describe("Epoch milliseconds to run the job at"),
  }),
  needsApproval: (_args, ctx?: ActionRunContext) =>
    requiresEmailSendApproval(ctx),
  run: async (args, ctx) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!Number.isFinite(args.runAt) || args.runAt <= Date.now()) {
      throw new Error("runAt must be a future timestamp");
    }
    if (
      ctx?.caller === "automation" &&
      (await requiresEmailSendApproval(ctx))
    ) {
      throw new Error(
        "Automation email sending is disabled. Enable it in Mail settings to schedule automatically.",
      );
    }

    return createScheduledJobRecord({
      type: "send_later",
      ownerEmail,
      emailId: args.emailId ?? null,
      threadId: args.threadId ?? null,
      accountEmail:
        args.accountEmail ??
        (args.payload?.accountEmail as string | undefined) ??
        null,
      payload: args.payload,
      runAt: args.runAt,
    });
  },
});
