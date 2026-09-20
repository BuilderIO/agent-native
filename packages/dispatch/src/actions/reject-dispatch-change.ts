import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { rejectRequest } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Reject a pending dispatch change request.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    id: z.string().describe("Approval request id"),
    reason: z.string().optional().describe("Optional rejection reason"),
  }),
  run: async ({ id, reason }, ctx) => {
    const result = await rejectRequest(id, reason);
    track(
      "approval_actioned",
      {
        app_name: "dispatch",
        template_name: "dispatch",
        action_type: result.changeType,
        decision: "rejected",
      },
      ctx,
    );
    return result;
  },
});
