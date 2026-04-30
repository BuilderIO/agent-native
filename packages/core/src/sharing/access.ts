/**
 * Access-control helpers for shareable resources.
 *
 * The access model combines:
 * 1. Direct ownership — `owner_email = currentUser`.
 * 2. Visibility — `'private' | 'org' | 'public'`. `org` grants read to anyone
 *    in the same org; `public` grants read to any authenticated user.
 * 3. Share rows — per-user or per-org grants in the `{type}_shares` table
 *    with a role (`viewer | editor | admin`).
 *
 * Use `applyAccessFilter()` on list/read queries to filter rows the current
 * user can see. Use `assertAccess()` at the top of write actions to reject
 * callers who lack the required role.
 */

import { and, eq, or, sql, type SQL } from "drizzle-orm";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import {
  requireShareableResource,
  type ShareableResourceRegistration,
} from "./registry.js";
import { ROLE_RANK, type ShareRole } from "./schema.js";

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface AccessContext {
  userEmail?: string;
  orgId?: string;
}

/** Current request's access context. Pulls from request-context ALS. */
export function currentAccess(): AccessContext {
  return {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId(),
  };
}

/**
 * Build a Drizzle `WHERE` clause that admits rows the current user can see.
 * Pass the ownable resource table and its shares table; optional min role
 * (defaults to 'viewer') gates which share rows count.
 *
 * Example:
 *
 *   const rows = await db
 *     .select()
 *     .from(schema.documents)
 *     .where(accessFilter(schema.documents, schema.documentShares));
 */
export function accessFilter(
  resourceTable: any,
  sharesTable: any,
  ctx: AccessContext = currentAccess(),
  minRole: ShareRole = "viewer",
): SQL {
  const { userEmail, orgId } = ctx;
  const clauses: SQL[] = [];

  if (userEmail) {
    clauses.push(eq(resourceTable.ownerEmail, userEmail));
  }
  if (minRole === "viewer") {
    clauses.push(eq(resourceTable.visibility, "public"));
    if (orgId) {
      clauses.push(
        and(
          eq(resourceTable.visibility, "org"),
          eq(resourceTable.orgId, orgId),
        )!,
      );
    }
  }
  if (userEmail) {
    clauses.push(
      sql`exists (select 1 from ${sharesTable}
                  where ${sharesTable.resourceId} = ${resourceTable.id}
                    and ${sharesTable.principalType} = 'user'
                    and ${sharesTable.principalId} = ${userEmail}
                    and ${minRoleSql(minRole)})`,
    );
  }
  if (orgId) {
    clauses.push(
      sql`exists (select 1 from ${sharesTable}
                  where ${sharesTable.resourceId} = ${resourceTable.id}
                    and ${sharesTable.principalType} = 'org'
                    and ${sharesTable.principalId} = ${orgId}
                    and ${minRoleSql(minRole)})`,
    );
  }

  return or(...clauses) ?? sql`1=0`;
}

function minRoleSql(minRole: ShareRole): SQL {
  if (minRole === "viewer") {
    // any role satisfies viewer
    return sql`1=1`;
  }
  if (minRole === "editor") {
    return sql`role in ('editor','admin')`;
  }
  return sql`role = 'admin'`;
}

export interface ResolvedAccess {
  /** Effective role: 'owner' for the resource owner, or the share role. */
  role: "owner" | ShareRole;
  /** The resource row (already loaded). */
  resource: any;
}

/**
 * Return the effective role the current user has on a specific resource, or
 * null if they have no access. Loads the resource and relevant share rows.
 */
export async function resolveAccess(
  resourceType: string,
  resourceId: string,
  ctx: AccessContext = currentAccess(),
): Promise<ResolvedAccess | null> {
  const reg = requireShareableResource(resourceType);
  const db = reg.getDb() as any;

  const [resource] = await db
    .select()
    .from(reg.resourceTable)
    .where(eq(reg.resourceTable.id, resourceId));
  if (!resource) return null;

  const { userEmail, orgId } = ctx;

  if (userEmail && resource.ownerEmail === userEmail) {
    return { role: "owner", resource };
  }
  if (resource.visibility === "public") {
    // No share row needed; default viewer unless upgraded below.
    const role = await highestShareRole(reg, resourceId, ctx);
    return { role: role ?? "viewer", resource };
  }
  if (resource.visibility === "org" && orgId && resource.orgId === orgId) {
    const role = await highestShareRole(reg, resourceId, ctx);
    return { role: role ?? "viewer", resource };
  }
  const role = await highestShareRole(reg, resourceId, ctx);
  if (role) return { role, resource };
  return null;
}

async function highestShareRole(
  reg: ShareableResourceRegistration,
  resourceId: string,
  ctx: AccessContext,
): Promise<ShareRole | null> {
  const { userEmail, orgId } = ctx;
  if (!userEmail && !orgId) return null;
  const db = reg.getDb() as any;

  const principalClauses: ReturnType<typeof and>[] = [];
  if (userEmail) {
    principalClauses.push(
      and(
        eq(reg.sharesTable.principalType, "user"),
        eq(reg.sharesTable.principalId, userEmail),
      ),
    );
  }
  if (orgId) {
    principalClauses.push(
      and(
        eq(reg.sharesTable.principalType, "org"),
        eq(reg.sharesTable.principalId, orgId),
      ),
    );
  }

  const rows = await db
    .select({ role: reg.sharesTable.role })
    .from(reg.sharesTable)
    .where(
      and(eq(reg.sharesTable.resourceId, resourceId), or(...principalClauses)),
    )
    .limit(10);

  let best: ShareRole | null = null;
  for (const r of rows as Array<{ role: ShareRole }>) {
    if (!best || ROLE_RANK[r.role] > ROLE_RANK[best]) best = r.role;
  }
  return best;
}

/**
 * Throw ForbiddenError if the current user can't act on this resource with at
 * least the given role. Used at the top of update/delete actions.
 */
export async function assertAccess(
  resourceType: string,
  resourceId: string,
  minRole: ShareRole | "owner" = "viewer",
  ctx: AccessContext = currentAccess(),
): Promise<ResolvedAccess> {
  const access = await resolveAccess(resourceType, resourceId, ctx);
  if (!access) {
    throw new ForbiddenError(`No access to ${resourceType} ${resourceId}`);
  }
  if (ROLE_RANK[access.role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(
      `Requires ${minRole} role on ${resourceType} ${resourceId} (have ${access.role})`,
    );
  }
  return access;
}
