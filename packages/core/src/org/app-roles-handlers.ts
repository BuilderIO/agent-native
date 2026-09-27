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
  setAppMemberRoles,
  getAppPermissionOverrides,
  setAppPermissionRoles,
  type AppRolesDescriptor,
} from "./app-roles.js";
import { getOrgContext } from "./context.js";
import { isOrgMember } from "./membership.js";
import { canManageOrg } from "./permissions.js";

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

function appIdFromEvent(event: H3Event, fallback?: unknown): string | null {
  const url = getRequestURL(event);
  const match = url.pathname.match(/(?:\/app-permissions\/|^\/)([^/]+)\/?$/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  if (typeof fallback === "string") return fallback;
  return url.searchParams.get("appId");
}

function extractMemberEmail(event: H3Event): string | undefined {
  const path = getRequestURL(event).pathname;
  const match =
    path.match(/^\/([^/]+)\/?$/) ?? path.match(/\/app-roles\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

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
      permissions: descriptor.permissions ?? {},
      canManage: canManageOrg(ctx.role),
    };
    if (!ctx.orgId)
      return {
        ...base,
        assignments: [],
        myRoles: [],
        myRole: null,
      };

    const assignments = (
      await listAppMemberRoles(descriptor.appId, ctx.orgId)
    ).map((assignment) => ({
      ...assignment,
      roles: assignment.roles.filter((role) => descriptor.roles.includes(role)),
      role:
        assignment.roles.find((role) => descriptor.roles.includes(role)) ??
        null,
    }));
    const mine = assignments.find(
      (a) => a.email.toLowerCase() === ctx.email.toLowerCase(),
    );
    return {
      ...base,
      assignments,
      myRoles: mine
        ? mine.roles.filter((role) => descriptor.roles.includes(role))
        : [],
      myRole:
        mine?.roles.find((role) => descriptor.roles.includes(role)) ?? null,
    };
  },
);

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

  const roles = body?.roles;
  if (
    !Array.isArray(roles) ||
    roles.some(
      (role: unknown) =>
        typeof role !== "string" || !descriptor.roles.includes(role),
    )
  ) {
    throw createError({
      statusCode: 400,
      message: `roles must contain only declared ${descriptor.appId} roles`,
    });
  }

  if (!(await isOrgMember(ctx.orgId, email))) {
    throw createError({
      statusCode: 404,
      message: "Not a member of this organization",
    });
  }

  await setAppMemberRoles({
    appId: descriptor.appId,
    orgId: ctx.orgId,
    email,
    roles,
    updatedBy: ctx.email,
  });

  return {
    appId: descriptor.appId,
    email,
    roles: [...new Set(roles)],
  };
});

export const getAppPermissionsHandler = defineEventHandler(
  async (event: H3Event) => {
    const descriptor = requireDescriptor(appIdFromEvent(event));
    if (
      !descriptor.permissions ||
      !Object.keys(descriptor.permissions).length
    ) {
      throw createError({
        statusCode: 404,
        message: `No permissions registered for "${descriptor.appId}"`,
      });
    }
    const ctx = await getOrgContext(event);
    if (!canManageOrg(ctx.role)) {
      throw createError({
        statusCode: 403,
        message: "Organization admin role required",
      });
    }
    if (!ctx.orgId) {
      throw createError({ statusCode: 400, message: "No active organization" });
    }
    const overrides = await getAppPermissionOverrides(
      descriptor.appId,
      ctx.orgId,
    );
    return {
      appId: descriptor.appId,
      permissions: Object.fromEntries(
        Object.entries(descriptor.permissions).map(([permission, roles]) => [
          permission,
          {
            defaults: roles,
            roles: overrides[permission] ?? roles,
            overridden: overrides[permission] !== undefined,
          },
        ]),
      ),
      canManage: canManageOrg(ctx.role),
    };
  },
);

export const setAppPermissionsHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.email)
      throw createError({
        statusCode: 401,
        message: "Authentication required",
      });
    if (!ctx.orgId)
      throw createError({ statusCode: 400, message: "No active organization" });
    if (!canManageOrg(ctx.role))
      throw createError({
        statusCode: 403,
        message: "Organization admin role required",
      });
    const body = await readBody(event);
    const descriptor = requireDescriptor(appIdFromEvent(event, body?.appId));
    const permission = String(body?.permission ?? "");
    const declared = descriptor.permissions?.[permission];
    if (!declared)
      throw createError({
        statusCode: 400,
        message: `Unknown ${descriptor.appId} permission "${permission}"`,
      });
    const roles = body?.roles;
    if (
      !Array.isArray(roles) ||
      roles.some(
        (role: unknown) =>
          typeof role !== "string" || !descriptor.roles.includes(role),
      )
    ) {
      throw createError({
        statusCode: 400,
        message: `roles must contain only declared ${descriptor.appId} roles`,
      });
    }
    await setAppPermissionRoles({
      appId: descriptor.appId,
      orgId: ctx.orgId,
      permission,
      roles,
      updatedBy: ctx.email,
    });
    return { appId: descriptor.appId, permission, roles: [...new Set(roles)] };
  },
);

export const resetAppPermissionHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.email)
      throw createError({
        statusCode: 401,
        message: "Authentication required",
      });
    if (!ctx.orgId)
      throw createError({ statusCode: 400, message: "No active organization" });
    if (!canManageOrg(ctx.role))
      throw createError({
        statusCode: 403,
        message: "Organization admin role required",
      });
    const body = await readBody(event);
    const descriptor = requireDescriptor(appIdFromEvent(event, body?.appId));
    const permission = String(body?.permission ?? "");
    if (!descriptor.permissions?.[permission])
      throw createError({
        statusCode: 400,
        message: `Unknown ${descriptor.appId} permission "${permission}"`,
      });
    await setAppPermissionRoles({
      appId: descriptor.appId,
      orgId: ctx.orgId,
      permission,
      roles: null,
      updatedBy: ctx.email,
    });
    return { appId: descriptor.appId, permission, reset: true };
  },
);
