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

/**
 * The serializable half of an app-role declaration. Kept free of database
 * imports so the same object can be passed to `defineAppRoles` on the server
 * and to `<TeamPage appRoles={...} />` in the browser bundle.
 */
export interface AppRolesDescriptor<R extends string = string> {
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
  | { status: "assigned"; role: R; orgId: string }
  | { status: "unassigned"; orgId: string }
  | { status: "not-a-member"; orgId: string }
  | { status: "no-identity" }
  | { status: "no-org" };

export interface AppRoleCaller {
  userEmail?: string | null;
  orgId?: string | null;
}

export interface AppRoles<R extends string = string> {
  descriptor: AppRolesDescriptor<R>;
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
}

const registry = new Map<string, AppRolesDescriptor<string>>();

/** Descriptor for a registered app id, or undefined. Used by the REST layer. */
export function getRegisteredAppRoles(
  appId: string,
): AppRolesDescriptor<string> | undefined {
  return registry.get(appId);
}

export function listRegisteredAppRoles(): AppRolesDescriptor<string>[] {
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
export function defineAppRoles<const R extends string>(
  descriptor: AppRolesDescriptor<R>,
): AppRoles<R> {
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

  const existing = registry.get(appId);
  if (existing && existing !== (descriptor as AppRolesDescriptor<string>)) {
    // Two vocabularies behind one appId means the REST layer and the guards can
    // disagree about which roles exist, and the settings UI would offer roles
    // no guard accepts.
    throw new Error(
      `defineAppRoles: appId "${appId}" is already declared with a different descriptor`,
    );
  }
  registry.set(appId, descriptor as AppRolesDescriptor<string>);

  const resolve = (caller?: AppRoleCaller) =>
    resolveAppRole(descriptor, caller);

  const assertAny = async (
    allowed: readonly R[],
    caller?: AppRoleCaller,
  ): Promise<R> => {
    const lookup = await resolve(caller);
    if (lookup.status === "assigned" && allowed.includes(lookup.role)) {
      return lookup.role;
    }
    throw new ForbiddenError(denialMessage(appId, allowed, lookup));
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
      return `${need} (have ${lookup.role})`;
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

  const { rows } = await getDbExec().execute({
    sql: `SELECT r.role AS "appRole"
          FROM org_members m
          LEFT JOIN app_member_roles r
            ON r.org_id = m.org_id
           AND r.app_id = ?
           AND LOWER(r.email) = LOWER(m.email)
          WHERE m.org_id = ? AND LOWER(m.email) = ?
          LIMIT 1`,
    args: [descriptor.appId, orgId, normalizeEmail(email)],
  });

  const row = rows[0] as { appRole?: unknown; approle?: unknown } | undefined;
  if (!row) return { status: "not-a-member", orgId };

  const raw = row.appRole ?? row.approle;
  if (raw === null || raw === undefined) return { status: "unassigned", orgId };

  const role = String(raw) as R;
  // A stored value outside the declared vocabulary is a role that was removed
  // from the app's declaration while assignments still referenced it. Treating
  // it as unassigned keeps a retired role from satisfying a guard that no
  // longer knows what it meant.
  if (!descriptor.roles.includes(role)) return { status: "unassigned", orgId };

  return { status: "assigned", role, orgId };
}

export interface AppMemberRoleRow {
  email: string;
  role: string;
}

/** Every assignment for current members of one app in one org. */
export async function listAppMemberRoles(
  appId: string,
  orgId: string,
): Promise<AppMemberRoleRow[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT r.email, r.role
          FROM app_member_roles r
          INNER JOIN org_members m
            ON m.org_id = r.org_id
           AND LOWER(m.email) = LOWER(r.email)
          WHERE r.org_id = ? AND r.app_id = ?`,
    args: [orgId, appId],
  });
  return rows.map((r: any) => ({
    email: String(r.email),
    role: String(r.role),
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
export async function setAppMemberRole(opts: {
  appId: string;
  orgId: string;
  email: string;
  role: string | null;
  updatedBy: string;
}): Promise<void> {
  const exec = getDbExec();
  const email = normalizeEmail(opts.email);

  if (opts.role === null) {
    await exec.execute({
      sql: `DELETE FROM app_member_roles
            WHERE org_id = ? AND app_id = ? AND LOWER(email) = ?`,
      args: [opts.orgId, opts.appId, email],
    });
    return;
  }

  const now = Date.now();
  await exec.execute({
    sql: `INSERT INTO app_member_roles
            (id, org_id, app_id, email, role, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (org_id, app_id, LOWER(email)) DO UPDATE SET
            role = excluded.role,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
    args: [
      nanoid(),
      opts.orgId,
      opts.appId,
      email,
      opts.role,
      opts.updatedBy,
      now,
    ],
  });
}
