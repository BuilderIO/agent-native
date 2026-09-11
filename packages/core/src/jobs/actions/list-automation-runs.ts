import { z } from "zod";

import { defineAction } from "../../action.js";
import { organizationResourceOwner } from "../../resources/store.js";
import { listAutomationRuns, type AutomationRun } from "../run-history.js";

const scopeSchema = z.enum(["personal", "organization"]);

export default defineAction({
  description:
    "List past execution records for one automation or recurring job in the selected scope.",
  agentTool: false,
  schema: z.object({
    name: z.string().min(1),
    scope: scopeSchema.default("personal"),
    appId: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (
    { name, scope, appId: requestedAppId, limit },
    ctx,
  ): Promise<AutomationRun[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    if (scope === "organization" && !ctx?.orgId) return [];

    const owner =
      scope === "organization"
        ? organizationResourceOwner(ctx.orgId as string)
        : userEmail;

    const appId = ctx?.appId === "dispatch" ? requestedAppId : ctx?.appId;
    return listAutomationRuns({
      owners: [owner],
      automation: name,
      appId,
      limit,
    });
  },
});
