import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  cancelSlideReviewAgentRequest,
  slideReviewAgentErrors,
} from "../server/lib/slide-review-agent.js";
import { slideReviewAgentRequestSchema } from "../shared/slide-review-agent.js";

export default defineAction({
  description:
    "Stop an agent request from the comment UI. The requester only. Returns the session receipt the browser uses to abort the run; a request that already finished comes back unchanged. Slide edits the agent already made stay in the deck and can be undone from version history.",
  agentTool: false,
  toolCallable: false,
  errors: slideReviewAgentErrors,
  schema: z.object({
    requestId: z.string().uuid(),
    failure: z
      .enum(["dispatch_failed", "engine_not_configured"])
      .optional()
      .describe(
        "Set when the browser could not start the run: the request fails instead of being cancelled.",
      ),
  }),
  outputSchema: z.object({
    request: slideReviewAgentRequestSchema,
    receipt: z.object({ threadId: z.string(), turnId: z.string() }).nullable(),
    changed: z.boolean(),
  }),
  run: (args) => cancelSlideReviewAgentRequest(args),
});
