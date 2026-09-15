import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { requiresEmailSendApproval } from "../server/lib/automation-settings.js";
import { isValidAddressList } from "../server/lib/email-address-validation.js";
import {
  createScheduledJobRecord,
  resolveScheduledSendAccountEmail,
} from "../server/lib/jobs.js";

const attachmentSchema = z.object({
  id: z.string().optional(),
  filename: z.string().min(1),
  originalName: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().nonnegative().optional(),
  url: z.string().optional(),
  source: z.enum(["upload", "gmail"]).optional(),
  gmailMessageId: z.string().optional(),
  gmailAttachmentId: z.string().optional(),
  accountEmail: z.string().optional(),
});

const sendLaterPayloadSchema = z.object({
  to: z.string().min(1).describe("Recipient email(s), comma-separated"),
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Email body in markdown"),
  cc: z.string().optional().describe("CC email(s), comma-separated"),
  bcc: z.string().optional().describe("BCC email(s), comma-separated"),
  from: z.string().optional().describe("Sender identity"),
  accountEmail: z
    .string()
    .optional()
    .describe("Connected account the scheduled send runs against"),
  replyToId: z.string().optional().describe("Message ID being replied to"),
  threadId: z.string().optional().describe("Thread ID for reply grouping"),
  attachments: z
    .array(attachmentSchema)
    .optional()
    .describe("Previously uploaded attachments to include"),
});

export default defineAction({
  description:
    "Schedule an email send for a future timestamp. The payload must include to, subject, and body; it may also include recipients, a connected account, reply/thread metadata, and uploaded attachments. Interactive and external calls require approval; automations may opt in through Mail settings.",
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
    payload: sendLaterPayloadSchema.describe(
      "Complete scheduled email payload, including recipient, subject, and markdown body",
    ),
    runAt: z.coerce.number().describe("Epoch milliseconds to run the job at"),
  }),
  needsApproval: (_args, ctx?: ActionRunContext) =>
    requiresEmailSendApproval(ctx),
  run: async (args, ctx) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("Unauthenticated", { errorCode: "unauthenticated" });
    if (!Number.isFinite(args.runAt) || args.runAt <= Date.now()) {
      fail("runAt must be a future timestamp", {
        errorCode: "invalid_run_at",
      });
    }
    if (
      ctx?.caller === "automation" &&
      (await requiresEmailSendApproval(ctx))
    ) {
      fail(
        "Automation email sending is disabled. Enable it in Mail settings to schedule automatically.",
        { errorCode: "automation_send_disabled" },
      );
    }

    const rawPayload = args.payload as unknown;
    const payloadRecord =
      rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : undefined;
    const requestedAccount = [
      args.accountEmail,
      payloadRecord?.accountEmail,
      payloadRecord?.from,
    ].find((value) => value !== undefined && value !== null && value !== "");
    if (
      requestedAccount !== undefined &&
      typeof requestedAccount !== "string"
    ) {
      fail("Selected Gmail account must be an email address.", {
        errorCode: "invalid_account",
      });
    }

    const rawTo = payloadRecord?.to;
    const rawCc = payloadRecord?.cc;
    const rawBcc = payloadRecord?.bcc;
    if (
      (rawTo !== undefined &&
        (typeof rawTo !== "string" ||
          !rawTo.trim() ||
          !isValidAddressList(rawTo))) ||
      (rawCc !== undefined && !isValidAddressList(rawCc)) ||
      (rawBcc !== undefined && !isValidAddressList(rawBcc))
    ) {
      fail("Invalid recipient address", { errorCode: "invalid_recipient" });
    }

    const payloadResult = sendLaterPayloadSchema.safeParse(args.payload);
    if (!payloadResult.success) {
      fail("Scheduled email payload is incomplete or invalid.", {
        errorCode: "invalid_payload",
        details: {
          fields: payloadResult.error.issues.map((issue) =>
            issue.path.join("."),
          ),
        },
      });
    }
    const payload = payloadResult.data;
    if (
      !payload.to.trim() ||
      !isValidAddressList(payload.to) ||
      (payload.cc !== undefined && !isValidAddressList(payload.cc)) ||
      (payload.bcc !== undefined && !isValidAddressList(payload.bcc))
    ) {
      fail("Invalid recipient address", { errorCode: "invalid_recipient" });
    }

    const accountEmail = await resolveScheduledSendAccountEmail(
      ownerEmail,
      requestedAccount as string | undefined,
    );
    const persistedPayload = { ...payload, accountEmail };

    return createScheduledJobRecord({
      type: "send_later",
      ownerEmail,
      emailId: args.emailId ?? null,
      threadId: args.threadId ?? payload.threadId ?? null,
      accountEmail: accountEmail ?? null,
      payload: persistedPayload,
      runAt: args.runAt,
    });
  },
});
