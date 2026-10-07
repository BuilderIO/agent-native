import type { ActionRunContext } from "@agent-native/core/action";
import { defineAppRoles } from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";

import { formsAccessDescriptor } from "../../shared/app-roles.js";

export const formsAccess = defineAppRoles(formsAccessDescriptor, {
  unassignedRole: "editor",
  allowOrgAdmins: true,
});

type FormsPermission = keyof typeof formsAccessDescriptor.permissions;
type PermissionContext = Pick<ActionRunContext, "userEmail" | "orgId">;

function permissionCaller(ctx?: PermissionContext) {
  const userEmail =
    ctx?.userEmail !== undefined ? ctx.userEmail : getRequestUserEmail();
  if (!userEmail) throw new ForbiddenError();
  return {
    userEmail,
    orgId: ctx?.orgId !== undefined ? ctx.orgId : getRequestOrgId(),
  };
}

async function assertPermissionForTargets(
  permission: FormsPermission,
  targets: readonly { owned: boolean; orgId?: string | null }[],
  caller: ReturnType<typeof permissionCaller>,
) {
  const permissionOrgs = new Set<string>();
  if (!targets.length && caller.orgId) permissionOrgs.add(caller.orgId);
  for (const target of targets) {
    if (target.owned) continue;
    // A target's organization governs its roles even in personal scope.
    const orgId = target.orgId ?? caller.orgId;
    if (orgId) permissionOrgs.add(orgId);
  }
  for (const orgId of permissionOrgs)
    await formsAccess.assertPermission([permission], { ...caller, orgId });
}

// These rows must come from assertAccess or an accessFilter-scoped read.
export async function assertFormsPermissionForAccessibleForms(
  permission: FormsPermission,
  forms: readonly { ownerEmail: string; orgId: string | null }[],
  ctx?: PermissionContext,
) {
  const caller = permissionCaller(ctx);
  const email = caller.userEmail.trim().toLowerCase();
  await assertPermissionForTargets(
    permission,
    forms.map((form) => ({
      owned:
        !!email &&
        form.ownerEmail.trim().toLowerCase() === email &&
        (!form.orgId || form.orgId === caller.orgId),
      orgId: form.orgId,
    })),
    caller,
  );
}

export function requireFormsPermission(
  permission: FormsPermission,
  idFrom?: "id" | "formId" | "responseId",
) {
  return async (args: unknown, ctx?: PermissionContext): Promise<void> => {
    const caller = permissionCaller(ctx);
    const resourceCaller = {
      userEmail: caller.userEmail,
      orgId: caller.orgId ?? undefined,
    };
    const input = args as Record<string, unknown>;
    const selected =
      idFrom === "formId"
        ? (input.formId ?? input.form)
        : idFrom
          ? input[idFrom]
          : undefined;
    let ids =
      typeof selected === "string"
        ? [selected]
        : Array.isArray(selected) &&
            selected.every((id) => typeof id === "string")
          ? (selected as string[])
          : [];
    if (idFrom === "responseId" && ids.length) {
      const { getDb, schema } = await import("../db/index.js");
      const { eq } = await import("drizzle-orm");
      const [response] = await getDb()
        .select({ formId: schema.responses.formId })
        .from(schema.responses)
        .where(eq(schema.responses.id, ids[0]!))
        .limit(1);
      ids = response ? [response.formId] : [];
    }
    if (ids.length) {
      const access = await Promise.all(
        ids.map((id) => resolveAccess("form", id, resourceCaller)),
      );
      if (access.some((result) => !result)) throw new ForbiddenError();
      await assertPermissionForTargets(
        permission,
        access.map((result) => ({
          owned: result!.role === "owner",
          orgId: result!.resource.orgId,
        })),
        caller,
      );
      return;
    }
    await assertPermissionForTargets(permission, [], caller);
  };
}
