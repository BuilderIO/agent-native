import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { reviewAgentMachine } from "../server/lib/review-agent-machine.js";
import {
  loadReviewAgentRequest,
  pendingSessionFor,
  refuse,
  requireRequesterEmail,
  requireScopedRequest,
  reviewAgentIntentSchema,
  reviewAgentPendingSessionSchema,
  reviewAgentRequestSchema,
  reviewAgentScreenFacts,
  serializeReviewAgentRequest,
  transitionReviewAgentRequest,
  type ReviewAgentRow,
} from "../server/lib/review-agent.js";
import { isReviewAgentActive } from "../shared/review-agent.js";

const errors = defineActionErrors(
  "sign_in_required",
  "scope_required",
  "scope_mismatch",
  "binding_missing",
  "request_not_active",
  "thread_unavailable",
  "operation_conflict",
  "apply_unavailable",
);

const schema = z.object({
  intent: reviewAgentIntentSchema.describe(
    'How to respond: "reply" answers in the thread, "suggest" proposes changes without making them, "apply-resolve" changes the screen and resolves the thread.',
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
    "Record how an agent should respond to a review comment: reply, suggest, or apply-resolve. Call it exactly once, in the classification step of a comment-started agent run. Only available in that step.",
  http: false,
  mcpTool: false,
  // The same answer again replays; a different one is refused.
  retrySafe: true,
  errors,
  schema,
  agentInputSchema: schema.omit({ requestId: true }),
  outputSchema: z.object({
    request: reviewAgentRequestSchema,
    pendingSession: reviewAgentPendingSessionSchema.nullable(),
  }),
  run: async (args, ctx) => {
    const email = requireRequesterEmail();
    const { row, design } = await requireScopedRequest({
      ctx,
      phase: "classification",
      argsRequestId: args.requestId,
    });
    const answer = (current: ReviewAgentRow) => ({
      request: serializeReviewAgentRequest(current, email),
      pendingSession: pendingSessionFor(current),
    });

    if (reviewAgentMachine.parseState(row.status) !== "classifying") {
      // Already classified: the same answer again is a replay, another is not.
      if (row.intent === args.intent) return answer(row);
      return refuse(
        "operation_conflict",
        "A different classification already won this request.",
        409,
      );
    }
    if (args.intent === "apply-resolve") {
      const { capabilities } = await reviewAgentScreenFacts(
        design,
        row.screenId,
      );
      if (!capabilities.canApply) {
        return errors.fail(
          "An agent cannot edit this screen. Choose reply or suggest.",
          "apply_unavailable",
          { statusCode: 400 },
        );
      }
    }

    const classified = await transitionReviewAgentRequest(row, "classified", {
      intent: args.intent,
    });
    if (classified) return answer(classified);
    const current = await loadReviewAgentRequest(row.id);
    if (
      current.intent === args.intent &&
      isReviewAgentActive(reviewAgentMachine.parseState(current.status))
    ) {
      return answer(current);
    }
    return refuse(
      "operation_conflict",
      "A different classification already won this request.",
      409,
    );
  },
});
