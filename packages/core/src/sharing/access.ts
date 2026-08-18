/**
 * Access-control helpers for shareable resources.
 *
 * The access model combines:
 * 1. Direct ownership — `owner_email = currentUser`.
 * 2. Visibility — `'private' | 'org' | 'public'`. `org` grants read to anyone
 *    in the same org; `public` grants read to any authenticated user.
 * 3. Share rows — per-user or per-org grants in the `{type}_shares` table
 *    with a role (`viewer | commenter | editor | admin`).
 *
 * Use `applyAccessFilter()` on list/read queries to filter rows the current
 * user can see. Use `assertAccess()` at the top of write actions to reject
 * callers who lack the required role.
 */

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { orgMembers } from "../org/schema.js";
import {
  getRequestAuthCapability,
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import { workspaceUserGroupsIncludeUser } from "../workspace-connections/groups.js";
import {
  listShareableResources,
  requireShareableResource,
  type ShareableResourceRegistration,
} from "./registry.js";
import { ROLE_RANK, type ShareRole, type Visibility } from "./schema.js";

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
  authCapability?: string;
}

/** Current request's access context. Pulls from request-context ALS. */
export function currentAccess(): AccessContext {
  return {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId(),
    authCapability: getRequestAuthCapability(),
  };
}

export function resolveRegisteredAccessContext(
  reg: ShareableResourceRegistration | undefined,
  ctx: AccessContext,
): AccessContext {
  if (!reg?.resolveAccessContext) return ctx;
  const resolved = reg.resolveAccessContext(ctx);
  return ctx.authCapability
    ? { ...resolved, authCapability: ctx.authCapability }
    : resolved;
}

function normalizeEmailForAccess(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function emailColumnMatches(column: any, email: string): SQL {
  return sql`lower(${column}) = ${email}`;
}

/**
 * Real `org_members` membership, independent of the caller's currently
 * active org (`ctx.orgId`). `org`-visibility access must key off actual
 * membership — a user's active-org selection is a UI convenience, not a
 * statement of which orgs they belong to.
 *
 * Queries through the resource's own `reg.getDb()` — the same connection
 * every other lookup in this file uses — not the ambient `getDbExec()`,
 * since `org_members` lives in that same app database.
 */
async function isOrgMember(
  reg: ShareableResourceRegistration,
  memberOrgId: string,
  email: string,
): Promise<boolean> {
  const db = reg.getDb() as any;
  const rows = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, memberOrgId),
        emailColumnMatches(orgMembers.email, email),
      ),
    )
    .limit(1);
  return rows.length > 0;
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
  if (minRole === "commenter") {
    return sql`role in ('commenter','editor','admin')`;
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
 * Minimal resource shape returned when a caller opts into a projected access
 * load via `{ skipResourceBody: true }`. Contains exactly the columns the
 * access-decision logic itself reads — identity, ownership, org scope, and
 * visibility — never a resource type's heavy body columns (`data`,
 * `content`, and similar blobs).
 */
export interface AccessProjectedResource {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: Visibility;
}

export interface ResolvedAccessProjected {
  /** Effective role: 'owner' for the resource owner, or the share role. */
  role: "owner" | ShareRole;
  /** Only the access-decision columns — not the full resource row. */
  resource: AccessProjectedResource;
}

export interface ResolveAccessOptions {
  /**
   * When true, load only the columns the access decision itself needs
   * (`id`, `ownerEmail`, `orgId`, `visibility`) instead of the full resource
   * row. Use this when the caller only needs the access decision — not the
   * resource body — and wants to skip fetching heavy type-specific columns
   * (e.g. `data`/`content` blobs) on every `assertAccess`/`resolveAccess`
   * call.
   *
   * Silently ignored (falls back to a full row load) for any resource type
   * registered with a `publicAccessRole` *function* resolver, since that
   * callback can read arbitrary resource fields the projection would have
   * omitted — see `hasDynamicPublicAccessRoleResolver` below.
   *
   * Default: `false` — the full row is loaded, matching historical behavior.
   * Callers that need resource body fields (most call sites today — for
   * many resource types `resolveAccess().resource` doubles as the action's
   * primary data read) must NOT pass this.
   */
  skipResourceBody?: boolean;
}

async function publicAccessRoleForResource(
  reg: ShareableResourceRegistration,
  resource: any,
  ctx: AccessContext,
): Promise<ShareRole> {
  const roleResolver = reg.publicAccessRole;
  if (!roleResolver) return "viewer";
  return typeof roleResolver === "function"
    ? await roleResolver(resource, ctx)
    : roleResolver;
}

function higherShareRole(a: ShareRole, b: ShareRole | null): ShareRole {
  if (!b) return a;
  return ROLE_RANK[b] > ROLE_RANK[a] ? b : a;
}

function columnName(column: unknown): string | null {
  const candidate = column as
    | {
        name?: unknown;
        config?: { name?: unknown };
        _: { name?: unknown };
      }
    | undefined;
  const name = candidate?.name ?? candidate?.config?.name ?? candidate?._?.name;
  return typeof name === "string" && name ? name : null;
}

function missingColumnName(err: unknown): string | null {
  const error = err as { code?: string; message?: string } | undefined;
  const message = error?.message ?? "";
  if (
    error?.code !== "42703" &&
    !/no such column|does not exist/i.test(message)
  ) {
    return null;
  }
  const quoted = message.match(/column\s+"([^"]+)"\s+does not exist/i)?.[1];
  if (quoted) return quoted;
  const sqlite = message.match(/no such column:\s+["`]?([\w.]+)["`]?/i)?.[1];
  if (sqlite) return sqlite.split(".").pop() ?? sqlite;
  return null;
}

function selectExistingColumns(
  columns: Record<string, unknown>,
  omittedColumnNames: Set<string>,
): Record<string, unknown> {
  const selection: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) {
    const name = columnName(column);
    if (!name || omittedColumnNames.has(name)) continue;
    selection[key] = column;
  }
  return selection;
}

/**
 * The fixed column set the access-decision logic in `resolveAccess` itself
 * reads: identity (`id`), ownership (`ownerEmail`, `orgId`), and the coarse
 * `visibility` flag. This is intentionally NOT caller-configurable — an
 * arbitrary caller-supplied column list could omit a column the access
 * checks below depend on and silently break authorization. Every ownable
 * resource table has these columns (`ownableColumns()` + a primary key
 * named `id`), so this projection is safe for any registration that
 * doesn't also read the row through a dynamic resolver (see below).
 */
function projectedAccessColumns(resourceTable: any): Record<string, unknown> {
  return {
    id: resourceTable.id,
    ownerEmail: resourceTable.ownerEmail,
    orgId: resourceTable.orgId,
    visibility: resourceTable.visibility,
  };
}

/**
 * True when this registration's `publicAccessRole` is a callback rather than
 * a fixed role string. Callbacks receive the loaded `resource` and may read
 * arbitrary fields on it (see e.g. `templates/design`'s
 * `publicDesignAccessRole`, which inspects design-specific data). The
 * projected access load must never be used for these registrations — always
 * fall back to a full row load so the resolver sees the complete resource.
 */
function hasDynamicPublicAccessRoleResolver(
  reg: ShareableResourceRegistration,
): boolean {
  return typeof reg.publicAccessRole === "function";
}

async function loadResourceForAccess(
  reg: ShareableResourceRegistration,
  resourceId: string,
  options: ResolveAccessOptions = {},
): Promise<any | null> {
  const db = reg.getDb() as any;
  const useProjection =
    options.skipResourceBody === true &&
    !hasDynamicPublicAccessRoleResolver(reg);
  const projectedColumns = useProjection
    ? projectedAccessColumns(reg.resourceTable)
    : null;
  const omittedColumnNames = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const query =
        !projectedColumns && omittedColumnNames.size === 0
          ? db.select()
          : db.select(
              selectExistingColumns(
                projectedColumns ?? reg.resourceTable,
                omittedColumnNames,
              ),
            );
      const [resource] = await query
        .from(reg.resourceTable)
        .where(eq(reg.resourceTable.id, resourceId));
      return resource ?? null;
    } catch (err) {
      const missing = missingColumnName(err);
      if (!missing || omittedColumnNames.has(missing)) throw err;
      omittedColumnNames.add(missing);
      console.warn(
        `[sharing] ${reg.type} access lookup omitted missing column ${missing}`,
      );
    }
  }

  throw new Error(
    `Could not load ${reg.type} ${resourceId}: too many missing resource columns`,
  );
}

/**
 * Return the effective role the current user has on a specific resource, or
 * null if they have no access. Loads the resource and relevant share rows.
 *
 * By default the full resource row is loaded (unchanged historical
 * behavior — for most resource types `.resource` here doubles as the
 * action's primary data read). Pass `{ skipResourceBody: true }` when the
 * caller only needs the access decision to load just the access-decision
 * columns instead — see `ResolveAccessOptions`.
 */
export async function resolveAccess(
  resourceType: string,
  resourceId: string,
  rawCtx?: AccessContext,
  options?: { skipResourceBody?: false },
): Promise<ResolvedAccess | null>;
export async function resolveAccess(
  resourceType: string,
  resourceId: string,
  rawCtx: AccessContext | undefined,
  options: { skipResourceBody: true },
): Promise<ResolvedAccessProjected | null>;
export async function resolveAccess(
  resourceType: string,
  resourceId: string,
  rawCtx: AccessContext = currentAccess(),
  options: ResolveAccessOptions = {},
): Promise<ResolvedAccess | ResolvedAccessProjected | null> {
  return resolveAccessImpl(resourceType, resourceId, rawCtx, options);
}

/**
 * Un-overloaded implementation shared by the `resolveAccess` overloads and
 * called directly by `assertAccess` below. Kept separate from the exported
 * `resolveAccess` so internal callers passing a widened
 * `ResolveAccessOptions` (rather than a `{ skipResourceBody: true }` /
 * `{ skipResourceBody?: false }` literal) don't have to satisfy TypeScript's
 * overload resolution, which only matches against the declared overload
 * signatures, not the implementation signature.
 */
async function resolveAccessImpl(
  resourceType: string,
  resourceId: string,
  rawCtx: AccessContext = currentAccess(),
  options: ResolveAccessOptions = {},
): Promise<ResolvedAccess | ResolvedAccessProjected | null> {
  const reg = requireShareableResource(resourceType);
  const ctx = resolveRegisteredAccessContext(reg, rawCtx);

  const resource = await loadResourceForAccess(reg, resourceId, options);
  if (!resource) return null;

  const { userEmail } = ctx;
  const normalizedUserEmail = normalizeEmailForAccess(userEmail);

  if (
    normalizedUserEmail &&
    normalizeEmailForAccess(resource.ownerEmail) === normalizedUserEmail &&
    ownerMatchesActiveScope(reg, resource, ctx)
  ) {
    return { role: "owner", resource };
  }
  if (reg.canManageAccess && (await reg.canManageAccess(resource, ctx))) {
    return { role: "admin", resource };
  }
  if (resource.visibility === "public" && reg.allowPublic !== false) {
    // No share row needed; default viewer unless the resource registration
    // deliberately grants a stronger public-by-link role or explicit shares
    // upgrade the current principal.
    const publicRole = await publicAccessRoleForResource(reg, resource, ctx);
    const role = await highestShareRole(reg, resourceId, ctx, resource);
    return { role: higherShareRole(publicRole, role), resource };
  }
  // `visibility === "public"` on an `allowPublic: false` resource is treated
  // as private: only owner + explicit shares grant access. Falls through to
  // the explicit-share lookup below.
  //
  // Membership in the resource's own org, not equality with the caller's
  // currently active org: a caller can be a genuine member of the
  // resource's org while a *different* org is their active selection, and
  // `org` visibility should still admit them. Still requires some active
  // org to be set at all (`orgId`), matching the pre-existing behavior for
  // a caller with no active org.
  if (
    resource.visibility === "org" &&
    resource.orgId &&
    normalizedUserEmail &&
    (await isOrgMember(reg, resource.orgId, normalizedUserEmail))
  ) {
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

  let best: ShareRole | null = null;

  if (reg.supportsGroupShares && normalizedUserEmail && resource.orgId) {
    const groupRows = await db
      .select({
        principalId: reg.sharesTable.principalId,
        role: reg.sharesTable.role,
      })
      .from(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, resourceId),
          eq(reg.sharesTable.principalType, "group"),
        ),
      );
    for (const row of groupRows as Array<{
      principalId: string;
      role: ShareRole;
    }>) {
      if (
        await workspaceUserGroupsIncludeUser(
          resource.orgId,
          [row.principalId],
          normalizedUserEmail,
        )
      ) {
        if (!best || ROLE_RANK[row.role] > ROLE_RANK[best]) {
          best = row.role;
        }
      }
    }
  }

  const rows = await db
    .select({ role: reg.sharesTable.role })
    .from(reg.sharesTable)
    .where(
      and(eq(reg.sharesTable.resourceId, resourceId), or(...principalClauses)),
    )
    .limit(10);

  for (const r of rows as Array<{ role: ShareRole }>) {
    if (!best || ROLE_RANK[r.role] > ROLE_RANK[best]) best = r.role;
  }
  return best;
}

/**
 * Throw ForbiddenError if the current user can't act on this resource with at
 * least the given role. Used at the top of update/delete actions.
 *
 * By default the full resource row is loaded (unchanged historical
 * behavior). Pass `{ skipResourceBody: true }` as the fifth argument when
 * the caller only needs the access decision — see `ResolveAccessOptions`.
 */
export async function assertAccess(
  resourceType: string,
  resourceId: string,
  minRole?: ShareRole | "owner",
  ctx?: AccessContext,
  options?: { skipResourceBody?: false },
): Promise<ResolvedAccess>;
export async function assertAccess(
  resourceType: string,
  resourceId: string,
  minRole: ShareRole | "owner" | undefined,
  ctx: AccessContext | undefined,
  options: { skipResourceBody: true },
): Promise<ResolvedAccessProjected>;
export async function assertAccess(
  resourceType: string,
  resourceId: string,
  minRole: ShareRole | "owner" = "viewer",
  ctx: AccessContext = currentAccess(),
  options: ResolveAccessOptions = {},
): Promise<ResolvedAccess | ResolvedAccessProjected> {
  const access = await resolveAccessImpl(
    resourceType,
    resourceId,
    ctx,
    options,
  );
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
