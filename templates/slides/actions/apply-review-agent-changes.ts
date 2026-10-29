import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  applySlideReviewAgentChanges,
  slideReviewAgentErrors,
} from "../server/lib/slide-review-agent.js";
import { slideReviewAgentRequestSchema } from "../shared/slide-review-agent.js";

export default defineAction({
  description:
    "Finish a comment-started run after you changed the deck with update-slide, patch-deck or add-slide: posts your summary in the thread as the agent, resolves the thread, and ends the request. Call it only once the edits are saved. Only available inside a comment-started agent run.",
  http: false,
  mcpTool: false,
  retrySafe: true,
  errors: slideReviewAgentErrors,
  schema: z.object({
    summary: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe(
        "One or two sentences on what you changed, for the person who tagged you.",
      ),
    resolve: z
      .boolean()
      .optional()
      .describe(
        "Defaults to true. False keeps the thread open after replying.",
      ),
  }),
  outputSchema: z.object({
    request: slideReviewAgentRequestSchema,
    commentId: z.string(),
    resolved: z.boolean(),
  }),
  run: (args, ctx) => applySlideReviewAgentChanges(args, ctx),
});
