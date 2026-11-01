import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  cancelReviewAgentRequest,
  reviewAgentRequestSchema,
} from "../server/lib/review-agent.js";

const errors = defineActionErrors(
  "sign_in_required",
  "request_not_found",
  "operation_conflict",
);

export default defineAction({
  description:
    "Stop an agent request from the comment UI. The requester only. Takes effect at the next agent action even if the run is slow to abort, and returns the session receipt the browser uses to abort the run. A request that already finished comes back unchanged. If the design was already edited the request becomes needs-input, not cancelled.",
  agentTool: false,
  toolCallable: false,
  errors,
  schema: z.object({ requestId: z.string().uuid() }),
  outputSchema: z.object({
    request: reviewAgentRequestSchema,
    receipt: z.object({ threadId: z.string(), turnId: z.string() }).nullable(),
    changed: z.boolean(),
  }),
  run: (args) => cancelReviewAgentRequest(args),
});
