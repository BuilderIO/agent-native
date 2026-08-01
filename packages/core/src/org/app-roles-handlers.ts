import {
  defineEventHandler,
  getRequestURL,
  createError,
  type H3Event,
} from "h3";

import { readBody } from "../server/h3-helpers.js";
import {
  getRegisteredAppRoles,
  listAppMemberRoles,
  setAppMemberRole,
  type AppRolesDescriptor,
} from "./app-roles.js";
import { getOrgContext } from "./context.js";
import { isOrgMember } from "./membership.js";
import { canManageOrg } from "./permissions.js";

/**
 * Resolve the descriptor a request is talking about.
 *
 * The `appId` arrives from the client but can only ever select among
 * descriptors the server already declared through `defineAppRoles`; an
 * unregistered id is a 404, never an implicit new app. That keeps the trusted
 * vocabulary in app source while still letting one workspace host several apps.
 */
function requireDescriptor(appId: string | null): AppRolesDescriptor<string> {
  if (!appId?.trim()) {
    throw createError({ statusCode: 400, message: "appId is required" });
  }
  const descriptor = getRegisteredAppRoles(appId.trim());
  if (!descriptor) {
    throw createError({
      statusCode: 404,
      message: `No app roles registered for "${appId}"`,
    });
  }
  return descriptor;
}

/** Extract the :email tail. The mount prefix is stripped before we see it. */
function extractMemberEmail(event: H3Event): string | undefined {
  const path = getRequestURL(event).pathname;
  const match =
    path.match(/^\/([^/]+)\/?$/) ?? path.match(/\/app-roles\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * GET /_agent-native/org/app-roles?appId=X — the app's vocabulary plus every
 * assignment in the active org, and the caller's own resolved role.
 */
export const listAppRolesHandler = defineEventHandler(
  async (event: H3Event) => {
    const url = getRequestURL(event);
    const descriptor = requireDescriptor(url.searchParams.get("appId"));
    const ctx = await getOrgContext(event);

    const base = {
      appId: descriptor.appId,
      roles: descriptor.roles,
      defaultRole: descriptor.defaultRole ?? null,
      roleLabels: descriptor.roleLabels ?? {},
      canManage: canManageOrg(ctx.role),
    };
    if (!ctx.orgId) return { ...base, assignments: [], myRole: null };

    const assignments = await listAppMemberRoles(descriptor.appId, ctx.orgId);
    const mine = assignments.find(
      (a) => a.email.toLowerCase() === ctx.email.toLowerCase(),
    );
    return {
      ...base,
      assignments,
      // The caller's own role, for progressive disclosure only. Every guarded
      // operation re-resolves this server-side; a client that lies about it gains
      // nothing but a differently-shaped UI.
      myRole: mine && descriptor.roles.includes(mine.role) ? mine.role : null,
    };
  },
);

/**
 * PUT /_agent-native/org/app-roles/:email — assign or clear an app role.
 * Body: `{ appId, role }`, where `role: null` clears the assignment.
 *
 * Org owner/admin only. App roles never confer the right to manage app roles:
 * that would let an app admin escalate inside a team they cannot otherwise
 * administer, and it is the org roster this overlay hangs off.
 */
export const setAppRoleHandler = defineEventHandler(async (event: H3Event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.email) {
    throw createError({ statusCode: 401, message: "Authentication required" });
  }
  if (!ctx.orgId) {
    throw createError({ statusCode: 400, message: "No active organization" });
  }
  if (!canManageOrg(ctx.role)) {
    throw createError({
      statusCode: 403,
      message: "Organization admin role required",
    });
  }

  const body = await readBody(event);
  const descriptor = requireDescriptor(body?.appId ?? null);

  const email = extractMemberEmail(event);
  if (!email) {
    throw createError({ statusCode: 400, message: "Member email is required" });
  }

  const role = body?.role ?? null;
  if (role !== null && !descriptor.roles.includes(String(role))) {
    throw createError({
      statusCode: 400,
      message: `Unknown ${descriptor.appId} role "${role}"`,
    });
  }

  // Assignments hang off membership. Writing one for a non-member would leave a
  // row that resolves to nothing and reappears if that person is ever invited.
  if (!(await isOrgMember(ctx.orgId, email))) {
    throw createError({
      statusCode: 404,
      message: "Not a member of this organization",
    });
  }

  await setAppMemberRole({
    appId: descriptor.appId,
    orgId: ctx.orgId,
    email,
    role: role === null ? null : String(role),
    updatedBy: ctx.email,
  });

  return {
    appId: descriptor.appId,
    email,
    role: role === null ? null : String(role),
  };
});
