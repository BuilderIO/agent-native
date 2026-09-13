import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { requiresEmailSendApproval } from "../server/lib/automation-settings.js";
import { isValidAddressList } from "../server/lib/email-address-validation.js";
import {
  createScheduledJobRecord,
  resolveScheduledSendAccountEmail,
} from "../server/lib/jobs.js";

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
    if (args.payload) {
      const { to, cc, bcc } = args.payload;
      if (
        typeof to !== "string" ||
        !to.trim() ||
        !isValidAddressList(to) ||
        (cc !== undefined &&
          (typeof cc !== "string" || !isValidAddressList(cc))) ||
        (bcc !== undefined &&
          (typeof bcc !== "string" || !isValidAddressList(bcc)))
      ) {
        throw new Error("Invalid recipient address");
      }
    }
    if (
      ctx?.caller === "automation" &&
      (await requiresEmailSendApproval(ctx))
    ) {
      throw new Error(
        "Automation email sending is disabled. Enable it in Mail settings to schedule automatically.",
      );
    }

    const requestedAccount = [
      args.accountEmail,
      args.payload?.accountEmail,
      args.payload?.from,
    ].find((value) => value !== undefined && value !== null && value !== "");
    if (
      requestedAccount !== undefined &&
      typeof requestedAccount !== "string"
    ) {
      throw new Error("Selected Gmail account must be an email address.");
    }
    const accountEmail = await resolveScheduledSendAccountEmail(
      ownerEmail,
      requestedAccount as string | undefined,
    );
    const payload = args.payload
      ? { ...args.payload, accountEmail }
      : undefined;

    return createScheduledJobRecord({
      type: "send_later",
      ownerEmail,
      emailId: args.emailId ?? null,
      threadId: args.threadId ?? null,
      accountEmail: accountEmail ?? null,
      payload,
      runAt: args.runAt,
    });
  },
});
