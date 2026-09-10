import { defineAction } from "@agent-native/core/action";
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
  run: async ({ id, reason }) => rejectRequest(id, reason),
});
