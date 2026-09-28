import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";

import { withDbExec, type DbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "../org/feature-flags.js";
import { isMissingOrganizationTableError } from "../org/membership.js";
import { orgMembers } from "../org/schema.js";
import { organizations } from "../org/schema.js";
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

async function isOrgMember(
  reg: ShareableResourceRegistration,
  memberOrgId: string,
  email: string,
  ctx: AccessContext,
): Promise<boolean> {
  const db = reg.getDb() as any;
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

  if (reg?.supportsGroupShares && normalizedUserEmail && orgId) {
    const groupTable = sql.raw(workspaceUserGroupsTable());
    const federationGuard =
      ctx.federationMembershipValidated === true
        ? sql`1=1`
        : sql`not exists (
            select 1 from organizations as federation_org
            where federation_org.id = ${resourceTable.orgId}
              and (
                federation_org.identity_authority is not null
                or federation_org.identity_id is not null
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

function projectedAccessColumns(resourceTable: any): Record<string, unknown> {
  return {
    id: resourceTable.id,
    ownerEmail: resourceTable.ownerEmail,
    orgId: resourceTable.orgId,
    visibility: resourceTable.visibility,
  };
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
  return rawCtx.transaction
    ? withDbExec(rawCtx.transaction, () =>
        resolveAccessImpl(resourceType, resourceId, rawCtx, options),
      )
    : resolveAccessImpl(resourceType, resourceId, rawCtx, options);
}

async function resolveAccessImpl(
  resourceType: string,
  resourceId: string,
  rawCtx: AccessContext = currentAccess(),
  options: ResolveAccessOptions = {},
): Promise<ResolvedAccess | ResolvedAccessProjected | null> {
  const registered = requireShareableResource(resourceType);
  const transaction = rawCtx.transaction;
  const transactionDb = transaction
    ? drizzleProxy(async (query, params) => {
        const result = await transaction.execute({ sql: query, args: params });
        return { rows: result.rows.map((row) => Object.values(row)) };
      })
    : null;
  const reg = transactionDb
    ? { ...registered, getDb: () => transactionDb }
    : registered;
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
