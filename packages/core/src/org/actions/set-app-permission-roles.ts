import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { requireOrgMember } from "../actions.js";
import {
  getAppPermissionOverrides,
  getRegisteredAppRoles,
  setAppPermissionRoles,
} from "../app-roles.js";

export default defineAction({
  description:
    "Set or reset which declared app roles grant a code-declared permission in the active organization. An empty role list denies the permission to everyone; pass reset=true to restore defaults.",
  schema: z.object({
    appId: z.string().trim().min(1).max(200),
    permission: z.string().trim().min(1).max(200),
    roles: z.array(z.string()).max(50).optional(),
    reset: z.boolean().default(false),
  }),
  audit: orgAdminAudit({
    targetType: "app-permission-roles",
    targetId: (args) => `${args.appId}:${args.permission}`,
    summary: (args, result) => {
      const change = result as { previousRoles?: string[]; roles?: string[] };
      return `${args.reset ? "Reset" : "Updated"} ${args.appId} permission ${args.permission}: [${(change.previousRoles ?? []).join(", ")}] -> [${(change.roles ?? []).join(", ")}]`;
    },
  }),
  run: async ({ appId, permission, roles, reset }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const descriptor = getRegisteredAppRoles(appId);
    if (!descriptor) throw new Error(`No app roles registered for ${appId}.`);
    if (!descriptor.permissions?.[permission])
      throw new Error(`Unknown ${appId} permission ${permission}.`);
    if (!reset && !roles) throw new Error("Provide roles or set reset=true.");
    if (roles?.some((role) => !descriptor.roles.includes(role)))
      throw new Error("The role list contains an undeclared role.");
    const overrides = await getAppPermissionOverrides(appId, caller.orgId);
    const previousRoles = overrides[permission] ?? [
      ...(descriptor.permissions[permission] ?? []),
    ];
    const nextRoles = reset
      ? [...(descriptor.permissions[permission] ?? [])]
      : [...new Set(roles!)];
    await setAppPermissionRoles({
      appId,
      orgId: caller.orgId,
      permission,
      roles: reset ? null : roles!,
      updatedBy: caller.email,
    });
    return {
      appId,
      permission,
      roles: nextRoles,
      previousRoles,
      reset,
    };
  },
});
