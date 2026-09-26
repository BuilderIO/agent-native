import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { requireOrgMember } from "../actions.js";
import {
  getRegisteredAppRoles,
  listAppMemberRoles,
  setAppMemberRoles,
} from "../app-roles.js";
import { isOrgMember } from "../membership.js";

export default defineAction({
  description:
    "Replace a member's assigned roles for one app. Only organization owners and admins may manage app roles.",
  schema: z.object({
    appId: z.string().trim().min(1).max(200),
    email: z.string().email(),
    roles: z.array(z.string()).max(50),
  }),
  audit: orgAdminAudit({
    targetType: "app-member-roles",
    targetId: (args) => `${args.appId}:${args.email.toLowerCase()}`,
    summary: (args, result) => {
      const change = result as { previousRoles?: string[]; roles?: string[] };
      return `Updated ${args.appId} roles for ${args.email}: [${(change.previousRoles ?? []).join(", ")}] -> [${(change.roles ?? []).join(", ")}]`;
    },
  }),
  run: async ({ appId, email, roles }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const descriptor = getRegisteredAppRoles(appId);
    if (!descriptor) throw new Error(`No app roles registered for ${appId}.`);
    if (roles.some((role) => !descriptor.roles.includes(role)))
      throw new Error("The role list contains an undeclared role.");
    if (!(await isOrgMember(caller.orgId, email)))
      throw new Error("Target must be a member of the active organization.");
    const previousRoles =
      (await listAppMemberRoles(appId, caller.orgId)).find(
        (assignment) => assignment.email.toLowerCase() === email.toLowerCase(),
      )?.roles ?? [];
    const assigned = [...new Set(roles)];
    await setAppMemberRoles({
      appId,
      orgId: caller.orgId,
      email,
      roles: assigned,
      updatedBy: caller.email,
    });
    return { appId, email, roles: assigned, previousRoles };
  },
});
