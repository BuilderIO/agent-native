import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { commercialSurfacesHidden } from "../../client/app-config.js";
import { getBuilderCreditUsage } from "../../server/fusion-app.js";
import { ForbiddenError } from "../../sharing/access.js";
import { canViewWorkspaceUsage } from "../metrics-store.js";

export default defineAction({
  description:
    "Get the connected Builder workspace's available credits and active daily or monthly plan limit.",
  http: { method: "GET" },
  schema: z.object({}),
  mcpTool: false,
  run: async (_input, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    if (commercialSurfacesHidden()) {
      fail("Builder credit usage is not available on this deployment.", {
        errorCode: "builder_credits_hidden",
        statusCode: 404,
      });
    }
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
