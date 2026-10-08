import type { ActionRunContext } from "../action.js";
import { getDbExec } from "../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { ForbiddenError } from "../sharing/access.js";
import { isMissingOrganizationTableError } from "./membership.js";

export interface AppRolesDescriptor<
  R extends string = string,
  P extends string = string,
> {
  appId: string;
  roles: readonly R[];
  defaultRole?: R;
  roleLabels?: Partial<Record<R, string>>;
  permissions?: Partial<Record<P, readonly R[]>>;
  permissionLabels?: Partial<Record<P, string>>;
  label?: string;
}

export type AppRoleLookup<R extends string = string> =
  | { status: "assigned"; roles: R[]; orgId: string }
  | { status: "unassigned"; orgId: string }
  | { status: "not-a-member"; orgId: string }
  | { status: "no-identity" }
  | { status: "no-org" };

export interface AppRoleCaller {
  userEmail?: string | null;
  orgId?: string | null;
}

export interface AppAuthorizationContext {
  appId: string;
  roles: string[];
  permissions: Record<string, string[]>;
}

export interface AppRoles<
  R extends string = string,
  P extends string = string,
> {
  descriptor: AppRolesDescriptor<R, P>;
  appId: string;
  roles: readonly R[];
  resolve: (caller?: AppRoleCaller) => Promise<AppRoleLookup<R>>;
  assertAny: (allowed: readonly R[], caller?: AppRoleCaller) => Promise<R>;
  requireAny: (
    ...allowed: R[]
  ) => (args: unknown, ctx?: ActionRunContext) => Promise<void>;
  requirePermission: (
    ...permissions: P[]
  ) => (args: unknown, ctx?: ActionRunContext) => Promise<void>;
  assertPermission: (
    permissions: readonly P[],
    caller?: AppRoleCaller,
  ) => Promise<void>;
}

const registry = new Map<string, AppRolesDescriptor<string, string>>();

export function getRegisteredAppRoles(
  appId: string,
): AppRolesDescriptor<string, string> | undefined {
  return registry.get(appId);
}

export function listRegisteredAppRoles(): AppRolesDescriptor<string, string>[] {
  return [...registry.values()];
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function callerIdentity(caller?: AppRoleCaller): {
  email: string | null;
  orgId: string | null;
} {
  const email =
    caller?.userEmail !== undefined ? caller.userEmail : getRequestUserEmail();
  const orgId = caller?.orgId !== undefined ? caller.orgId : getRequestOrgId();
  return {
    email: email && email.trim() ? email.trim() : null,
    orgId: orgId && orgId.trim() ? orgId.trim() : null,
  };
}

export function defineAppRoles<
  const R extends string,
  const P extends string = string,
>(descriptor: AppRolesDescriptor<R, P>): AppRoles<R, P> {
  const appId = descriptor.appId.trim();
  if (!appId) throw new Error("defineAppRoles: appId is required");
  if (!descriptor.roles.length) {
    throw new Error(`defineAppRoles(${appId}): at least one role is required`);
  }
  if (
    descriptor.defaultRole &&
    !descriptor.roles.includes(descriptor.defaultRole)
  ) {
    throw new Error(
      `defineAppRoles(${appId}): defaultRole "${descriptor.defaultRole}" is not in roles`,
    );
  }
  for (const [permission, roles] of Object.entries(
    descriptor.permissions ?? {},
  ) as [string, readonly R[]][]) {
    if (
      !permission.trim() ||
      roles.some((role) => !descriptor.roles.includes(role))
    ) {
      throw new Error(
        `defineAppRoles(${appId}): invalid role grant for permission "${permission}"`,
      );
    }
  }

  const existing = registry.get(appId);
  if (
    existing &&
    existing !== (descriptor as unknown as AppRolesDescriptor<string, string>)
  ) {
    throw new Error(
      `defineAppRoles: appId "${appId}" is already declared with a different descriptor`,
    );
  }
  registry.set(
    appId,
    descriptor as unknown as AppRolesDescriptor<string, string>,
  );

  const resolve = (caller?: AppRoleCaller) =>
    resolveAppRole(descriptor, caller);

  const assertAny = async (
    allowed: readonly R[],
    caller?: AppRoleCaller,
  ): Promise<R> => {
    const lookup = await resolve(caller);
    if (lookup.status === "assigned") {
      const matched = lookup.roles.find((role) => allowed.includes(role));
      if (matched) return matched;
    }
    throw new ForbiddenError(denialMessage(appId, allowed, lookup));
  };

  const assertPermission = async (
    permissions: readonly P[],
    caller?: AppRoleCaller,
  ) => {
    if (!permissions.length)
      throw new Error(
        `defineAppRoles(${appId}): requirePermission() needs at least one permission`,
      );
    const unknown = permissions.filter(
      (permission) => !(permission in (descriptor.permissions ?? {})),
    );
    if (unknown.length)
      throw new Error(
        `defineAppRoles(${appId}): unknown permission(s) ${unknown.join(", ")}`,
      );
    const identity = callerIdentity(caller);
    if (!identity.email || !identity.orgId)
      throw new ForbiddenError(
        `Requires ${appId} permission ${permissions.join(" or ")}`,
      );
    const lookup = await resolve(caller);
    if (lookup.status !== "assigned")
      throw new ForbiddenError(
        `Requires ${appId} permission ${permissions.join(" or ")}`,
      );
    const overrides = await getAppPermissionOverrides(appId, identity.orgId);
    const grants = permissions.flatMap(
      (permission) =>
        overrides[permission] ?? descriptor.permissions?.[permission] ?? [],
    );
    if (!lookup.roles.some((role) => grants.includes(role))) {
      throw new ForbiddenError(
        `Requires ${appId} permission ${permissions.join(" or ")}`,
      );
    }
  };

  return {
    descriptor,
    appId,
    roles: descriptor.roles,
    resolve,
    assertAny,
    requireAny: (...allowed: R[]) => {
      if (!allowed.length) {
        throw new Error(
          `defineAppRoles(${appId}): requireAny() needs at least one accepted role`,
        );
      }
      const unknown = allowed.filter((r) => !descriptor.roles.includes(r));
      if (unknown.length) {
        throw new Error(
          `defineAppRoles(${appId}): requireAny() names undeclared role(s) ${unknown.join(", ")}`,
        );
      }
      return async (_args: unknown, ctx?: ActionRunContext) => {
        await assertAny(allowed, {
          userEmail: ctx?.userEmail,
          orgId: ctx?.orgId,
        });
      };
    },
    requirePermission: (...permissions: P[]) => {
      if (!permissions.length)
        throw new Error(
          `defineAppRoles(${appId}): requirePermission() needs at least one permission`,
        );
      const unknown = permissions.filter(
        (permission) => !(permission in (descriptor.permissions ?? {})),
      );
      if (unknown.length)
        throw new Error(
          `defineAppRoles(${appId}): unknown permission(s) ${unknown.join(", ")}`,
        );
      return async (_args: unknown, ctx?: ActionRunContext) =>
        assertPermission(permissions, {
          userEmail: ctx?.userEmail,
          orgId: ctx?.orgId,
        });
    },
    assertPermission,
  };
}

function denialMessage<R extends string>(
  appId: string,
  allowed: readonly R[],
  lookup: AppRoleLookup<R>,
): string {
  const need = `Requires ${appId} role ${allowed.join(" or ")}`;
  switch (lookup.status) {
    case "assigned":
      return `${need} (have ${lookup.roles.join(", ")})`;
    case "unassigned":
      return `${need} (no ${appId} role assigned)`;
    case "not-a-member":
      return `${need} (not a member of this organization)`;
    case "no-org":
      return `${need} (no active organization)`;
    case "no-identity":
      return `${need} (no authenticated user)`;
  }
}

export async function resolveAppRole<R extends string>(
  descriptor: AppRolesDescriptor<R>,
  caller?: AppRoleCaller,
): Promise<AppRoleLookup<R>> {
  const { email, orgId } = callerIdentity(caller);
  if (!email) return { status: "no-identity" };
  if (!orgId) return { status: "no-org" };

  let rows: Array<Record<string, unknown>>;
  try {
    rows = (
      await getDbExec().execute({
        sql: `SELECT array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL) AS roles,
                     o.identity_authority AS "identityAuthority",
                     o.identity_id AS "identityId"
              FROM org_members m
              LEFT JOIN organizations o ON o.id = m.org_id
              LEFT JOIN app_member_roles r
                ON r.org_id = m.org_id
               AND r.app_id = ?
               AND LOWER(r.email) = LOWER(m.email)
              WHERE m.org_id = ? AND LOWER(m.email) = ?
                AND m.federation_removal_pending_at IS NULL
              GROUP BY o.identity_authority, o.identity_id`,
        args: [descriptor.appId, orgId, normalizeEmail(email)],
      })
    ).rows as Array<Record<string, unknown>>;
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) throw error;
    rows = (
      await getDbExec().execute({
        sql: `SELECT array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL) AS roles
              FROM org_members m
              LEFT JOIN app_member_roles r
                ON r.org_id = m.org_id
               AND r.app_id = ?
               AND LOWER(r.email) = LOWER(m.email)
              WHERE m.org_id = ? AND LOWER(m.email) = ?
                AND m.federation_removal_pending_at IS NULL
              GROUP BY m.org_id, m.email`,
        args: [descriptor.appId, orgId, normalizeEmail(email)],
      })
    ).rows as Array<Record<string, unknown>>;
  }

  const row = rows[0] as
    | {
        roles?: unknown;
        appRoles?: unknown;
        approles?: unknown;
        identityAuthority?: unknown;
        identity_authority?: unknown;
        identityId?: unknown;
        identity_id?: unknown;
      }
    | undefined;
  if (!row) return { status: "not-a-member", orgId };

  const identityAuthority = String(
    (row as any).identityAuthority ?? (row as any).identity_authority ?? "",
  ).trim();
  const identityId = String(
    (row as any).identityId ?? (row as any).identity_id ?? "",
  ).trim();
  if (identityAuthority || identityId) {
    const { validateFederatedOrganizationMembershipForCurrentRequest } =
      await import("./federation.js");
    const membership =
      await validateFederatedOrganizationMembershipForCurrentRequest({
        orgId,
        email,
      });
    if (!membership.active) return { status: "not-a-member", orgId };
  }

  const raw = row.roles ?? row.appRoles ?? row.approles;
  const roles = Array.isArray(raw) ? (raw.map(String) as R[]) : [];
  const validRoles = [
    ...new Set(roles.filter((role) => descriptor.roles.includes(role))),
  ];
  if (!validRoles.length) return { status: "unassigned", orgId };
  return { status: "assigned", roles: validRoles, orgId };
}

export interface AppMemberRoleRow {
  email: string;
  roles: string[];
}

export async function listAppMemberRoles(
  appId: string,
  orgId: string,
): Promise<AppMemberRoleRow[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT MIN(r.email) AS email, array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL) AS roles
          FROM app_member_roles r
          INNER JOIN org_members m
            ON m.org_id = r.org_id
           AND LOWER(m.email) = LOWER(r.email)
           AND m.federation_removal_pending_at IS NULL
          WHERE r.org_id = ? AND r.app_id = ?
          GROUP BY LOWER(r.email)`,
    args: [orgId, appId],
  });
  return rows.map((r: any) => ({
    email: String(r.email),
    roles: Array.isArray(r.roles) ? r.roles.map(String) : [],
  }));
}

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function setAppMemberRoles(opts: {
  appId: string;
  orgId: string;
  email: string;
  roles: readonly string[];
  updatedBy: string;
}): Promise<void> {
  const exec = getDbExec();
  const email = normalizeEmail(opts.email);

  if (!exec.transaction)
    throw new Error(
      "Atomic app role replacement requires database transactions",
    );
  const roles = [...new Set(opts.roles)];
  const now = Date.now();
  await exec.transaction(async (tx) => {
    await tx.execute({
      sql: `DELETE FROM app_member_roles WHERE org_id = ? AND app_id = ? AND LOWER(email) = ?`,
      args: [opts.orgId, opts.appId, email],
    });
    for (const role of roles)
      await tx.execute({
        sql: `INSERT INTO app_member_roles (id, org_id, app_id, email, role, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          nanoid(),
          opts.orgId,
          opts.appId,
          email,
          role,
          opts.updatedBy,
          now,
        ],
      });
  });
}

/** @deprecated Use setAppMemberRoles instead. */
export async function setAppMemberRole(opts: {
  appId: string;
  orgId: string;
  email: string;
  role: string | null;
  updatedBy: string;
}): Promise<void> {
  await setAppMemberRoles({
    ...opts,
    roles: opts.role === null ? [] : [opts.role],
  });
}

export async function getAppPermissionOverrides(
  appId: string,
  orgId: string,
): Promise<Record<string, string[]>> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT permission, roles_json FROM app_permission_overrides WHERE app_id = ? AND org_id = ?`,
    args: [appId, orgId],
  });
  return Object.fromEntries(
    rows.map((row: any) => [
      String(row.permission),
      JSON.parse(String(row.roles_json)),
    ]),
  );
}

export async function resolveAppAuthorizationContext(
  appId: string,
  caller: AppRoleCaller,
): Promise<AppAuthorizationContext | null> {
  const descriptor = getRegisteredAppRoles(appId);
  if (!descriptor || !caller.userEmail || !caller.orgId) return null;
  const roleResult = await resolveAppRole(descriptor, caller);
  const roles = roleResult.status === "assigned" ? roleResult.roles : [];
  const overrides = await getAppPermissionOverrides(appId, caller.orgId);
  const permissions = Object.fromEntries(
    Object.entries(descriptor.permissions ?? {}).map(
      ([permission, defaults]) => [
        permission,
        overrides[permission] ?? [...(defaults ?? [])],
      ],
    ),
  );
  return { appId, roles, permissions };
}

export async function setAppPermissionRoles(opts: {
  appId: string;
  orgId: string;
  permission: string;
  roles: readonly string[] | null;
  updatedBy: string;
}): Promise<void> {
  const exec = getDbExec();
  if (opts.roles === null) {
    await exec.execute({
      sql: `DELETE FROM app_permission_overrides WHERE org_id = ? AND app_id = ? AND permission = ?`,
      args: [opts.orgId, opts.appId, opts.permission],
    });
    return;
  }
  await exec.execute({
    sql: `INSERT INTO app_permission_overrides (org_id, app_id, permission, roles_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (org_id, app_id, permission) DO UPDATE SET roles_json = excluded.roles_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    args: [
      opts.orgId,
      opts.appId,
      opts.permission,
      JSON.stringify([...new Set(opts.roles)]),
      opts.updatedBy,
      Date.now(),
    ],
  });
}

export async function applyInvitationAppRoles(opts: {
  appRolesJson: string | null;
  orgId: string;
  email: string;
  updatedBy: string;
}): Promise<void> {
  if (!opts.appRolesJson) return;
  const assignments = JSON.parse(opts.appRolesJson) as unknown;
  if (
    !assignments ||
    typeof assignments !== "object" ||
    Array.isArray(assignments)
  )
    throw new Error("Invitation app roles are invalid");
  for (const [appId, roles] of Object.entries(assignments)) {
    const descriptor = getRegisteredAppRoles(appId);
    if (
      !descriptor ||
      !Array.isArray(roles) ||
      roles.some(
        (role) => typeof role !== "string" || !descriptor.roles.includes(role),
      )
    ) {
      throw new Error(`Invitation contains invalid roles for app ${appId}`);
    }
    await setAppMemberRoles({
      appId,
      orgId: opts.orgId,
      email: opts.email,
      roles,
      updatedBy: opts.updatedBy,
    });
  }
}
