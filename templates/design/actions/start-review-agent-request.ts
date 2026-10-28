import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  reviewAgentModeSchema,
  startReviewAgentRequest,
  startReviewAgentResultSchema,
} from "../server/lib/review-agent.js";

const errors = defineActionErrors(
  "sign_in_required",
  "request_not_found",
  "thread_not_open",
  "thread_too_large",
  "trigger_comment_required",
  "trigger_comment_not_found",
  "trigger_not_requesters",
  "no_agent_mention",
  "instructions_empty",
  "instructions_too_long",
  "rate_limited",
  "operation_conflict",
  "apply_unavailable",
  "thread_unavailable",
);

export default defineAction({
  description:
    "Start one background agent request on a review thread, from the comment UI only. Records the request, then returns the session the browser must dispatch (the classification session when mode is auto, else the execution one). Editors only; one active request per thread. Reuse requestId only to retry the exact same submission.",
  agentTool: false,
  toolCallable: false,
  errors,
  schema: z.object({
    requestId: z
      .string()
      .uuid()
      .describe(
        "Client-made UUID. Reuse it only to retry the exact same submission.",
      ),
    designId: z.string().min(1),
    threadId: z.string().min(1).describe("The review thread id."),
    mode: reviewAgentModeSchema.describe(
      'How to respond: "auto" lets the agent pick, or "reply", "suggest", "apply-resolve".',
    ),
    triggerCommentId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Required when mode is "auto": your own comment that mentions the agent.',
      ),
    provider: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    engine: z.string().trim().min(1).max(80).optional(),
  }),
  outputSchema: startReviewAgentResultSchema,
  run: (args) => startReviewAgentRequest(args),
});
