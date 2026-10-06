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

export function requireFormsPermission(
  permission: keyof typeof formsAccessDescriptor.permissions,
  idFrom?: "id" | "formId" | "responseId",
) {
  return async (args: unknown, ctx?: ActionRunContext): Promise<void> => {
    const caller = {
      userEmail:
        ctx?.userEmail !== undefined ? ctx.userEmail : getRequestUserEmail(),
      orgId: ctx?.orgId !== undefined ? ctx.orgId : getRequestOrgId(),
    };
    if (!caller.userEmail)
      throw new ForbiddenError("An authenticated user is required.");
    // Personal deployments have no app-role roster; row access still governs them.
    if (!caller.orgId) return;
    const resourceCaller = { userEmail: caller.userEmail, orgId: caller.orgId };
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
      if (access.every((result) => result?.role === "owner")) return;
    }
    await formsAccess.assertPermission([permission], caller);
  };
}
