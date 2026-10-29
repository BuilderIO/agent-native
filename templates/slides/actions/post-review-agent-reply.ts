import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  postSlideReviewAgentReply,
  slideReviewAgentErrors,
} from "../server/lib/slide-review-agent.js";
import { slideReviewAgentRequestSchema } from "../shared/slide-review-agent.js";

export default defineAction({
  description:
    "Post one reply on the review thread as the agent and finish the request, without changing the deck. With needsInput it asks the person who tagged you one question instead, and the thread goes back to them. Only available inside a comment-started agent run.",
  http: false,
  mcpTool: false,
  // The comment id comes from the request, so a repeated call posts once.
  retrySafe: true,
  errors: slideReviewAgentErrors,
  schema: z.object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(6_000)
      .describe(
        "Your reply, as inline Markdown with no headings. Plain, short, specific.",
      ),
    needsInput: z
      .boolean()
      .optional()
      .describe("True to ask one question instead of answering."),
  }),
  outputSchema: z.object({
    request: slideReviewAgentRequestSchema,
    commentId: z.string(),
  }),
  run: (args, ctx) => postSlideReviewAgentReply(args, ctx),
});
