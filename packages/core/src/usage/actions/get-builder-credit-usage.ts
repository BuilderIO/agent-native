import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBuilderCreditUsage } from "../../server/fusion-app.js";
import { ForbiddenError } from "../../sharing/access.js";
import { canViewWorkspaceUsage } from "../metrics-store.js";

export default defineAction({
  description:
    "Get the connected Builder workspace's available credits and active daily or monthly plan limit.",
  http: { method: "GET" },
  schema: z.object({}),
  run: async (_input, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    if (
      !(await canViewWorkspaceUsage({
        ownerEmail: ctx.userEmail,
        orgId: ctx.orgId,
      }))
    ) {
      throw new ForbiddenError(
        "Only organization owners and admins can view workspace credit usage.",
      );
    }
    return getBuilderCreditUsage();
  },
});
