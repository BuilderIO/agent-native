import { z } from "zod";

import { defineAction } from "../../action.js";
import { queueAutomationRunNow } from "../run-now.js";

export default defineAction({
  description:
    "Run one automation by stable resourceId. Collaborators may queue it, but execution always uses the automation's immutable creator identity. Name and scope remain compatibility inputs.",
  agentTool: false,
  schema: z
    .object({
      resourceId: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      scope: z.enum(["personal", "organization"]).optional(),
    })
    .refine((input) => input.resourceId || (input.name && input.scope), {
      message: "resourceId or name and scope is required.",
    }),
  run: async ({ resourceId, name, scope }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return queueAutomationRunNow({
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
      resourceId,
      scope,
      name,
    });
  },
});
