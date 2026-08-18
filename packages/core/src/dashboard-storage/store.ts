import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { AccessContext } from "../sharing/access.js";
import { accessFilter, assertAccess } from "../sharing/access.js";
import { registerShareableResource } from "../sharing/registry.js";
import type { DashboardStorageSchema } from "./schema.js";

export interface DashboardRecord<
  TKind extends string = string,
  TConfig = Record<string, unknown>,
> {
  id: string;
  kind: TKind;
  title: string;
  config: TConfig;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
}

export interface DashboardRevisionRecord<
  TKind extends string = string,
  TConfig = Record<string, unknown>,
> {
  id: string;
  dashboardId: string;
  kind: TKind;
  title: string;
  config: TConfig;
  createdAt: string;
  createdBy: string | null;
}

export interface DashboardWriteInput<
  TKind extends string = string,
  TConfig = Record<string, unknown>,
> {
  id: string;
  kind: TKind;
  title: string;
  config: TConfig;
  expectedUpdatedAt?: string;
}

export class DashboardStorageConflictError extends Error {
  constructor(id: string) {
    super(`Dashboard "${id}" changed between read and write.`);
    this.name = "DashboardStorageConflictError";
  }
}

export interface DashboardStorageOptions<TKind extends string, TConfig> {
  schema: DashboardStorageSchema;
  getDb: () => any;
  resourceType: string;
  displayName?: string;
  maxRevisions?: number;
  validateKind?: (kind: string) => kind is TKind;
  parseConfig?: (raw: string) => TConfig;
  serializeConfig?: (config: TConfig) => string;
  getResourcePath?: (dashboard: { id: string }) => string;
  allowPublic?: boolean;
  requireOrgMemberForUserShares?: boolean;
  onChange?: (event: {
    type: "change" | "delete";
    dashboard: DashboardRecord<TKind, TConfig>;
  }) => void;
}

function affectedRowCount(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const candidate = result as Record<string, unknown>;
  for (const key of ["rowCount", "rowsAffected", "changes"]) {
    const value = candidate[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function requireWriter(ctx: AccessContext): string {
  const email = ctx.userEmail?.trim().toLowerCase();
  if (!email)
    throw new Error("Dashboard writes require an authenticated user.");
  return email;
}

export function createDashboardStorage<
  TKind extends string = string,
  TConfig = Record<string, unknown>,
>(options: DashboardStorageOptions<TKind, TConfig>) {
  const parseConfig =
    options.parseConfig ?? ((raw: string) => JSON.parse(raw) as TConfig);
  const serializeConfig = options.serializeConfig ?? JSON.stringify;
  const maxRevisions = Math.max(1, options.maxRevisions ?? 50);
  const { dashboards, dashboardRevisions, dashboardShares } = options.schema;

  function recordFromRow(row: any): DashboardRecord<TKind, TConfig> {
    if (options.validateKind && !options.validateKind(row.kind)) {
      throw new Error(`Unsupported dashboard kind: ${String(row.kind)}`);
    }
    return {
      id: row.id,
      kind: row.kind as TKind,
      title: row.title,
      config: parseConfig(row.config),
      ownerEmail: row.ownerEmail,
      orgId: row.orgId ?? null,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null,
      archivedAt: row.archivedAt ?? null,
    };
  }

  function revisionFromRow(row: any): DashboardRevisionRecord<TKind, TConfig> {
    return {
      id: row.id,
      dashboardId: row.dashboardId,
      kind: row.kind as TKind,
      title: row.title,
      config: parseConfig(row.config),
      createdAt: row.createdAt,
      createdBy: row.createdBy ?? null,
    };
  }

  async function get(id: string, ctx: AccessContext) {
    const [row] = await options
      .getDb()
      .select()
      .from(dashboards)
      .where(
        and(
          eq(dashboards.id, id),
          accessFilter(dashboards, dashboardShares, ctx),
        ),
      )
      .limit(1);
    return row ? recordFromRow(row) : null;
  }

  async function list(
    ctx: AccessContext,
    archive: "active" | "archived" | "all" = "active",
  ) {
    const archiveClause =
      archive === "active"
        ? isNull(dashboards.archivedAt)
        : archive === "archived"
          ? and(
              accessFilter(dashboards, dashboardShares, ctx),
              isNotNull(dashboards.archivedAt),
            )
          : undefined;
    const scope = accessFilter(dashboards, dashboardShares, ctx);
    const where = archiveClause
      ? archive === "archived"
        ? archiveClause
        : and(scope, archiveClause)
      : scope;
    const rows = await options
      .getDb()
      .select()
      .from(dashboards)
      .where(where)
      .orderBy(desc(dashboards.updatedAt));
    return rows.map(recordFromRow);
  }

  async function pruneRevisions(db: any, dashboardId: string) {
    const rows = await db
      .select({ id: dashboardRevisions.id })
      .from(dashboardRevisions)
      .where(eq(dashboardRevisions.dashboardId, dashboardId))
      .orderBy(desc(dashboardRevisions.createdAt));
    const staleIds = rows
      .slice(maxRevisions)
      .map((row: { id: string }) => row.id);
    if (staleIds.length > 0) {
      await db
        .delete(dashboardRevisions)
        .where(inArray(dashboardRevisions.id, staleIds));
    }
  }

  async function snapshot(
    db: any,
    dashboard: DashboardRecord<TKind, TConfig>,
    writer: string,
  ) {
    await db.insert(dashboardRevisions).values({
      id: `dashboard-revision-${randomUUID()}`,
      dashboardId: dashboard.id,
      kind: dashboard.kind,
      title: dashboard.title,
      config: serializeConfig(dashboard.config),
      createdBy: writer,
      ownerEmail: dashboard.ownerEmail,
      orgId: dashboard.orgId,
      visibility: dashboard.visibility,
    });
    await pruneRevisions(db, dashboard.id);
  }

  async function write(
    input: DashboardWriteInput<TKind, TConfig>,
    ctx: AccessContext,
  ) {
    const writer = requireWriter(ctx);
    const existing = await get(input.id, ctx);
    const db = options.getDb();
    if (!existing) {
      if (input.expectedUpdatedAt !== undefined) {
        throw new DashboardStorageConflictError(input.id);
      }
      await db.insert(dashboards).values({
        id: input.id,
        kind: input.kind,
        title: input.title,
        config: serializeConfig(input.config),
        ownerEmail: writer,
        orgId: ctx.orgId ?? null,
        visibility: "private",
        updatedBy: writer,
      });
    } else {
      await assertAccess(options.resourceType, input.id, "editor", ctx);
      const values = {
        kind: input.kind,
        title: input.title,
        config: serializeConfig(input.config),
        updatedAt: new Date().toISOString(),
        updatedBy: writer,
      };
      await db.transaction(async (tx: any) => {
        if (input.expectedUpdatedAt !== undefined) {
          const result = await tx
            .update(dashboards)
            .set(values)
            .where(
              and(
                eq(dashboards.id, input.id),
                eq(dashboards.updatedAt, input.expectedUpdatedAt),
              ),
            );
          const affected = affectedRowCount(result);
          if (affected === undefined) {
            throw new Error(
              "Dashboard storage requires affected-row counts for conditional writes.",
            );
          }
          if (affected === 0) throw new DashboardStorageConflictError(input.id);
        } else {
          await tx
            .update(dashboards)
            .set(values)
            .where(eq(dashboards.id, input.id));
        }
        await snapshot(tx, existing, writer);
      });
    }
    const stored = await get(input.id, ctx);
    if (!stored) throw new Error(`Dashboard "${input.id}" was not persisted.`);
    options.onChange?.({ type: "change", dashboard: stored });
    return stored;
  }

  async function listRevisions(id: string, ctx: AccessContext) {
    const dashboard = await get(id, ctx);
    if (!dashboard) return [];
    await assertAccess(options.resourceType, id, "viewer", ctx);
    const rows = await options
      .getDb()
      .select()
      .from(dashboardRevisions)
      .where(eq(dashboardRevisions.dashboardId, id))
      .orderBy(desc(dashboardRevisions.createdAt))
      .limit(maxRevisions);
    return rows.map(revisionFromRow);
  }

  async function restore(id: string, revisionId: string, ctx: AccessContext) {
    const existing = await get(id, ctx);
    if (!existing) return null;
    await assertAccess(options.resourceType, id, "editor", ctx);
    const [row] = await options
      .getDb()
      .select()
      .from(dashboardRevisions)
      .where(
        and(
          eq(dashboardRevisions.id, revisionId),
          eq(dashboardRevisions.dashboardId, id),
        ),
      )
      .limit(1);
    if (!row) return null;
    const revision = revisionFromRow(row);
    return write(
      {
        id,
        kind: revision.kind,
        title: revision.title,
        config: revision.config,
        expectedUpdatedAt: existing.updatedAt,
      },
      ctx,
    );
  }

  function registerShareable() {
    registerShareableResource({
      type: options.resourceType,
      resourceTable: dashboards,
      sharesTable: dashboardShares,
      displayName: options.displayName ?? "Dashboard",
      titleColumn: "title",
      getResourcePath: options.getResourcePath,
      allowPublic: options.allowPublic,
      requireOrgMemberForUserShares: options.requireOrgMemberForUserShares,
      getDb: options.getDb,
    });
  }

  return { get, list, write, listRevisions, restore, registerShareable };
}
