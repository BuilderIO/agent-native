import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { reviewAgentMachine } from "../server/lib/review-agent-machine.js";
import {
  loadReviewAgentRequest,
  parseReviewAgentResult,
  postReviewAgentComment,
  refuse,
  requireRequesterEmail,
  requireScopedRequest,
  reviewAgentRequestSchema,
  serializeReviewAgentRequest,
  serializeResult,
  transitionReviewAgentRequest,
} from "../server/lib/review-agent.js";
import { REVIEW_AGENT_INTENTS } from "../shared/review-agent.js";

const errors = defineActionErrors(
  "sign_in_required",
  "scope_required",
  "scope_mismatch",
  "binding_missing",
  "not_classified",
  "request_not_active",
  "intent_not_permitted",
  "thread_unavailable",
);

const schema = z.object({
  body: z
    .string()
    .trim()
    .min(1)
    .max(6_000)
    .describe(
      "Your reply, as inline Markdown with no headings. Write for a designer: plain, short, specific.",
    ),
  needsInput: z
    .boolean()
    .optional()
    .describe(
      "True to ask the requester one question instead of answering. The thread is routed to a person and the request stops with needs-input. Required for any intent other than reply.",
    ),
  requestId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Local development shell only. Leave it out inside an agent run.",
    ),
});

export default defineAction({
  description:
    "Post one reply on the review thread as the AI agent, and finish the request. With needsInput it asks the requester a question instead. Only available in comment-started agent runs; a suggest or apply-resolve run may use it only to ask a question.",
  http: false,
  mcpTool: false,
  // The comment id comes from the request, so a repeated call posts once.
  retrySafe: true,
  errors,
  schema,
  agentInputSchema: schema.omit({ requestId: true }),
  outputSchema: z.object({
    request: reviewAgentRequestSchema,
    commentId: z.string(),
  }),
  run: async (args, ctx) => {
    const email = requireRequesterEmail();
    const needsInput = args.needsInput === true;
    const { row, run, replay } = await requireScopedRequest({
      ctx,
      phase: "execution",
      // Answering is the reply intent's job; the others may only ask.
      intents: needsInput ? REVIEW_AGENT_INTENTS : ["reply"],
      argsRequestId: args.requestId,
      replayStatuses: needsInput ? ["needs-input"] : ["replied"],
    });
    if (replay) {
      const posted = parseReviewAgentResult(row)?.replyCommentId;
      if (!posted) {
        return refuse(
          "request_not_active",
          "This agent request already ended.",
          409,
        );
      }
      return {
        request: serializeReviewAgentRequest(row, email),
        commentId: posted,
      };
    }

    const { commentId } = await postReviewAgentComment({
      row,
      ctx,
      run,
      kind: "reply",
      body: args.body,
      routeToHuman: needsInput,
    });
    const result = {
      ...parseReviewAgentResult(row),
      replyCommentId: commentId,
    };
    const finished = await transitionReviewAgentRequest(
      row,
      needsInput ? "needInput" : "reply",
      { resultJson: serializeResult(result), errorCode: null, error: null },
    );
    if (!finished) {
      // Cancel won while the comment was being posted; the comment stays.
      const current = await loadReviewAgentRequest(row.id);
      if (reviewAgentMachine.parseState(current.status) === "cancelled") {
        return refuse(
          "request_not_active",
          "This agent request was cancelled.",
          409,
        );
      }
      return {
        request: serializeReviewAgentRequest(current, email),
        commentId,
      };
    }
    return {
      request: serializeReviewAgentRequest(finished, email),
      commentId,
    };
  },
});
