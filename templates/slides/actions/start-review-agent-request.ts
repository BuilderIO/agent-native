import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  slideReviewAgentErrors,
  startSlideReviewAgentRequest,
} from "../server/lib/slide-review-agent.js";
import { slideReviewAgentRequestSchema } from "../shared/slide-review-agent.js";

export default defineAction({
  description:
    "Start one background agent run on a deck's review thread, from the comment UI only, after the requester posts a comment that tags an agent. Records the request and returns the session the browser dispatches. Deck editors only; one active request per thread. Reuse requestId only to retry the exact same submission.",
  agentTool: false,
  toolCallable: false,
  errors: slideReviewAgentErrors,
  schema: z.object({
    requestId: z
      .string()
      .uuid()
      .describe(
        "Client-made UUID. Reuse it only to retry the same submission.",
      ),
    deckId: z.string().min(1),
    threadId: z.string().min(1).describe("The review thread id."),
    triggerCommentId: z
      .string()
      .min(1)
      .describe("Your own comment on the thread that tags the agent."),
    engine: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Engine of the model the agent chip names."),
    model: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("The model the agent chip names."),
  }),
  outputSchema: z.object({
    request: slideReviewAgentRequestSchema,
    started: z.boolean(),
  }),
  run: (args) => startSlideReviewAgentRequest(args),
});
