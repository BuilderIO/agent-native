import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listSlideReviewAgentRequests,
  slideReviewAgentErrors,
} from "../server/lib/slide-review-agent.js";
import { slideReviewAgentRequestSchema } from "../shared/slide-review-agent.js";

export default defineAction({
  description:
    "List agent requests on a deck's review threads: every active one, plus those that finished in the last 24 hours. Anyone who can view the deck sees the status; the dispatch session is the requester's alone. Also fails requests that made no progress for 30 minutes.",
  agentTool: false,
  toolCallable: false,
  http: { method: "GET" },
  // Status goes stale in seconds.
  persistInBrowser: false,
  errors: slideReviewAgentErrors,
  schema: z.object({
    deckId: z.string().min(1),
    threadId: z
      .string()
      .min(1)
      .optional()
      .describe("Only this review thread's requests."),
  }),
  outputSchema: z.object({ requests: z.array(slideReviewAgentRequestSchema) }),
  run: (args) => listSlideReviewAgentRequests(args),
});
