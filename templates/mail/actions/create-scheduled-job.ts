import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { createScheduledJobRecord } from "../server/lib/jobs.js";

export default defineAction({
  description:
    "Create a scheduled job (snooze or send_later) that runs at a future timestamp.",
  schema: z.object({
    type: z.enum(["snooze", "send_later"]).describe("Kind of scheduled job"),
    emailId: z.string().optional().describe("Email the job applies to"),
    threadId: z.string().optional().describe("Thread the job applies to"),
    accountEmail: z
      .string()
      .optional()
      .describe("Connected account the job runs against"),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Job-specific payload"),
    runAt: z.coerce.number().describe("Epoch milliseconds to run the job at"),
  }),
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!Number.isFinite(args.runAt) || args.runAt <= Date.now()) {
      throw new Error("runAt must be a future timestamp");
    }

    return createScheduledJobRecord({
      type: args.type,
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
