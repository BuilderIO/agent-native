import { z } from "zod";

import { defineAction } from "../../action.js";
import { checkAction } from "../../authorization/check-action.js";
import { requireOrgMember } from "../actions.js";

const resourceLevel = z.enum(["viewer", "editor", "admin", "owner"]);

export default defineAction({
  description:
    "Explain why a member can or cannot perform an app permission or resource action.",
  schema: z.object({
    appId: z.string().trim().min(1).max(200),
    permission: z.string().trim().min(1).max(200).optional(),
    email: z.string().email().optional(),
    resourceType: z.string().trim().min(1).max(100).optional(),
    resourceId: z.string().trim().min(1).max(300).optional(),
    resourceLevel: resourceLevel.optional(),
  }),
  http: { method: "POST" },
  readOnly: true,
  run: async (args, ctx) => {
    const caller = await requireOrgMember(ctx);
    const email = args.email?.trim().toLowerCase() || caller.email;
    if (email !== caller.email) await requireOrgMember(ctx, true);
    if (Boolean(args.resourceType) !== Boolean(args.resourceId)) {
      throw new Error("resourceType and resourceId must be provided together.");
    }
    const decision = await checkAction(
      {
        scope: "app",
        permission: args.permission,
        ...(args.resourceType && args.resourceId
          ? {
              resource: {
                type: args.resourceType,
                idFrom: "resourceId",
                level: args.resourceLevel,
              },
            }
          : {}),
      },
      { resourceId: args.resourceId },
      ctx,
      { appId: args.appId, orgId: caller.orgId, userEmail: email },
    );
    return {
      appId: args.appId,
      email,
      permission: args.permission ?? null,
      allowed: decision.allowed,
      reason: decision.reason,
      roles: decision.roles ?? [],
      resourceRole: decision.resourceRole ?? null,
    };
  },
});
