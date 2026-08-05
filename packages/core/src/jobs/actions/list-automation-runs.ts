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
      resourceId: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      scope: scopeSchema.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .refine((input) => input.resourceId || (input.name && input.scope), {
      message: "resourceId or name and scope is required.",
    }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (
    { resourceId, name, scope, limit },
    ctx,
  ): Promise<AutomationRun[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");

    let resolvedId = resourceId?.trim();
    if (!resolvedId) {
      if (!name || !scope) {
        throw Object.assign(
          new Error("resourceId or name and scope is required."),
          { statusCode: 400 },
        );
      }
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
    return listAutomationRuns({
      owners: [access.resource.owner],
      automation: access.name,
      limit,
    });
  },
});
