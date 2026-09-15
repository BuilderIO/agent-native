/**
 * Per-app member roles — an overlay on org membership, never a second roster.
 *
 * Three role systems now coexist and answer different questions:
 *   - org role (`org_members.role`)  — what may this person do to the *team*?
 *   - app role (this module)         — what may this person do inside *one app*?
 *   - share role (`sharing/`)        — what may this person do to *one row*?
 *
 * They do not imply one another in either direction. In particular an app
 * `admin` is not an org admin: nothing here is ever read by the org handlers.
 */

import type { ActionRunContext } from "../action.js";
import { getDbExec } from "../db/client.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { ForbiddenError } from "../sharing/access.js";
import { isMissingOrganizationTableError } from "./membership.js";

/**
 * The serializable half of an app-role declaration. Kept free of database
 * imports so the same object can be passed to `defineAppRoles` on the server
 * and to `<TeamPage appRoles={...} />` in the browser bundle.
 */
export interface AppRolesDescriptor<
  R extends string = string,
  P extends string = string,
> {
  /**
   * Stable identifier for the app these roles belong to. Comes from app source,
   * never from a request: the REST layer resolves a descriptor out of the
   * registry below and 404s on anything unregistered, so a client cannot name
   * an app the server did not declare.
   */
  appId: string;
  /**
   * The complete role vocabulary, as an unordered SET. Declaration order
   * carries no meaning — `["ae", "se", "csm"]` are classifications, and ranking
   * them would silently grant the last one everything the first one has.
   * Authorization is always an explicit list of accepted roles.
   */
  roles: readonly R[];
  /**
   * What to show for an org member who has no assignment yet.
   *
   * DISPLAY ONLY — `requireAny` never matches it. If an unassigned member could
   * satisfy a guard, "nobody has assigned this person" and "this person was
   * granted the role" would be the same answer, and later widening the default
   * would silently widen every guard that names it.
   */
  defaultRole?: R;
  /** Optional human labels for the role picker. Falls back to the raw value. */
  roleLabels?: Partial<Record<R, string>>;
  /** Permission keys are declared by app code; values are default role grants. */
  permissions?: Partial<Record<P, readonly R[]>>;
  /**
   * Column header for the role in `<TeamPage appRoles={...} />`. Defaults to
   * `appId`. Owned by the app rather than the framework's i18n catalogs — the
   * vocabulary it labels is app-specific, so its translations are too.
   */
  label?: string;
}

/**
 * Why a caller does or does not hold an app role. Each outcome is a distinct
 * value on purpose: collapsing "not in this org" into "no role assigned" would
 * report a membership problem as a permissions problem, and the operator would
 * go looking in the wrong settings page.
 *
 * A failed lookup is NOT in this union — it throws. A database error is not an
 * answer, and returning one of these statuses for it would deny loudly in
 * exactly the same shape as a legitimate denial.
 */
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

export interface AppRoles<
  R extends string = string,
  P extends string = string,
> {
  descriptor: AppRolesDescriptor<R, P>;
  appId: string;
  roles: readonly R[];
  /** Resolve without throwing on denial — for UI and for building richer guards. */
  resolve: (caller?: AppRoleCaller) => Promise<AppRoleLookup<R>>;
  /** Throw unless the caller holds one of `allowed`; returns the matched role. */
  assertAny: (allowed: readonly R[], caller?: AppRoleCaller) => Promise<R>;
  /** Guard for `defineAction({ authorize })`. Accepts an explicit assignment only. */
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

/** Descriptor for a registered app id, or undefined. Used by the REST layer. */
export function getRegisteredAppRoles(
  appId: string,
): AppRolesDescriptor<string, string> | undefined {
  return registry.get(appId);
}

export function listRegisteredAppRoles(): AppRolesDescriptor<string, string>[] {
  return [...registry.values()];
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * `undefined` means "the caller did not say" and falls back to the ambient
 * request context; an explicit `null` means "this run has no user/org" and must
 * NOT. Collapsing the two lets a system or cron caller that deliberately
 * declared no identity inherit whichever request happens to be on the stack,
 * and authorize as that person.
 */
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

/**
 * Declare an app's role vocabulary and get the server-side guards for it.
 *
 * ```ts
 * export const coachAccess = defineAppRoles({
 *   appId: "coach",
 *   roles: ["member", "coach-admin"] as const,
 *   defaultRole: "member",
 * });
 * ```
 */
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
    // Two vocabularies behind one appId means the REST layer and the guards can
    // disagree about which roles exist, and the settings UI would offer roles
    // no guard accepts.
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
      // An empty accepted set can never match. Failing closed at request time
      // would be correct but mute — `authorize: coachAccess.requireAny()` is a
      // dropped argument, and it should fail where the mistake is, not as an
      // unexplained 403 in production.
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

/**
 * Single read behind every app-role decision.
 *
 * Membership and assignment are resolved in ONE statement so an assignment left
 * behind by a removed member can never authorize: the row only reaches the
 * result set through `org_members`. Splitting this into two queries would also
 * let a member removed between them still pass.
 */
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
  // A stored value outside the declared vocabulary is a role that was removed
  // from the app's declaration while assignments still referenced it. Treating
  // it as unassigned keeps a retired role from satisfying a guard that no
  // longer knows what it meant.
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

/** Every assignment for current members of one app in one org. */
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

/**
 * Assign or clear one member's app role. `role: null` deletes the assignment,
 * which is distinct from assigning the descriptor's `defaultRole` — an unassigned
 * member satisfies no guard, whereas a default is only ever a display value.
 *
 * Callers must have already established that the target is an org member and
 * that the actor may manage the org; this function does not re-check either.
 */
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
