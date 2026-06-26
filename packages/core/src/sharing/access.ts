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
  listShareableResources,
  requireShareableResource,
  type ShareableResourceRegistration,
} from "./registry.js";
import { ROLE_RANK, type ShareRole } from "./schema.js";

/**
 * Find a registration by its drizzle table identity. Used to look up
 * per-resource policy flags (e.g. `allowPublic`) inside `accessFilter`,
 * which receives only the table — not the resource-type name.
 *
 * Identity is stable within a single bundle (Vite dedupes module instances);
 * the SSR/server side is the only caller, so per-bundle identity is fine.
 */
function findRegistrationByTable(
  resourceTable: any,
): ShareableResourceRegistration | undefined {
  for (const reg of listShareableResources()) {
    if (reg.resourceTable === resourceTable) return reg;
  }
  return undefined;
}

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

export function resolveRegisteredAccessContext(
  reg: ShareableResourceRegistration | undefined,
  ctx: AccessContext,
): AccessContext {
  return reg?.resolveAccessContext ? reg.resolveAccessContext(ctx) : ctx;
}

function normalizeEmailForAccess(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function emailColumnMatches(column: any, email: string): SQL {
  return sql`lower(${column}) = ${email}`;
}

/**
 * Build a Drizzle `WHERE` clause that admits rows the current user can see.
 * Pass the ownable resource table and its shares table; optional min role
 * (defaults to 'viewer') gates which share rows count.
 *
 * `visibility = 'public'` is intentionally NOT admitted by default. Public
 * means "anyone with the link can view" (still honoured by `resolveAccess`
 * for read-by-id), not "appears in every signed-in user's list/sidebar."
 * Pass `{ includePublic: true }` for the rare list endpoint that wants
 * cross-user public discovery (a public template gallery, for example).
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
  rawCtx: AccessContext = currentAccess(),
  minRole: ShareRole = "viewer",
  options: { includePublic?: boolean } = {},
): SQL {
  // Defense in depth — resources registered with `allowPublic: false` must
  // never participate in cross-user "public" discovery, even if a caller
  // accidentally passes `includePublic: true` or if a stale public row sits
  // in the DB.
  const reg = findRegistrationByTable(resourceTable);
  const ctx = resolveRegisteredAccessContext(reg, rawCtx);
  const { userEmail, orgId } = ctx;
  const normalizedUserEmail = normalizeEmailForAccess(userEmail);
  const publicAllowed = reg?.allowPublic !== false;
  const includePublic = (options.includePublic ?? false) && publicAllowed;
  const clauses: SQL[] = [];

  if (normalizedUserEmail) {
    clauses.push(
      and(
        emailColumnMatches(resourceTable.ownerEmail, normalizedUserEmail),
        ownerScopeFilter(reg, resourceTable, ctx),
      )!,
    );
  }
  if (minRole === "viewer") {
    if (includePublic) {
      clauses.push(eq(resourceTable.visibility, "public"));
    }
    if (orgId) {
      clauses.push(
        and(
          eq(resourceTable.visibility, "org"),
          eq(resourceTable.orgId, orgId),
        )!,
      );
    }
  }
  if (normalizedUserEmail) {
    const shareScope = restrictedShareScopeSql(reg, resourceTable, ctx);
    clauses.push(
      sql`exists (select 1 from ${sharesTable}
                  where ${sharesTable.resourceId} = ${resourceTable.id}
                    and ${sharesTable.principalType} = 'user'
                    and lower(${sharesTable.principalId}) = ${normalizedUserEmail}
                    and ${shareScope}
                    and ${minRoleSql(minRole)})`,
    );
  }
  if (orgId) {
    const shareScope = restrictedShareScopeSql(reg, resourceTable, ctx);
    clauses.push(
      sql`exists (select 1 from ${sharesTable}
                  where ${sharesTable.resourceId} = ${resourceTable.id}
                    and ${sharesTable.principalType} = 'org'
                    and ${sharesTable.principalId} = ${orgId}
                    and ${shareScope}
                    and ${minRoleSql(minRole)})`,
    );
  }

  return or(...clauses) ?? sql`1=0`;
}

function ownerScopeFilter(
  reg: ShareableResourceRegistration | undefined,
  resourceTable: any,
  ctx: AccessContext,
): SQL {
  if (reg?.ownerAccessIgnoresOrg === true) return sql`1=1`;
  if (ctx.orgId) {
    // Rows created before org-scoping, or in solo mode, have no org_id. Keep
    // them manageable by their owner after the owner joins or switches into an
    // organization, while still keeping rows from other orgs out of scope.
    return or(
      eq(resourceTable.orgId, ctx.orgId),
      sql`${resourceTable.orgId} IS NULL`,
    )!;
  }
  return sql`${resourceTable.orgId} IS NULL`;
}

function ownerMatchesActiveScope(
  reg: ShareableResourceRegistration | undefined,
  resource: any,
  ctx: AccessContext,
): boolean {
  if (reg?.ownerAccessIgnoresOrg === true) return true;
  const resourceOrgId = resource?.orgId ?? null;
  if (!resourceOrgId) return true;
  return ctx.orgId === resourceOrgId;
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

function restrictedShareScopeSql(
  reg: ShareableResourceRegistration | undefined,
  resourceTable: any,
  ctx: AccessContext,
): SQL {
  // Restricted resources (extensions) must stay inside their resource org even
  // if stale cross-org share rows already exist from older code or bad data.
  if (reg?.requireOrgMemberForUserShares !== true) return sql`1=1`;
  if (!ctx.orgId) return sql`1=0`;
  return eq(resourceTable.orgId, ctx.orgId);
}

function explicitSharesAllowedForResource(
  reg: ShareableResourceRegistration,
  resource: any,
  ctx: AccessContext,
): boolean {
  if (reg.requireOrgMemberForUserShares !== true) return true;
  const resourceOrgId = resource?.orgId ?? null;
  return !!resourceOrgId && !!ctx.orgId && resourceOrgId === ctx.orgId;
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
  rawCtx: AccessContext = currentAccess(),
): Promise<ResolvedAccess | null> {
  const reg = requireShareableResource(resourceType);
  const ctx = resolveRegisteredAccessContext(reg, rawCtx);
  const db = reg.getDb() as any;

  const [resource] = await db
    .select()
    .from(reg.resourceTable)
    .where(eq(reg.resourceTable.id, resourceId));
  if (!resource) return null;

  const { userEmail, orgId } = ctx;
  const normalizedUserEmail = normalizeEmailForAccess(userEmail);

  if (
    normalizedUserEmail &&
    normalizeEmailForAccess(resource.ownerEmail) === normalizedUserEmail &&
    ownerMatchesActiveScope(reg, resource, ctx)
  ) {
    return { role: "owner", resource };
  }
  if (resource.visibility === "public" && reg.allowPublic !== false) {
    // No share row needed; default viewer unless upgraded below.
    const role = await highestShareRole(reg, resourceId, ctx, resource);
    return { role: role ?? "viewer", resource };
  }
  // `visibility === "public"` on an `allowPublic: false` resource is treated
  // as private: only owner + explicit shares grant access. Falls through to
  // the explicit-share lookup below.
  if (resource.visibility === "org" && orgId && resource.orgId === orgId) {
    const role = await highestShareRole(reg, resourceId, ctx, resource);
    return { role: role ?? "viewer", resource };
  }
  const role = await highestShareRole(reg, resourceId, ctx, resource);
  if (role) return { role, resource };
  return null;
}

async function highestShareRole(
  reg: ShareableResourceRegistration,
  resourceId: string,
  ctx: AccessContext,
  resource: any,
): Promise<ShareRole | null> {
  const { userEmail, orgId } = ctx;
  const normalizedUserEmail = normalizeEmailForAccess(userEmail);
  if (!normalizedUserEmail && !orgId) return null;
  if (!explicitSharesAllowedForResource(reg, resource, ctx)) return null;
  const db = reg.getDb() as any;

  const principalClauses: ReturnType<typeof and>[] = [];
  if (normalizedUserEmail) {
    principalClauses.push(
      and(
        eq(reg.sharesTable.principalType, "user"),
        emailColumnMatches(reg.sharesTable.principalId, normalizedUserEmail),
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
