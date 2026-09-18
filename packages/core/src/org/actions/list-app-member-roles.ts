import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireOrgMember } from "../actions.js";
import { listAppMemberRoles, getRegisteredAppRoles } from "../app-roles.js";

export default defineAction({
  description:
    "List the declared app roles and current member assignments for an app in the active organization.",
  http: { method: "GET" },
  schema: z.object({ appId: z.string().trim().min(1).max(200) }),
  run: async ({ appId }, ctx) => {
    const caller = await requireOrgMember(ctx);
    const descriptor = getRegisteredAppRoles(appId);
    if (!descriptor) throw new Error(`No app roles registered for ${appId}.`);
    return {
      appId,
      roles: descriptor.roles,
      permissions: descriptor.permissions ?? {},
      permissionLabels: descriptor.permissionLabels ?? {},
      assignments: await listAppMemberRoles(appId, caller.orgId),
    };
  },
});
