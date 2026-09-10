import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { approveRequest } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Approve a pending dispatch change request and apply it.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    id: z.string().describe("Approval request id"),
  }),
  run: async ({ id }) => approveRequest(id),
});
