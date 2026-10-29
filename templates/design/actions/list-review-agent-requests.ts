import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  listReviewAgentRequests,
  reviewAgentRequestSchema,
} from "../server/lib/review-agent.js";

const errors = defineActionErrors("sign_in_required");

export default defineAction({
  description:
    "List the agent requests on a design's review threads: every active one, plus those that finished in the last 24 hours. Anyone who can view the design sees the status; the instructions and session ids are the requester's alone. Also closes requests that have been active for 30 minutes with no progress.",
  agentTool: false,
  toolCallable: false,
  http: { method: "GET" },
  // Status goes stale in seconds and carries the requester's own words.
  persistInBrowser: false,
  errors,
  schema: z.object({
    designId: z.string().min(1),
    threadId: z
      .string()
      .min(1)
      .optional()
      .describe("Only this review thread's requests."),
  }),
  outputSchema: z.object({ requests: z.array(reviewAgentRequestSchema) }),
  run: (args) => listReviewAgentRequests(args),
});
