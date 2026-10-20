import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveAutomationAccess } from "../../automations/access.js";
import {
  organizationResourceOwner,
  resourceGetByPath,
} from "../../resources/store.js";
import { listAutomationRuns, type AutomationRun } from "../run-history.js";

const scopeSchema = z.enum(["personal", "organization"]);

export default defineAction({
  description:
    "List past execution records for an accessible automation or recurring job by stable resourceId. Name and scope remain compatibility inputs.",
  agentTool: false,
  schema: z
    .object({
      resourceId: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      scope: scopeSchema.default("personal"),
      appId: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .refine(({ resourceId, name }) => Boolean(resourceId) !== Boolean(name), {
      message: "Specify either a resourceId or a name and scope.",
    }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (
    { resourceId, name, scope, appId: requestedAppId, limit },
    ctx,
  ): Promise<AutomationRun[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");

    let resolvedId = resourceId;
    if (!resolvedId && name) {
      if (scope === "organization" && !ctx?.orgId) {
        throw Object.assign(new Error("Automation not found."), {
          statusCode: 404,
        });
      }
      const owner =
        scope === "organization"
          ? organizationResourceOwner(ctx.orgId as string)
          : userEmail;
      const resource = await resourceGetByPath(owner, `jobs/${name}.md`);
      resolvedId = resource?.id;
    }

    const access = resolvedId
      ? await resolveAutomationAccess({ userEmail }, resolvedId)
      : null;
    if (!access) {
      throw Object.assign(new Error("Automation not found."), {
        statusCode: 404,
      });
    }

    const appId = ctx?.appId === "dispatch" ? requestedAppId : ctx?.appId;
    return listAutomationRuns({
      owners: [access.resource.owner],
      automation: access.name,
      appId,
      limit,
    });
  },
});
