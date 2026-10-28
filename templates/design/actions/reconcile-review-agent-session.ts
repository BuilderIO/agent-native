import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  reconcileReviewAgentRun,
  requireRequesterEmail,
  reviewAgentRequestSchema,
  serializeReviewAgentRequest,
} from "../server/lib/review-agent.js";

const errors = defineActionErrors("sign_in_required", "request_not_found");

export default defineAction({
  description:
    "Close an agent request whose run ended without finishing it, from the comment UI. Fallback for the server's own finalizer: the requester only, and it can only produce failed, cancelled or needs-input, never a success. A request that already finished comes back unchanged.",
  agentTool: false,
  toolCallable: false,
  errors,
  schema: z.object({
    requestId: z.string().uuid(),
    phase: z.enum(["classification", "execution"]),
    status: z
      .enum(["errored", "aborted", "completed", "truncated"])
      .describe("How the run ended."),
    runId: z.string().min(1).max(200).optional(),
    terminalReason: z
      .string()
      .max(500)
      .optional()
      .describe("Accepted for diagnostics; not stored."),
    errorCode: z
      .enum(["engine_not_configured", "dispatch_failed"])
      .optional()
      .describe(
        'Why no run started, when status is "errored" because dispatch itself failed.',
      ),
  }),
  outputSchema: z.object({ request: reviewAgentRequestSchema }),
  run: async (args) => {
    const email = requireRequesterEmail();
    const row = await reconcileReviewAgentRun({
      requestId: args.requestId,
      phase: args.phase,
      status: args.status,
      runId: args.runId,
      clientErrorCode: args.errorCode,
      requesterEmail: email,
    });
    return { request: serializeReviewAgentRequest(row, email) };
  },
});
