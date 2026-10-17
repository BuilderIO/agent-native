import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { approveRequest } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Approve a pending dispatch change request and apply it.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    id: z.string().describe("Approval request id"),
  }),
  run: async ({ id }, ctx) => {
    const result = await approveRequest(id);
    track(
      "approval_actioned",
      {
        app_name: "dispatch",
        template_name: "dispatch",
        action_type: result.changeType,
        decision: "approved",
      },
      ctx,
    );
    return result;
  },
});
