import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  assertEmailReady,
  parseEmailAddresses,
  sendWorkflowEmail,
} from "../server/connectors/email-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { failWorkflowAction } from "../server/lib/workflow-action-errors.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Send one email for a workflow through the workspace email sender, from the configured sender address. to may list up to 10 addresses separated by commas; each gets its own message, and cc is then not allowed. The body is markdown. Returns messageRef, the idempotency key sent to the provider. When no sender is configured the error is email_not_configured and names what to save. When the error code ends in _outcome_unknown the email may have been sent, so check before sending again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    to: z.string().trim().min(1).max(2_000),
    subject: z.string().trim().min(1).max(EMAIL_SUBJECT_MAX),
    body: z.string().trim().min(1).max(EMAIL_BODY_MAX),
    cc: z.string().trim().max(2_000).optional(),
    replyTo: z.string().trim().max(320).optional(),
  }),
  http: false,
  mcpTool: false,
  audit: {
    target: (_args: unknown, result: unknown) => ({
      type: "email",
      id: (result as { messageRef?: string } | undefined)?.messageRef,
      visibility: "org",
    }),
    summary: (args: { subject: string }) => `Sent the email "${args.subject}"`,
  },
  run: async (
    { factoryId: requestedFactoryId, to, subject, body, cc, replyTo },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const recipients = parseEmailAddresses(to, "to");
    const copies = parseEmailAddresses(cc, "cc");
    const replyToAddress = parseEmailAddresses(replyTo, "replyTo");
    if (recipients.length === 0) {
      failWorkflowAction({
        message: "to has no email address.",
        errorCode: "email_recipient_invalid",
        statusCode: 400,
      });
    }
    if (copies.length > 0 && recipients.length > 1) {
      failWorkflowAction({
        message:
          "cc is only allowed with a single to address, because each to address is sent its own message.",
        errorCode: "email_recipient_invalid",
        statusCode: 400,
      });
    }
    if (replyToAddress.length > 1) {
      failWorkflowAction({
        message: "replyTo is one address.",
        errorCode: "email_recipient_invalid",
        statusCode: 400,
      });
    }
    await assertEmailReady();
    const result = await sendWorkflowEmail({
      to: recipients,
      cc: copies,
      replyTo: replyToAddress[0],
      subject,
      body,
      identity: {
        orgId: caller.orgId,
        factoryId: caller.factoryId,
        automationId: context?.automation?.triggerId,
        runId: context?.runId,
        callId: context?.toolCallId,
      },
    });
    return { ok: true as const, ...result };
  },
});
