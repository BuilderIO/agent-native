import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";

import { getScopedDbExec, withDbExec, type DbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "../org/feature-flags.js";
import { isMissingOrganizationTableError } from "../org/membership.js";
import { orgMembers, organizations } from "../org/schema.js";
import { implicitServiceOrgRole } from "../org/service-identity.js";
import {
  getRequestAuthCapability,
  getRequestContext,
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import {
  workspaceUserGroupsIncludeUser,
  workspaceUserGroupsTable,
} from "../workspace-connections/groups.js";
import {
  listShareableResources,
  requireShareableResource,
  type ShareableResourceRegistration,
} from "./registry.js";
import { ROLE_RANK, type ShareRole, type Visibility } from "./schema.js";

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
  transaction?: DbExec;
  userEmail?: string;
  orgId?: string;
  authCapability?: string;
  federationMembershipValidated?: boolean;
}

export function currentAccess(): AccessContext {
  return {
    userEmail: getRequestUserEmail(),
    orgId: getRequestOrgId(),
    authCapability: getRequestAuthCapability(),
    federationMembershipValidated:
      getRequestContext()?.federationMembershipValidated,
  };
}

export function resolveRegisteredAccessContext(
  reg: ShareableResourceRegistration | undefined,
  ctx: AccessContext,
): AccessContext {
  if (!reg?.resolveAccessContext) return ctx;
  const resolved = reg.resolveAccessContext(ctx);
  const preserved = ctx.authCapability
    ? {
        ...resolved,
        authCapability: ctx.authCapability,
        ...(ctx.federationMembershipValidated === undefined
          ? {}
          : {
              federationMembershipValidated: ctx.federationMembershipValidated,
            }),
      }
    : ctx.federationMembershipValidated === undefined
      ? resolved
      : {
          ...resolved,
          federationMembershipValidated: ctx.federationMembershipValidated,
        };
  return ctx.transaction
    ? { ...preserved, transaction: ctx.transaction }
    : preserved;
}

function normalizeEmailForAccess(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function emailColumnMatches(column: any, email: string): SQL {
  return sql`lower(${column}) = ${email}`;
}

function orgMembershipScope(ctx: AccessContext, orgId: string): SQL {
  const requestContext = getRequestContext();
  const serviceIdentity = requestContext?.verifiedServiceIdentity;
  const normalizedUserEmail = normalizeEmailForAccess(ctx.userEmail);
  if (serviceIdentity) {
    if (
      normalizeEmailForAccess(serviceIdentity.userEmail) !==
        normalizedUserEmail ||
      serviceIdentity.orgId !== orgId ||
      requestContext.orgId !== orgId ||
      ctx.orgId !== orgId ||
      !implicitServiceOrgRole({
        email: serviceIdentity.userEmail,
        orgId,
        requestOrgId: requestContext.orgId,
      })
    ) {
      return sql`1=0`;
    }
    return sql`exists (
      select 1 from organizations as service_org
      where service_org.id = ${orgId}
        and coalesce(trim(service_org.identity_authority), '') = ''
        and coalesce(trim(service_org.identity_id), '') = ''
    )`;
  }

  if (
    implicitServiceOrgRole({
      email: ctx.userEmail,
      orgId,
      requestOrgId: ctx.orgId,
    })
  ) {
    const federationGuard =
      ctx.federationMembershipValidated === true
        ? sql`1=1`
        : sql`not exists (
            select 1 from organizations as federation_org
            where federation_org.id = ${orgId}
              and (
                coalesce(trim(federation_org.identity_authority), '') <> ''
                or coalesce(trim(federation_org.identity_id), '') <> ''
              )
          )`;
    return sql`exists (
      select 1 from org_members as service_alias_member
      where service_alias_member.org_id = ${orgId}
        and lower(service_alias_member.email) = ${normalizedUserEmail}
        and service_alias_member.federation_removal_pending_at is null
    ) and ${federationGuard}`;
  }

  return sql`1=1`;
}

async function isOrgMember(
  reg: ShareableResourceRegistration,
  memberOrgId: string,
  email: string,
  ctx: AccessContext,
): Promise<boolean> {
  const requestContext = getRequestContext();
  const verifiedServiceIdentity = requestContext?.verifiedServiceIdentity;
  const db = reg.getDb() as any;
  if (
    normalizeEmailForAccess(requestContext?.userEmail) === email &&
    normalizeEmailForAccess(verifiedServiceIdentity?.userEmail) === email &&
    implicitServiceOrgRole({
      email: verifiedServiceIdentity?.userEmail,
      orgId: memberOrgId,
      requestOrgId: requestContext?.orgId,
    }) &&
    verifiedServiceIdentity?.orgId === memberOrgId
  ) {
    try {
      const [organization] = await db
        .select({
          identityAuthority: organizations.identityAuthority,
          identityId: organizations.identityId,
        })
        .from(organizations)
        .where(eq(organizations.id, memberOrgId))
        .limit(1);
      if (
        organization &&
        !String(organization.identityAuthority ?? "").trim() &&
        !String(organization.identityId ?? "").trim()
      ) {
        return true;
      }
    } catch (error) {
      if (!isMissingOrganizationTableError(error)) throw error;
    }
  }

  let rows: Array<{ id: string }>;
  try {
    rows = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, memberOrgId),
          emailColumnMatches(orgMembers.email, email),
          isNull(orgMembers.federationRemovalPendingAt),
        ),
      )
      .limit(1);
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) throw error;
    return false;
  }
  if (rows.length === 0) return false;

  let organization: {
    identityAuthority: string | null;
    identityId: string | null;
  } | null = null;
  try {
    [organization] = await db
      .select({
        identityAuthority: organizations.identityAuthority,
        identityId: organizations.identityId,
      })
      .from(organizations)
      .where(eq(organizations.id, memberOrgId))
      .limit(1);
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) throw error;
    return true;
  }
  const linked =
    String(organization?.identityAuthority ?? "").trim() ||
    String(organization?.identityId ?? "").trim();
  if (!linked) return true;

  if (
    !(await evaluateFeatureFlagStrict(CROSS_APP_ORG_FEDERATION_FLAG.key, {
      userEmail: email,
      userKey: email,
      orgId: memberOrgId,
      transaction: ctx.transaction,
    }))
  ) {
    return true;
  }
  const { validateFederatedOrganizationMembershipForCurrentRequest } =
    await import("../org/federation.js");
  const validation =
    await validateFederatedOrganizationMembershipForCurrentRequest({
      orgId: memberOrgId,
      email,
    });
  return validation.active;
}

export function accessFilter(
  resourceTable: any,
  sharesTable: any,
  rawCtx: AccessContext = currentAccess(),
  minRole: ShareRole = "viewer",
  options: { includePublic?: boolean } = {},
): SQL {
  const reg = findRegistrationByTable(resourceTable);
  const ctx = resolveRegisteredAccessContext(reg, rawCtx);
  const { userEmail, orgId } = ctx;
  const normalizedUserEmail = normalizeEmailForAccess(userEmail);
  const publicAllowed = reg?.allowPublic !== false;
  const includePublic = (options.includePublic ?? false) && publicAllowed;
  const clauses: SQL[] = [];
  const orgMembership = orgId ? orgMembershipScope(ctx, orgId) : sql`1=1`;

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
          orgMembership,
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
                    and ${orgMembership}
                    and ${shareScope}
                    and ${minRoleSql(minRole)})`,
    );
  }

  if (reg?.supportsGroupShares && normalizedUserEmail && orgId) {
    const groupTable = sql.raw(workspaceUserGroupsTable());
    const federationGuard =
      ctx.federationMembershipValidated === true
        ? sql`1=1`
        : sql`not exists (
            select 1 from organizations as federation_org
            where federation_org.id = ${resourceTable.orgId}
              and (
                coalesce(trim(federation_org.identity_authority), '') <> ''
                or coalesce(trim(federation_org.identity_id), '') <> ''
              )
          )`;
    const groupMemberPredicate = sql`exists (
          select 1
          from jsonb_array_elements_text(
            workspace_group.member_emails_json::jsonb
          ) as group_member(email)
          where lower(group_member.email) = ${normalizedUserEmail}
        )`;
    clauses.push(
      sql`exists (select 1 from ${sharesTable}
                  where ${sharesTable.resourceId} = ${resourceTable.id}
                    and ${sharesTable.principalType} = 'group'
                    and ${minRoleSql(minRole)}
                    and exists (
                      select 1 from ${groupTable} as workspace_group
                      where workspace_group.id = ${sharesTable.principalId}
                        and workspace_group.org_id = ${resourceTable.orgId}
                        and workspace_group.org_id = ${orgId}
                        and ${orgMembership}
                        and ${federationGuard}
                        and exists (
                          select 1 from ${orgMembers} as workspace_member
                          where workspace_member.org_id = workspace_group.org_id
                            and lower(workspace_member.email) = ${normalizedUserEmail}
                            and workspace_member.federation_removal_pending_at is null
                        )
                        and ${groupMemberPredicate}
                    ))`,
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
  role: "owner" | ShareRole;
  resource: any;
}

/**
 * Minimal resource shape returned when a caller opts into a projected access
 * load via `{ skipResourceBody: true }`. Contains exactly the columns the
 * access-decision logic itself reads — identity, ownership, org scope, and
 * visibility, plus any columns the registration's availability rule reads —
 * never a resource type's heavy body columns (`data`, `content`, and similar
 * blobs).
 */
export interface AccessProjectedResource {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: Visibility;
}

export interface ResolvedAccessProjected {
  role: "owner" | ShareRole;
  resource: AccessProjectedResource;
}

export interface ResolveAccessOptions {
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
  let current = err as
    | { code?: unknown; message?: unknown; cause?: unknown }
    | undefined;
  for (let attempt = 0; current && attempt < 4; attempt++) {
    const code = typeof current.code === "string" ? current.code : "";
    const message = typeof current.message === "string" ? current.message : "";
    if (code === "42703" || /column .* does not exist/i.test(message)) {
      return message.match(/column ["']?([\w.]+)["']?/i)?.[1] ?? null;
    }
    current =
      current.cause && typeof current.cause === "object"
        ? (current.cause as typeof current)
        : undefined;
  }
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

function projectedAccessColumns(
  reg: ShareableResourceRegistration,
): Record<string, unknown> {
  const resourceTable = reg.resourceTable;
  const columns: Record<string, unknown> = {
    id: resourceTable.id,
    ownerEmail: resourceTable.ownerEmail,
    orgId: resourceTable.orgId,
    visibility: resourceTable.visibility,
  };
  for (const key of [
    ...(reg.availability?.columns ?? []),
    ...(reg.fallbackAccessContext?.columns ?? []),
  ]) {
    if (resourceTable[key]) columns[key] = resourceTable[key];
  }
  return columns;
}

/**
 * Whether a loaded row passes its registration's availability rule. A row
 * loaded without an availability column (an older schema) counts as
 * available, the same as a registration without a rule.
 */
export function isResourceAvailable(
  reg: ShareableResourceRegistration,
  resource: any,
): boolean {
  if (!reg.availability) return true;
  if (reg.availability.columns.some((column) => !(column in resource))) {
    return true;
  }
  return reg.availability.isAvailable(resource);
}

function hasDynamicPublicAccessRoleResolver(
  reg: ShareableResourceRegistration,
): boolean {
  return typeof reg.publicAccessRole === "function";
}

async function loadResourceForAccess(
  reg: ShareableResourceRegistration,
  resourceId: string,
  options: ResolveAccessOptions = {},
): Promise<any> {
  const db = reg.getDb() as any;
  // Hooks that receive the row may read any column, so they get all of it.
  const useProjection =
    options.skipResourceBody === true &&
    !hasDynamicPublicAccessRoleResolver(reg) &&
    !reg.canManageAccess;
  const projectedColumns = useProjection ? projectedAccessColumns(reg) : null;
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
  const { access } = await inAccessTransaction(rawCtx, () =>
    loadAndResolveAccess(resourceType, resourceId, rawCtx, options),
  );
  return access;
}

function inAccessTransaction<T>(
  ctx: AccessContext,
  run: () => Promise<T>,
): Promise<T> {
  return ctx.transaction ? withDbExec(ctx.transaction, run) : run();
}

interface LoadedAccess {
  access: ResolvedAccess | null;
  /** The row access was resolved against, kept even when access is denied. */
  resource: any;
  reg: ShareableResourceRegistration;
}

async function loadAndResolveAccess(
  resourceType: string,
  resourceId: string,
  rawCtx: AccessContext,
  options: ResolveAccessOptions,
): Promise<LoadedAccess> {
  const registered = requireShareableResource(resourceType);
  const transaction = rawCtx.transaction ?? getScopedDbExec();
  const transactionDb = transaction
    ? drizzleProxy(async (query, params) => {
        const result = await transaction.execute({ sql: query, args: params });
        return { rows: result.rows.map((row) => Object.values(row)) };
      })
    : null;
  const transactionCtx = transaction ? { ...rawCtx, transaction } : rawCtx;
  const reg = transactionDb
    ? { ...registered, getDb: () => transactionDb }
    : registered;
  const ctx = resolveRegisteredAccessContext(reg, transactionCtx);

  const resource = await loadResourceForAccess(reg, resourceId, options);
  if (!resource) return { access: null, resource: null, reg };
  return {
    access: await accessToResource(reg, resourceId, resource, ctx),
    resource,
    reg,
  };
}

async function accessToResource(
  reg: ShareableResourceRegistration,
  resourceId: string,
  resource: any,
  ctx: AccessContext,
): Promise<ResolvedAccess | null> {
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
    const publicRole = await publicAccessRoleForResource(reg, resource, ctx);
    const role = await highestShareRole(reg, resourceId, ctx, resource);
    return { role: higherShareRole(publicRole, role), resource };
  }
  if (
    resource.visibility === "org" &&
    resource.orgId &&
    normalizedUserEmail &&
    (await isOrgMember(reg, resource.orgId, normalizedUserEmail, ctx))
  ) {
    const role = await highestShareRole(reg, resourceId, ctx, resource);
    return { role: role ?? "viewer", resource };
  }
  const role = await highestShareRole(reg, resourceId, ctx, resource);
  if (role) return { role, resource };
  return null;
}

/**
 * What a link to a shareable resource can honestly say to the person who
 * opened it.
 *
 * - `allowed`: they can open it.
 * - `trashed`: they could open it, but it fails the registration's
 *   availability rule (for example it is in the trash).
 * - `denied`: they are signed in, can't open it, and it exists.
 * - `missing`: they are signed in and it doesn't exist, or it is unavailable
 *   and they can't open it, so trash looks the same as deleted.
 * - `signed-out`: nobody is signed in, so nothing about it is revealed, not
 *   even whether it exists or is public.
 */
export type ResourceAccessState =
  | "allowed"
  | "trashed"
  | "denied"
  | "missing"
  | "signed-out";

export interface ResourceAccessStatus {
  state: ResourceAccessState;
  /** The viewer's role, only when they can open the resource. */
  role?: ResolvedAccess["role"];
}

/**
 * Resolves a link's {@link ResourceAccessState} for the current viewer. It
 * never returns the resource's title, owner, visibility, or workspace, and
 * database failures stay errors rather than reading as `missing`. A
 * signed-out visitor gets `signed-out` before any row is read, so nothing
 * about the link, including whether it exists, depends on the resource.
 */
export async function resolveAccessStatus(
  resourceType: string,
  resourceId: string,
  ctx: AccessContext = currentAccess(),
): Promise<ResourceAccessStatus> {
  requireShareableResource(resourceType);
  if (!normalizeEmailForAccess(ctx.userEmail)) return { state: "signed-out" };
  return inAccessTransaction(ctx, async () => {
    const loaded = await loadAndResolveAccess(resourceType, resourceId, ctx, {
      skipResourceBody: true,
    });
    const { resource, reg } = loaded;
    if (!resource) return { state: "missing" };
    let access = loaded.access;
    if (!access && reg.fallbackAccessContext) {
      const fallback = await reg.fallbackAccessContext.resolve(resource, ctx);
      if (fallback) {
        access = await accessToResource(
          reg,
          resourceId,
          resource,
          resolveRegisteredAccessContext(reg, fallback),
        );
      }
    }
    const available = isResourceAvailable(reg, resource);
    if (!access) return { state: available ? "denied" : "missing" };
    return { state: available ? "allowed" : "trashed", role: access.role };
  });
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
    if (await isOrgMember(reg, resource.orgId, normalizedUserEmail, ctx)) {
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
  const { access } = await loadAndResolveAccess(
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
