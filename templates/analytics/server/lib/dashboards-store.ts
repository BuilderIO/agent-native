/**
 * Dashboards + analyses store — SQL first, legacy settings-KV as
 * read-only fallback. Writes always go to SQL.
 *
 * Lazy migration: when a record is fetched by id and exists only in the
 * legacy settings store, it is copied into SQL on the fly using the
 * settings key as the source of truth for `ownerEmail` / `orgId` /
 * `visibility`, then returned. Subsequent reads hit SQL directly.
 *
 * - `u:<email>:dashboard-{id}`     → kind='explorer', owner=email,  visibility='private'
 * - `u:<email>:sql-dashboard-{id}` → kind='sql',      owner=email,  visibility='private'
 * - `o:<orgId>:sql-dashboard-{id}` → kind='sql',      owner=caller, visibility='org'
 * - `adhoc-analysis-{id}`          → owner=caller,   legacy visibility from its source key
 */
import { isPostgres } from "@agent-native/core/db";
import { recordChange } from "@agent-native/core/server";
import {
  getAllSettings,
  getOrgSetting,
  getUserSetting,
  deleteOrgSetting,
  deleteUserSetting,
} from "@agent-native/core/settings";
import {
  accessFilter,
  assertAccess,
  roleSatisfies,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export type DashboardKind = "explorer" | "sql";
export type AccessRole = "owner" | ShareRole;

export interface DashboardRecord {
  id: string;
  kind: DashboardKind;
  title: string;
  config: Record<string, unknown>;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  /** ISO timestamp set when the dashboard is archived. Null = active. */
  archivedAt: string | null;
  /** ISO timestamp set when the dashboard is hidden from default navigation. */
  hiddenAt: string | null;
  hiddenBy: string | null;
  /** Effective role for the caller when loaded by id. List rows omit this. */
  role?: AccessRole;
  canEdit?: boolean;
  canManage?: boolean;
}

/** Metadata-only dashboard row for navigation and picker surfaces. */
export interface DashboardSummaryRecord {
  id: string;
  kind: DashboardKind;
  name: string;
  parentId: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
}

export interface DashboardRevisionRecord {
  id: string;
  dashboardId: string;
  kind: DashboardKind;
  title: string;
  config: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
}

export type DashboardArchiveFilter = "active" | "archived" | "all";
export type DashboardHiddenFilter = "visible" | "hidden" | "all";

export interface AnalysisRecord {
  id: string;
  name: string;
  description: string;
  question: string;
  instructions: string;
  dataSources: string[];
  resultMarkdown: string;
  resultData: Record<string, unknown> | null;
  author: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp set when the analysis is hidden from default navigation. */
  hiddenAt: string | null;
  hiddenBy: string | null;
  /** Effective role for the caller when loaded by id. List rows omit this. */
  role?: AccessRole;
  canEdit?: boolean;
  canManage?: boolean;
}

export interface AnalysisRevisionRecord {
  id: string;
  analysisId: string;
  name: string;
  description: string;
  question: string;
  instructions: string;
  dataSources: string[];
  resultMarkdown: string;
  resultData: Record<string, unknown> | null;
  createdAt: string;
  createdBy: string | null;
}

interface AccessCtx {
  email: string;
  orgId: string | null;
}

const SQL_PREFIX = "sql-dashboard-";
const EXPLORER_PREFIX = "dashboard-";
const ANALYSIS_PREFIX = "adhoc-analysis-";
const DASHBOARD_REVISION_LIMIT = 50;
const ANALYSIS_REVISION_LIMIT = 30;

function nowIso(): string {
  return new Date().toISOString();
}

function nanoidFallback(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Normalize affected-row metadata from every createGetDb backend: libSQL,
 * PGlite, Neon, postgres.js, better-sqlite3, and D1. Mirrors
 * templates/design/actions/update-design.ts's `affectedRowCount`.
 */
function affectedRowCount(result: unknown): number | undefined {
  const candidate = result as
    | {
        rowsAffected?: unknown;
        affectedRows?: unknown;
        rowCount?: unknown;
        count?: unknown;
        changes?: unknown;
        meta?: { changes?: unknown };
      }
    | undefined;
  const value =
    candidate?.rowsAffected ??
    candidate?.affectedRows ??
    candidate?.rowCount ??
    candidate?.count ??
    candidate?.changes ??
    candidate?.meta?.changes;
  return typeof value === "number" ? value : undefined;
}

/**
 * Thrown when a fenced `upsertDashboard` write (an `expectedUpdatedAt` was
 * supplied) loses its compare-and-swap because another writer changed the
 * row first. Callers should re-read the dashboard and re-apply their mutation
 * against the fresh config — see `upsertDashboardWithRetry`.
 */
export class DashboardConflictError extends Error {
  constructor(id: string) {
    super(`Dashboard "${id}" changed between read and write.`);
    this.name = "DashboardConflictError";
  }
}

/**
 * Thrown when a fenced `upsertAnalysis` write (an `expectedUpdatedAt` was
 * supplied) loses its compare-and-swap because another writer changed the
 * row first. Callers should re-read the analysis and re-apply their mutation
 * against the fresh record — see `upsertAnalysisWithRetry`.
 */
export class AnalysisConflictError extends Error {
  constructor(id: string) {
    super(`Analysis "${id}" changed between read and write.`);
    this.name = "AnalysisConflictError";
  }
}

function changeScope(
  ownerEmail: string,
  orgId: string | null,
  visibility: "private" | "org" | "public",
): { owner?: string; orgId?: string } {
  if (visibility === "public") return {};
  if (visibility === "org" && orgId) return { orgId };
  return { owner: ownerEmail };
}

function recordScopedChange(
  source: "dashboards" | "analyses" | "dashboard-views",
  type: "change" | "delete",
  key: string,
  ownerEmail: string,
  orgId: string | null,
  visibility: "private" | "org" | "public",
): void {
  recordChange({
    source,
    type,
    key,
    ...changeScope(ownerEmail, orgId, visibility),
  });
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

function accessFields(role?: AccessRole): {
  role?: AccessRole;
  canEdit?: boolean;
  canManage?: boolean;
} {
  if (!role) return {};
  return {
    role,
    canEdit: roleSatisfies(role, "editor"),
    canManage: roleSatisfies(role, "admin"),
  };
}

function rowToDashboard(row: any, role?: AccessRole): DashboardRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    config:
      typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null,
    archivedAt: row.archivedAt ?? null,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
    ...accessFields(role),
  };
}

function rowToDashboardRevision(row: any): DashboardRevisionRecord {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    kind: row.kind,
    title: row.title,
    config:
      typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? null,
  };
}

function configFromSettings(data: Record<string, unknown>): {
  title: string;
  config: Record<string, unknown>;
} {
  const title =
    typeof (data as any).name === "string"
      ? (data as any).name
      : typeof (data as any).title === "string"
        ? (data as any).title
        : "Untitled";
  return { title, config: data };
}

async function migrateDashboardFromSettings(
  id: string,
  kind: DashboardKind,
  settingsValue: Record<string, unknown>,
  ownerEmail: string,
  orgId: string | null,
  visibility: DashboardRecord["visibility"],
  role?: AccessRole,
): Promise<DashboardRecord> {
  const { title, config } = configFromSettings(settingsValue);
  const db = getDb() as any;
  const createdAt =
    (typeof (settingsValue as any).createdAt === "string" &&
      (settingsValue as any).createdAt) ||
    nowIso();
  const updatedAt =
    (typeof (settingsValue as any).updatedAt === "string" &&
      (settingsValue as any).updatedAt) ||
    createdAt;
  await db
    .insert(schema.dashboards)
    .values({
      id,
      kind,
      title,
      config: JSON.stringify(config),
      ownerEmail,
      orgId,
      visibility,
      createdAt,
      updatedAt,
      updatedBy: ownerEmail,
    })
    .onConflictDoNothing();
  // guard:allow-unscoped — read-after-write of the row just inserted above
  // with ownerEmail from ctx; eq(id) is sufficient because we know the id we
  // just wrote and onConflictDoNothing leaves any pre-existing row untouched.
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  recordScopedChange("dashboards", "change", id, ownerEmail, orgId, visibility);
  return rowToDashboard(row, role);
}

async function findLegacyDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<{
  data: Record<string, unknown>;
  kind: DashboardKind;
  ownerEmail: string;
  orgId: string | null;
  visibility: DashboardRecord["visibility"];
} | null> {
  // Org-scoped SQL dashboard
  if (ctx.orgId) {
    const v = await getOrgSetting(ctx.orgId, `${SQL_PREFIX}${id}`);
    if (v)
      return {
        data: v,
        kind: "sql",
        ownerEmail: ctx.email,
        orgId: ctx.orgId,
        visibility: "org",
      };
  }
  // User-scoped SQL dashboard
  if (ctx.email) {
    const v = await getUserSetting(ctx.email, `${SQL_PREFIX}${id}`);
    if (v)
      return {
        data: v,
        kind: "sql",
        ownerEmail: ctx.email,
        orgId: null,
        visibility: "private",
      };
  }
  // User-scoped Explorer dashboard
  if (ctx.email) {
    const v = await getUserSetting(ctx.email, `${EXPLORER_PREFIX}${id}`);
    if (v)
      return {
        data: v,
        kind: "explorer",
        ownerEmail: ctx.email,
        orgId: null,
        visibility: "private",
      };
  }
  return null;
}

/** Fetch a dashboard by id, enforcing access. Lazy-migrates from legacy keys. */
export async function getDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  // 1) SQL first, with access check.
  const access = await resolveAccess("dashboard", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (access) return rowToDashboard(access.resource, access.role);
  // 2) Legacy fallback.
  const legacy = await findLegacyDashboard(id, ctx);
  if (!legacy) return null;
  return migrateDashboardFromSettings(
    id,
    legacy.kind,
    legacy.data,
    legacy.ownerEmail,
    legacy.orgId,
    legacy.visibility,
    "owner",
  );
}

/**
 * List dashboards visible to the caller. Union of SQL rows + not-yet-migrated
 * legacy keys.
 *
 * `archived` controls whether archived rows are included:
 *   - `"active"` (default): hide archived rows
 *   - `"archived"`: only archived rows
 *   - `"all"`: both
 *
 * Legacy settings rows have no archive concept, so they are treated as active.
 * Legacy settings rows have no hidden concept, so hidden-only queries skip the
 * legacy scan.
 */
export async function listDashboards(
  ctx: AccessCtx,
  filter?: {
    kind?: DashboardKind;
    archived?: DashboardArchiveFilter;
    hidden?: DashboardHiddenFilter;
  },
): Promise<DashboardRecord[]> {
  const db = getDb() as any;
  const archived = filter?.archived ?? "active";
  const hidden = filter?.hidden ?? "visible";
  const conditions: any[] = [
    accessFilter(schema.dashboards, schema.dashboardShares, {
      userEmail: ctx.email,
      orgId: ctx.orgId ?? undefined,
    }),
  ];
  if (filter?.kind) conditions.push(eq(schema.dashboards.kind, filter.kind));
  if (archived === "active")
    conditions.push(isNull(schema.dashboards.archivedAt));
  else if (archived === "archived")
    conditions.push(isNotNull(schema.dashboards.archivedAt));
  if (hidden === "visible") conditions.push(isNull(schema.dashboards.hiddenAt));
  else if (hidden === "hidden")
    conditions.push(isNotNull(schema.dashboards.hiddenAt));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db.select().from(schema.dashboards).where(where);
  const out: DashboardRecord[] = rows.map(rowToDashboard);
  const seen = new Set(out.map((r) => r.id));
  // Legacy: scan settings once and surface anything not yet migrated.
  // Archived/hidden state doesn't exist in legacy rows, so skip the legacy scan
  // entirely when the caller wants archived-only or hidden-only records.
  if (archived === "archived" || hidden === "hidden") return out;
  try {
    const all = await getAllSettings();
    for (const [key, value] of Object.entries(all)) {
      let id: string | null = null;
      let kind: DashboardKind | null = null;
      let ownerEmail = ctx.email;
      let orgId: string | null = null;
      let visibility: DashboardRecord["visibility"] = "private";
      if (ctx.orgId && key.startsWith(`o:${ctx.orgId}:${SQL_PREFIX}`)) {
        id = key.slice(`o:${ctx.orgId}:${SQL_PREFIX}`.length);
        kind = "sql";
        orgId = ctx.orgId;
        visibility = "org";
      } else if (ctx.email && key.startsWith(`u:${ctx.email}:${SQL_PREFIX}`)) {
        id = key.slice(`u:${ctx.email}:${SQL_PREFIX}`.length);
        kind = "sql";
      } else if (
        ctx.email &&
        key.startsWith(`u:${ctx.email}:${EXPLORER_PREFIX}`)
      ) {
        id = key.slice(`u:${ctx.email}:${EXPLORER_PREFIX}`.length);
        kind = "explorer";
      }
      if (!id || !kind) continue;
      if (filter?.kind && filter.kind !== kind) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const rec = await migrateDashboardFromSettings(
        id,
        kind,
        value as Record<string, unknown>,
        ownerEmail,
        orgId,
        visibility,
      );
      out.push(rec);
    }
  } catch {
    // Legacy scan is best-effort.
  }
  return out;
}

/**
 * List dashboard metadata without transferring or parsing each dashboard's
 * potentially very large panel config. This is the list-path counterpart to
 * `getDashboard`, which remains the full-config detail read.
 *
 * Legacy settings rows are surfaced directly instead of being migrated during
 * the read. Opening one by id still performs the existing lazy migration, but
 * navigation no longer turns an ordinary list into N sequential writes.
 */
export async function listDashboardSummaries(
  ctx: AccessCtx,
  filter?: {
    kind?: DashboardKind;
    archived?: DashboardArchiveFilter;
    hidden?: DashboardHiddenFilter;
  },
): Promise<DashboardSummaryRecord[]> {
  const db = getDb() as any;
  const archived = filter?.archived ?? "active";
  const hidden = filter?.hidden ?? "visible";
  const conditions: any[] = [
    accessFilter(schema.dashboards, schema.dashboardShares, {
      userEmail: ctx.email,
      orgId: ctx.orgId ?? undefined,
    }),
  ];
  if (filter?.kind) conditions.push(eq(schema.dashboards.kind, filter.kind));
  if (archived === "active")
    conditions.push(isNull(schema.dashboards.archivedAt));
  else if (archived === "archived")
    conditions.push(isNotNull(schema.dashboards.archivedAt));
  if (hidden === "visible") conditions.push(isNull(schema.dashboards.hiddenAt));
  else if (hidden === "hidden")
    conditions.push(isNotNull(schema.dashboards.hiddenAt));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const parentId = isPostgres()
    ? sql<string | null>`(${schema.dashboards.config}::jsonb ->> 'parentId')`
    : sql<
        string | null
      >`json_extract(${schema.dashboards.config}, '$.parentId')`;
  const rows = await db
    .select({
      id: schema.dashboards.id,
      kind: schema.dashboards.kind,
      name: schema.dashboards.title,
      parentId,
      ownerEmail: schema.dashboards.ownerEmail,
      orgId: schema.dashboards.orgId,
      visibility: schema.dashboards.visibility,
      createdAt: schema.dashboards.createdAt,
      updatedAt: schema.dashboards.updatedAt,
      archivedAt: schema.dashboards.archivedAt,
      hiddenAt: schema.dashboards.hiddenAt,
      hiddenBy: schema.dashboards.hiddenBy,
    })
    .from(schema.dashboards)
    .where(where);
  const out: DashboardSummaryRecord[] = rows.map((row: any) => ({
    ...row,
    parentId: typeof row.parentId === "string" ? row.parentId : null,
    orgId: row.orgId ?? null,
    archivedAt: row.archivedAt ?? null,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
  }));
  const seen = new Set(out.map((row) => row.id));

  if (archived === "archived" || hidden === "hidden") return out;
  try {
    const all = await getAllSettings();
    for (const [key, value] of Object.entries(all)) {
      let id: string | null = null;
      let kind: DashboardKind | null = null;
      let orgId: string | null = null;
      let visibility: DashboardSummaryRecord["visibility"] = "private";
      if (ctx.orgId && key.startsWith(`o:${ctx.orgId}:${SQL_PREFIX}`)) {
        id = key.slice(`o:${ctx.orgId}:${SQL_PREFIX}`.length);
        kind = "sql";
        orgId = ctx.orgId;
        visibility = "org";
      } else if (ctx.email && key.startsWith(`u:${ctx.email}:${SQL_PREFIX}`)) {
        id = key.slice(`u:${ctx.email}:${SQL_PREFIX}`.length);
        kind = "sql";
      } else if (
        ctx.email &&
        key.startsWith(`u:${ctx.email}:${EXPLORER_PREFIX}`)
      ) {
        id = key.slice(`u:${ctx.email}:${EXPLORER_PREFIX}`.length);
        kind = "explorer";
      }
      if (!id || !kind || seen.has(id)) continue;
      if (filter?.kind && filter.kind !== kind) continue;
      seen.add(id);
      const config = value as Record<string, unknown>;
      const { title } = configFromSettings(config);
      const createdAt =
        typeof config.createdAt === "string" ? config.createdAt : nowIso();
      out.push({
        id,
        kind,
        name: title,
        parentId: typeof config.parentId === "string" ? config.parentId : null,
        ownerEmail: ctx.email,
        orgId,
        visibility,
        createdAt,
        updatedAt:
          typeof config.updatedAt === "string" ? config.updatedAt : createdAt,
        archivedAt: null,
        hiddenAt: null,
        hiddenBy: null,
      });
    }
  } catch {
    // Legacy scan is best-effort.
  }
  return out;
}

async function pruneDashboardRevisions(
  db: any,
  dashboardId: string,
): Promise<void> {
  const rows = await db
    .select({ id: schema.dashboardRevisions.id })
    .from(schema.dashboardRevisions)
    .where(eq(schema.dashboardRevisions.dashboardId, dashboardId))
    .orderBy(desc(schema.dashboardRevisions.createdAt));
  const stale = rows.slice(DASHBOARD_REVISION_LIMIT);
  for (const row of stale) {
    await db
      .delete(schema.dashboardRevisions)
      .where(eq(schema.dashboardRevisions.id, row.id));
  }
}

async function snapshotDashboardRevision(
  db: any,
  dashboard: DashboardRecord,
  ctx: AccessCtx,
): Promise<void> {
  await db.insert(schema.dashboardRevisions).values({
    id: `dashrev-${Date.now()}-${nanoidFallback()}`,
    dashboardId: dashboard.id,
    kind: dashboard.kind,
    title: dashboard.title,
    config: JSON.stringify(dashboard.config),
    createdAt: nowIso(),
    createdBy: ctx.email,
    ownerEmail: dashboard.ownerEmail,
    orgId: dashboard.orgId,
  });
  await pruneDashboardRevisions(db, dashboard.id);
}

/**
 * Upsert a dashboard. On create, caller becomes owner and visibility defaults
 * to `private`; users explicitly promote useful dashboards to org/public via
 * sharing. On update, `assertAccess` requires `editor`.
 *
 * `expectedUpdatedAt` fences the update against concurrent writers: pass the
 * `updatedAt` observed by an earlier `getDashboard` call and the UPDATE only
 * applies `WHERE id = ? AND updated_at = ?`. If another writer already saved
 * in between, the fenced UPDATE affects zero rows and this throws
 * `DashboardConflictError` instead of silently clobbering their write. Omit
 * it (the default) to keep the prior unconditional last-write-wins behavior,
 * which existing callers (legacy migration, revision restore, and any
 * one-shot write that isn't a read-modify-write) still rely on.
 */
export async function upsertDashboard(
  id: string,
  kind: DashboardKind,
  body: Record<string, unknown>,
  ctx: AccessCtx,
  expectedUpdatedAt?: string,
): Promise<DashboardRecord> {
  // If the row exists (or legacy-migrates), require editor.
  const existing = await getDashboard(id, ctx);
  if (!existing && expectedUpdatedAt !== undefined) {
    // A fence was supplied against a specific prior version, but the row is
    // gone (deleted, or a legacy key that failed to migrate) by the time we
    // looked. Treat this as a conflict rather than silently creating a fresh
    // row — the caller's mutation was computed against state that no longer
    // exists.
    throw new DashboardConflictError(id);
  }
  const db = getDb() as any;
  const { title, config } = configFromSettings(body);
  const configJson = JSON.stringify(config);
  if (existing) {
    await assertAccess("dashboard", id, "editor", {
      userEmail: ctx.email,
      orgId: ctx.orgId ?? undefined,
    });
    const changed =
      existing.kind !== kind ||
      existing.title !== title ||
      JSON.stringify(existing.config) !== configJson;
    const setValues = {
      kind,
      title,
      config: configJson,
      updatedAt: nowIso(),
      updatedBy: ctx.email,
    };
    if (expectedUpdatedAt !== undefined) {
      // Fenced write. Snapshot the revision only after we know this exact
      // write actually landed — otherwise a lost race would record a
      // revision for a save that never happened.
      const updateResult = await db
        .update(schema.dashboards)
        .set(setValues)
        .where(
          and(
            eq(schema.dashboards.id, id),
            eq(schema.dashboards.updatedAt, expectedUpdatedAt),
          ),
        );
      const affected = affectedRowCount(updateResult);
      if (affected === undefined) {
        throw new Error(
          "The database driver did not report an affected-row count for the fenced dashboard update.",
        );
      }
      if (affected === 0) {
        throw new DashboardConflictError(id);
      }
      if (changed) await snapshotDashboardRevision(db, existing, ctx);
    } else {
      if (changed) await snapshotDashboardRevision(db, existing, ctx);
      await db
        .update(schema.dashboards)
        .set(setValues)
        .where(eq(schema.dashboards.id, id));
    }
  } else {
    await db.insert(schema.dashboards).values({
      id,
      kind,
      title,
      config: JSON.stringify(config),
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
      visibility: "private",
      updatedBy: ctx.email,
    });
  }
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  // Notify any sibling tabs (sidebar list, command palette, dashboard view)
  // so create/update propagate just like delete and the legacy-migration path.
  const dashboard = rowToDashboard(row);
  recordScopedChange(
    "dashboards",
    "change",
    dashboard.id,
    dashboard.ownerEmail,
    dashboard.orgId,
    dashboard.visibility,
  );
  return dashboard;
}

/** Max attempts (first try + retries) for `upsertDashboardWithRetry`. */
export const DASHBOARD_SAVE_MAX_ATTEMPTS = 3;

/**
 * Read-modify-write helper for the four action call sites that fetch a
 * dashboard, mutate its config in memory, then save it back. Fences every
 * save with the `updatedAt` of the record `mutate` was given, so a
 * concurrent writer (agent adds a panel while a human drags one, or two
 * agent calls race) never gets silently clobbered.
 *
 * `mutate` is invoked with the freshest `DashboardRecord` on every attempt —
 * re-fetched from `getDashboard` each time — and must recompute the
 * `{ kind, body }` to save FROM THAT RECORD, not from a closure over an
 * earlier read; only then does a retry actually merge both writers' changes
 * instead of re-deriving the same stale result. `mutate` may throw a
 * non-conflict error (e.g. validation) to abort immediately without
 * retrying.
 *
 * On a lost race, this re-reads and re-invokes `mutate` up to `maxAttempts`
 * times before failing loud with a clear error so callers never silently
 * drop a write or loop forever.
 */
export async function upsertDashboardWithRetry(
  id: string,
  ctx: AccessCtx,
  mutate: (
    existing: DashboardRecord,
  ) =>
    | { kind: DashboardKind; body: Record<string, unknown> }
    | Promise<{ kind: DashboardKind; body: Record<string, unknown> }>,
  maxAttempts: number = DASHBOARD_SAVE_MAX_ATTEMPTS,
): Promise<DashboardRecord> {
  let lastConflict: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await getDashboard(id, ctx);
    if (!existing) {
      throw new Error(
        `dashboard "${id}" not found (or you don't have access).`,
      );
    }
    const { kind, body } = await mutate(existing);
    try {
      return await upsertDashboard(id, kind, body, ctx, existing.updatedAt);
    } catch (err) {
      if (err instanceof DashboardConflictError) {
        lastConflict = err;
        continue;
      }
      throw err;
    }
  }
  const finalError = new Error(
    `Could not save dashboard "${id}" after ${maxAttempts} attempt(s); it kept changing concurrently. Re-read the dashboard and try again.`,
  );
  if (lastConflict !== undefined) {
    (finalError as Error & { cause?: unknown }).cause = lastConflict;
  }
  throw finalError;
}

export async function listDashboardRevisions(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<DashboardRevisionRecord[]> {
  const existing = await getDashboard(dashboardId, ctx);
  if (!existing) return [];
  await assertAccess("dashboard", dashboardId, "viewer", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.dashboardRevisions)
    .where(eq(schema.dashboardRevisions.dashboardId, dashboardId))
    .orderBy(desc(schema.dashboardRevisions.createdAt))
    .limit(DASHBOARD_REVISION_LIMIT);
  return rows.map(rowToDashboardRevision);
}

export async function restoreDashboardRevision(
  dashboardId: string,
  revisionId: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  const existing = await getDashboard(dashboardId, ctx);
  if (!existing) return null;
  await assertAccess("dashboard", dashboardId, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const [revisionRow] = await db
    .select()
    .from(schema.dashboardRevisions)
    .where(
      and(
        eq(schema.dashboardRevisions.id, revisionId),
        eq(schema.dashboardRevisions.dashboardId, dashboardId),
      ),
    )
    .limit(1);
  if (!revisionRow) return null;
  const revision = rowToDashboardRevision(revisionRow);
  await snapshotDashboardRevision(db, existing, ctx);
  await db
    .update(schema.dashboards)
    .set({
      kind: revision.kind,
      title: revision.title,
      config: JSON.stringify(revision.config),
      updatedAt: nowIso(),
      updatedBy: ctx.email,
    })
    .where(eq(schema.dashboards.id, dashboardId));
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, dashboardId));
  const dashboard = rowToDashboard(row);
  recordScopedChange(
    "dashboards",
    "change",
    dashboard.id,
    dashboard.ownerEmail,
    dashboard.orgId,
    dashboard.visibility,
  );
  return dashboard;
}

/**
 * Archive a dashboard (soft-delete). Requires editor. The row stays in the
 * dashboards table with `archived_at` set, so it disappears from the default
 * sidebar list but remains accessible by id and can be restored.
 */
export async function archiveDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  const existing = await getDashboard(id, ctx);
  if (!existing) return null;
  if (existing.archivedAt) return existing;
  await assertAccess("dashboard", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const now = nowIso();
  await db
    .update(schema.dashboards)
    .set({ archivedAt: now, updatedAt: now, updatedBy: ctx.email })
    .where(eq(schema.dashboards.id, id));
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  const dashboard = rowToDashboard(row);
  recordScopedChange(
    "dashboards",
    "change",
    dashboard.id,
    dashboard.ownerEmail,
    dashboard.orgId,
    dashboard.visibility,
  );
  return dashboard;
}

/** Restore an archived dashboard. Requires editor. No-op if already active. */
export async function unarchiveDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  const existing = await getDashboard(id, ctx);
  if (!existing) return null;
  if (!existing.archivedAt) return existing;
  await assertAccess("dashboard", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  await db
    .update(schema.dashboards)
    .set({ archivedAt: null, updatedAt: nowIso(), updatedBy: ctx.email })
    .where(eq(schema.dashboards.id, id));
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  const dashboard = rowToDashboard(row);
  recordScopedChange(
    "dashboards",
    "change",
    dashboard.id,
    dashboard.ownerEmail,
    dashboard.orgId,
    dashboard.visibility,
  );
  return dashboard;
}

/**
 * Hide a dashboard from default lists/search-empty states without archiving it.
 * The dashboard remains accessible by id and can be found by search surfaces
 * that explicitly include hidden records.
 */
export async function hideDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  const existing = await getDashboard(id, ctx);
  if (!existing) return null;
  if (existing.hiddenAt) return existing;
  await assertAccess("dashboard", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const now = nowIso();
  await db
    .update(schema.dashboards)
    .set({
      hiddenAt: now,
      hiddenBy: ctx.email,
      updatedAt: now,
      updatedBy: ctx.email,
    })
    .where(eq(schema.dashboards.id, id));
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  const dashboard = rowToDashboard(row);
  recordScopedChange(
    "dashboards",
    "change",
    dashboard.id,
    dashboard.ownerEmail,
    dashboard.orgId,
    dashboard.visibility,
  );
  return dashboard;
}

/**
 * Unhide a dashboard. During cleanup, legacy org-shared dashboards can be left
 * with a blank owner; the first user to unhide one becomes the owner so future
 * sharing/editing has a real person behind it.
 */
export async function unhideDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  const existing = await getDashboard(id, ctx);
  if (!existing) return null;
  await assertAccess("dashboard", id, "viewer", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const now = nowIso();
  const patch: Record<string, unknown> = {
    hiddenAt: null,
    hiddenBy: null,
    updatedAt: now,
    updatedBy: ctx.email,
  };
  if (!existing.ownerEmail) {
    patch.ownerEmail = ctx.email;
  }
  await db
    .update(schema.dashboards)
    .set(patch)
    .where(eq(schema.dashboards.id, id));
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  const dashboard = rowToDashboard(row);
  recordScopedChange(
    "dashboards",
    "change",
    dashboard.id,
    dashboard.ownerEmail,
    dashboard.orgId,
    dashboard.visibility,
  );
  return dashboard;
}

/** Delete a dashboard. Cleans legacy keys too. Requires admin/owner. */
export async function removeDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<void> {
  const existing = await getDashboard(id, ctx);
  if (!existing) return;
  await assertAccess("dashboard", id, "admin", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  await db.delete(schema.dashboards).where(eq(schema.dashboards.id, id));
  await db
    .delete(schema.dashboardRevisions)
    .where(eq(schema.dashboardRevisions.dashboardId, id));
  await db
    .delete(schema.dashboardShares)
    .where(eq(schema.dashboardShares.resourceId, id));
  recordScopedChange(
    "dashboards",
    "delete",
    existing.id,
    existing.ownerEmail,
    existing.orgId,
    existing.visibility,
  );
  // Best-effort legacy cleanup.
  try {
    if (ctx.orgId) await deleteOrgSetting(ctx.orgId, `${SQL_PREFIX}${id}`);
    if (ctx.email) {
      await deleteUserSetting(ctx.email, `${SQL_PREFIX}${id}`);
      await deleteUserSetting(ctx.email, `${EXPLORER_PREFIX}${id}`);
    }
  } catch {
    // legacy cleanup is best-effort
  }
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

function rowToAnalysis(row: any, role?: AccessRole): AnalysisRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    question: row.question,
    instructions: row.instructions,
    dataSources: safeJsonParse(row.dataSources, []),
    resultMarkdown: row.resultMarkdown,
    resultData: row.resultData ? safeJsonParse(row.resultData, null) : null,
    author: row.author ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
    ...accessFields(role),
  };
}

function rowToAnalysisRevision(row: any): AnalysisRevisionRecord {
  return {
    id: row.id,
    analysisId: row.analysisId,
    name: row.name,
    description: row.description,
    question: row.question,
    instructions: row.instructions,
    dataSources: safeJsonParse(row.dataSources, []),
    resultMarkdown: row.resultMarkdown,
    resultData: row.resultData ? safeJsonParse(row.resultData, null) : null,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? null,
  };
}

function safeJsonParse<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * Columns selected for the analyses LIST query. Deliberately excludes the heavy
 * `resultMarkdown` (full findings text) and `resultData` (JSON) blobs — the list
 * action only needs metadata, so pulling those for every row wastes bandwidth.
 * The single-analysis GET path (`getAnalysis`) still selects the full row.
 */
const analysisListColumns = {
  id: schema.analyses.id,
  name: schema.analyses.name,
  description: schema.analyses.description,
  question: schema.analyses.question,
  instructions: schema.analyses.instructions,
  dataSources: schema.analyses.dataSources,
  author: schema.analyses.author,
  ownerEmail: schema.analyses.ownerEmail,
  orgId: schema.analyses.orgId,
  visibility: schema.analyses.visibility,
  createdAt: schema.analyses.createdAt,
  updatedAt: schema.analyses.updatedAt,
  hiddenAt: schema.analyses.hiddenAt,
  hiddenBy: schema.analyses.hiddenBy,
} as const;

/**
 * Map a list-projection row (no heavy result blobs) to an AnalysisRecord. The
 * excluded `resultMarkdown` / `resultData` fields are filled with empty
 * defaults so list consumers never transfer them; callers needing the real
 * result must load the analysis by id via `getAnalysis`.
 */
function listRowToAnalysis(row: any): AnalysisRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    question: row.question,
    instructions: row.instructions,
    dataSources: safeJsonParse(row.dataSources, []),
    resultMarkdown: "",
    resultData: null,
    author: row.author ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
  };
}

async function findLegacyAnalysis(
  id: string,
  ctx: AccessCtx,
): Promise<{
  data: Record<string, unknown>;
  ownerEmail: string;
  orgId: string | null;
  visibility: AnalysisRecord["visibility"];
} | null> {
  const key = `${ANALYSIS_PREFIX}${id}`;
  if (ctx.orgId) {
    const v = await getOrgSetting(ctx.orgId, key);
    if (v)
      return {
        data: v,
        ownerEmail: ctx.email,
        orgId: ctx.orgId,
        visibility: "org",
      };
  }
  if (ctx.email) {
    const v = await getUserSetting(ctx.email, key);
    if (v)
      return {
        data: v,
        ownerEmail: ctx.email,
        orgId: null,
        visibility: "private",
      };
  }
  return null;
}

async function migrateAnalysisFromSettings(
  id: string,
  data: Record<string, unknown>,
  ownerEmail: string,
  orgId: string | null,
  visibility: AnalysisRecord["visibility"],
  role?: AccessRole,
): Promise<AnalysisRecord> {
  const db = getDb() as any;
  const createdAt =
    (typeof data.createdAt === "string" && data.createdAt) || nowIso();
  const updatedAt =
    (typeof data.updatedAt === "string" && data.updatedAt) || createdAt;
  await db
    .insert(schema.analyses)
    .values({
      id,
      name: (data.name as string) ?? "Untitled",
      description: (data.description as string) ?? "",
      question: (data.question as string) ?? "",
      instructions: (data.instructions as string) ?? "",
      dataSources: JSON.stringify(data.dataSources ?? []),
      resultMarkdown: (data.resultMarkdown as string) ?? "",
      resultData: data.resultData ? JSON.stringify(data.resultData) : null,
      author: (data.author as string) ?? ownerEmail,
      ownerEmail,
      orgId,
      visibility,
      createdAt,
      updatedAt,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, id));
  const analysis = rowToAnalysis(row, role);
  recordScopedChange(
    "analyses",
    "change",
    analysis.id,
    analysis.ownerEmail,
    analysis.orgId,
    analysis.visibility,
  );
  return analysis;
}

export async function getAnalysis(
  id: string,
  ctx: AccessCtx,
): Promise<AnalysisRecord | null> {
  const access = await resolveAccess("analysis", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (access) return rowToAnalysis(access.resource, access.role);
  const legacy = await findLegacyAnalysis(id, ctx);
  if (!legacy) return null;
  return migrateAnalysisFromSettings(
    id,
    legacy.data,
    legacy.ownerEmail,
    legacy.orgId,
    legacy.visibility,
    "owner",
  );
}

export async function listAnalyses(
  ctx: AccessCtx,
  filter?: { hidden?: DashboardHiddenFilter },
): Promise<AnalysisRecord[]> {
  const db = getDb() as any;
  const hidden = filter?.hidden ?? "visible";
  const conditions: any[] = [
    accessFilter(schema.analyses, schema.analysisShares, {
      userEmail: ctx.email,
      orgId: ctx.orgId ?? undefined,
    }),
  ];
  if (hidden === "visible") conditions.push(isNull(schema.analyses.hiddenAt));
  else if (hidden === "hidden")
    conditions.push(isNotNull(schema.analyses.hiddenAt));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  // List-specific projection: never pull the heavy resultMarkdown / resultData
  // blobs for every analysis. Consumers that need the full result load by id.
  const rows = await db
    .select(analysisListColumns)
    .from(schema.analyses)
    .where(where);
  const out: AnalysisRecord[] = rows.map(listRowToAnalysis);
  const seen = new Set<string>(out.map((r) => r.id));
  // Legacy settings rows have no hidden concept, so hidden-only queries skip
  // the legacy scan entirely.
  if (hidden === "hidden") return out;
  try {
    const all = await getAllSettings();
    for (const [key, value] of Object.entries(all)) {
      let id: string | null = null;
      let ownerEmail = ctx.email;
      let orgId: string | null = null;
      let visibility: AnalysisRecord["visibility"] = "private";
      if (ctx.orgId && key.startsWith(`o:${ctx.orgId}:${ANALYSIS_PREFIX}`)) {
        id = key.slice(`o:${ctx.orgId}:${ANALYSIS_PREFIX}`.length);
        orgId = ctx.orgId;
        visibility = "org";
      } else if (
        ctx.email &&
        key.startsWith(`u:${ctx.email}:${ANALYSIS_PREFIX}`)
      ) {
        id = key.slice(`u:${ctx.email}:${ANALYSIS_PREFIX}`.length);
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const rec = await migrateAnalysisFromSettings(
        id,
        value as Record<string, unknown>,
        ownerEmail,
        orgId,
        visibility,
      );
      out.push(rec);
    }
  } catch {
    // legacy scan best-effort
  }
  return out;
}

async function pruneAnalysisRevisions(
  db: any,
  analysisId: string,
): Promise<void> {
  const rows = await db
    .select({ id: schema.analysisRevisions.id })
    .from(schema.analysisRevisions)
    .where(eq(schema.analysisRevisions.analysisId, analysisId))
    .orderBy(desc(schema.analysisRevisions.createdAt));
  const stale = rows.slice(ANALYSIS_REVISION_LIMIT);
  for (const row of stale) {
    await db
      .delete(schema.analysisRevisions)
      .where(eq(schema.analysisRevisions.id, row.id));
  }
}

async function snapshotAnalysisRevision(
  db: any,
  analysis: AnalysisRecord,
  ctx: AccessCtx,
): Promise<void> {
  await db.insert(schema.analysisRevisions).values({
    id: `analysisrev-${Date.now()}-${nanoidFallback()}`,
    analysisId: analysis.id,
    name: analysis.name,
    description: analysis.description,
    question: analysis.question,
    instructions: analysis.instructions,
    dataSources: JSON.stringify(analysis.dataSources),
    resultMarkdown: analysis.resultMarkdown,
    resultData: analysis.resultData
      ? JSON.stringify(analysis.resultData)
      : null,
    createdAt: nowIso(),
    createdBy: ctx.email,
    ownerEmail: analysis.ownerEmail,
    orgId: analysis.orgId,
  });
  await pruneAnalysisRevisions(db, analysis.id);
}

/**
 * Upsert an analysis. On create, caller becomes owner and visibility defaults
 * to `private`. On update, `assertAccess` requires `editor`.
 *
 * `expectedUpdatedAt` fences the update against concurrent writers: pass the
 * `updatedAt` observed by an earlier `getAnalysis` call and the UPDATE only
 * applies `WHERE id = ? AND updated_at = ?`. If another writer already saved
 * in between, the fenced UPDATE affects zero rows and this throws
 * `AnalysisConflictError` instead of silently clobbering their write. Omit it
 * (the default) to keep the prior unconditional last-write-wins behavior,
 * which existing callers (legacy migration, revision restore, and
 * `save-analysis`'s create/re-run path) still rely on. See
 * `upsertAnalysisWithRetry` for the read-modify-write pattern that recomputes
 * the patch from fresh state on a lost race.
 */
export async function upsertAnalysis(
  id: string,
  body: {
    name?: string;
    description?: string;
    question?: string;
    instructions?: string;
    dataSources?: string[];
    resultMarkdown?: string;
    resultData?: Record<string, unknown> | null;
  },
  ctx: AccessCtx,
  expectedUpdatedAt?: string,
): Promise<AnalysisRecord> {
  const existing = await getAnalysis(id, ctx);
  if (!existing && expectedUpdatedAt !== undefined) {
    // A fence was supplied against a specific prior version, but the row is
    // gone (deleted, or a legacy key that failed to migrate) by the time we
    // looked. Treat this as a conflict rather than silently creating a fresh
    // row — the caller's mutation was computed against state that no longer
    // exists.
    throw new AnalysisConflictError(id);
  }
  const db = getDb() as any;
  if (existing) {
    await assertAccess("analysis", id, "editor", {
      userEmail: ctx.email,
      orgId: ctx.orgId ?? undefined,
    });
    const patch: Record<string, unknown> = { updatedAt: nowIso() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.question !== undefined) patch.question = body.question;
    if (body.instructions !== undefined) patch.instructions = body.instructions;
    if (body.dataSources !== undefined)
      patch.dataSources = JSON.stringify(body.dataSources);
    if (body.resultMarkdown !== undefined)
      patch.resultMarkdown = body.resultMarkdown;
    if (body.resultData !== undefined)
      patch.resultData = body.resultData
        ? JSON.stringify(body.resultData)
        : null;
    const next = {
      name: (patch.name as string | undefined) ?? existing.name,
      description:
        (patch.description as string | undefined) ?? existing.description,
      question: (patch.question as string | undefined) ?? existing.question,
      instructions:
        (patch.instructions as string | undefined) ?? existing.instructions,
      dataSources:
        body.dataSources !== undefined
          ? body.dataSources
          : existing.dataSources,
      resultMarkdown:
        (patch.resultMarkdown as string | undefined) ?? existing.resultMarkdown,
      resultData:
        body.resultData !== undefined ? body.resultData : existing.resultData,
    };
    const changed =
      next.name !== existing.name ||
      next.description !== existing.description ||
      next.question !== existing.question ||
      next.instructions !== existing.instructions ||
      JSON.stringify(next.dataSources) !==
        JSON.stringify(existing.dataSources) ||
      next.resultMarkdown !== existing.resultMarkdown ||
      JSON.stringify(next.resultData) !== JSON.stringify(existing.resultData);
    if (expectedUpdatedAt !== undefined) {
      // Fenced write. Snapshot the revision only after we know this exact
      // write actually landed — otherwise a lost race would record a
      // revision for a save that never happened.
      const updateResult = await db
        .update(schema.analyses)
        .set(patch)
        .where(
          and(
            eq(schema.analyses.id, id),
            eq(schema.analyses.updatedAt, expectedUpdatedAt),
          ),
        );
      const affected = affectedRowCount(updateResult);
      if (affected === undefined) {
        throw new Error(
          "The database driver did not report an affected-row count for the fenced analysis update.",
        );
      }
      if (affected === 0) {
        throw new AnalysisConflictError(id);
      }
      if (changed) await snapshotAnalysisRevision(db, existing, ctx);
    } else {
      if (changed) await snapshotAnalysisRevision(db, existing, ctx);
      await db
        .update(schema.analyses)
        .set(patch)
        .where(eq(schema.analyses.id, id));
    }
  } else {
    await db.insert(schema.analyses).values({
      id,
      name: body.name ?? "Untitled",
      description: body.description ?? "",
      question: body.question ?? "",
      instructions: body.instructions ?? "",
      dataSources: JSON.stringify(body.dataSources ?? []),
      resultMarkdown: body.resultMarkdown ?? "",
      resultData: body.resultData ? JSON.stringify(body.resultData) : null,
      author: ctx.email,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
      visibility: "private",
    });
  }
  // guard:allow-unscoped — read-after-write of the analysis row just upserted
  // above with ownerEmail from ctx; the upsert path already gated access via
  // assertAccess earlier in this function for the update branch, and the
  // insert branch sets ownerEmail = ctx.email, so eq(id) is sufficient.
  const [row] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, id));
  return rowToAnalysis(row);
}

/** Max attempts (first try + retries) for `upsertAnalysisWithRetry`. */
export const ANALYSIS_SAVE_MAX_ATTEMPTS = 3;

/**
 * Read-modify-write helper for action call sites that fetch an analysis,
 * mutate its fields in memory, then save it back. Fences every save with the
 * `updatedAt` of the record `mutate` was given, so a concurrent writer (e.g.
 * `save-analysis` re-running with fresh results while someone renames it)
 * never gets silently clobbered.
 *
 * `mutate` is invoked with the freshest `AnalysisRecord` on every attempt —
 * re-fetched from `getAnalysis` each time — and must recompute the body patch
 * to save FROM THAT RECORD, not from a closure over an earlier read; only
 * then does a retry actually merge both writers' changes instead of
 * re-deriving the same stale result. `mutate` may throw a non-conflict error
 * (e.g. validation) to abort immediately without retrying.
 *
 * On a lost race, this re-reads and re-invokes `mutate` up to `maxAttempts`
 * times before failing loud with a clear error so callers never silently
 * drop a write or loop forever.
 */
export async function upsertAnalysisWithRetry(
  id: string,
  ctx: AccessCtx,
  mutate: (existing: AnalysisRecord) =>
    | {
        name?: string;
        description?: string;
        question?: string;
        instructions?: string;
        dataSources?: string[];
        resultMarkdown?: string;
        resultData?: Record<string, unknown> | null;
      }
    | Promise<{
        name?: string;
        description?: string;
        question?: string;
        instructions?: string;
        dataSources?: string[];
        resultMarkdown?: string;
        resultData?: Record<string, unknown> | null;
      }>,
  maxAttempts: number = ANALYSIS_SAVE_MAX_ATTEMPTS,
): Promise<AnalysisRecord> {
  let lastConflict: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await getAnalysis(id, ctx);
    if (!existing) {
      throw new Error(`analysis "${id}" not found (or you don't have access).`);
    }
    const body = await mutate(existing);
    try {
      return await upsertAnalysis(id, body, ctx, existing.updatedAt);
    } catch (err) {
      if (err instanceof AnalysisConflictError) {
        lastConflict = err;
        continue;
      }
      throw err;
    }
  }
  const finalError = new Error(
    `Could not save analysis "${id}" after ${maxAttempts} attempt(s); it kept changing concurrently. Re-read the analysis and try again.`,
  );
  if (lastConflict !== undefined) {
    (finalError as Error & { cause?: unknown }).cause = lastConflict;
  }
  throw finalError;
}

export async function listAnalysisRevisions(
  analysisId: string,
  ctx: AccessCtx,
): Promise<AnalysisRevisionRecord[]> {
  const existing = await getAnalysis(analysisId, ctx);
  if (!existing) return [];
  await assertAccess("analysis", analysisId, "viewer", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.analysisRevisions)
    .where(eq(schema.analysisRevisions.analysisId, analysisId))
    .orderBy(desc(schema.analysisRevisions.createdAt))
    .limit(ANALYSIS_REVISION_LIMIT);
  return rows.map(rowToAnalysisRevision);
}

export async function restoreAnalysisRevision(
  analysisId: string,
  revisionId: string,
  ctx: AccessCtx,
): Promise<AnalysisRecord | null> {
  const existing = await getAnalysis(analysisId, ctx);
  if (!existing) return null;
  await assertAccess("analysis", analysisId, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const [revisionRow] = await db
    .select()
    .from(schema.analysisRevisions)
    .where(
      and(
        eq(schema.analysisRevisions.id, revisionId),
        eq(schema.analysisRevisions.analysisId, analysisId),
      ),
    )
    .limit(1);
  if (!revisionRow) return null;
  const revision = rowToAnalysisRevision(revisionRow);
  await snapshotAnalysisRevision(db, existing, ctx);
  await db
    .update(schema.analyses)
    .set({
      name: revision.name,
      description: revision.description,
      question: revision.question,
      instructions: revision.instructions,
      dataSources: JSON.stringify(revision.dataSources),
      resultMarkdown: revision.resultMarkdown,
      resultData: revision.resultData
        ? JSON.stringify(revision.resultData)
        : null,
      updatedAt: nowIso(),
    })
    .where(eq(schema.analyses.id, analysisId));
  const [row] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, analysisId));
  const analysis = rowToAnalysis(row);
  recordScopedChange(
    "analyses",
    "change",
    analysis.id,
    analysis.ownerEmail,
    analysis.orgId,
    analysis.visibility,
  );
  return analysis;
}

export async function removeAnalysis(
  id: string,
  ctx: AccessCtx,
): Promise<void> {
  const existing = await getAnalysis(id, ctx);
  if (!existing) return;
  await assertAccess("analysis", id, "admin", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  await db.delete(schema.analyses).where(eq(schema.analyses.id, id));
  await db
    .delete(schema.analysisRevisions)
    .where(eq(schema.analysisRevisions.analysisId, id));
  await db
    .delete(schema.analysisShares)
    .where(eq(schema.analysisShares.resourceId, id));
  recordScopedChange(
    "analyses",
    "delete",
    existing.id,
    existing.ownerEmail,
    existing.orgId,
    existing.visibility,
  );
  try {
    if (ctx.orgId) await deleteOrgSetting(ctx.orgId, `${ANALYSIS_PREFIX}${id}`);
    if (ctx.email)
      await deleteUserSetting(ctx.email, `${ANALYSIS_PREFIX}${id}`);
  } catch {
    // best-effort
  }
}

/**
 * Hide an analysis from default lists/navigation without deleting it. The
 * analysis remains accessible by id and can be found by surfaces that
 * explicitly include hidden records.
 */
export async function hideAnalysis(
  id: string,
  ctx: AccessCtx,
): Promise<AnalysisRecord | null> {
  const existing = await getAnalysis(id, ctx);
  if (!existing) return null;
  if (existing.hiddenAt) return existing;
  await assertAccess("analysis", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const now = nowIso();
  await db
    .update(schema.analyses)
    .set({ hiddenAt: now, hiddenBy: ctx.email, updatedAt: now })
    .where(eq(schema.analyses.id, id));
  const [row] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, id));
  const analysis = rowToAnalysis(row);
  recordScopedChange(
    "analyses",
    "change",
    analysis.id,
    analysis.ownerEmail,
    analysis.orgId,
    analysis.visibility,
  );
  return analysis;
}

/**
 * Unhide an analysis. During cleanup, legacy org-shared analyses can be left
 * with a blank owner; the first user to unhide one becomes the owner so future
 * sharing/editing has a real person behind it.
 */
export async function unhideAnalysis(
  id: string,
  ctx: AccessCtx,
): Promise<AnalysisRecord | null> {
  const existing = await getAnalysis(id, ctx);
  if (!existing) return null;
  await assertAccess("analysis", id, "viewer", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const now = nowIso();
  const patch: Record<string, unknown> = {
    hiddenAt: null,
    hiddenBy: null,
    updatedAt: now,
  };
  if (!existing.ownerEmail) {
    patch.ownerEmail = ctx.email;
  }
  await db.update(schema.analyses).set(patch).where(eq(schema.analyses.id, id));
  const [row] = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, id));
  const analysis = rowToAnalysis(row);
  recordScopedChange(
    "analyses",
    "change",
    analysis.id,
    analysis.ownerEmail,
    analysis.orgId,
    analysis.visibility,
  );
  return analysis;
}

// ---------------------------------------------------------------------------
// Dashboard views (child of dashboard — no separate sharing)
// ---------------------------------------------------------------------------

export interface DashboardViewRecord {
  id: string;
  dashboardId: string;
  name: string;
  filters: Record<string, string>;
  createdBy: string | null;
  createdAt: string;
}

function rowToView(row: any): DashboardViewRecord {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    name: row.name,
    filters: safeJsonParse(row.filters, {} as Record<string, string>),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
  };
}

export async function listDashboardViews(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<DashboardViewRecord[]> {
  // Parent access gates view visibility.
  const dash = await getDashboard(dashboardId, ctx);
  if (!dash) return [];
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.dashboardViews)
    .where(eq(schema.dashboardViews.dashboardId, dashboardId));
  return rows.map(rowToView);
}

export async function saveDashboardView(
  dashboardId: string,
  view: { id?: string; name: string; filters: Record<string, string> },
  ctx: AccessCtx,
): Promise<DashboardViewRecord> {
  await assertAccess("dashboard", dashboardId, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  const id = view.id ?? nanoidFallback();
  if (view.id) {
    await db
      .update(schema.dashboardViews)
      .set({ name: view.name, filters: JSON.stringify(view.filters) })
      .where(eq(schema.dashboardViews.id, id));
  } else {
    await db.insert(schema.dashboardViews).values({
      id,
      dashboardId,
      name: view.name,
      filters: JSON.stringify(view.filters),
      createdBy: ctx.email || null,
    });
  }
  const [row] = await db
    .select()
    .from(schema.dashboardViews)
    .where(eq(schema.dashboardViews.id, id));
  const dash = await getDashboard(dashboardId, ctx);
  if (dash) {
    recordScopedChange(
      "dashboard-views",
      "change",
      dashboardId,
      dash.ownerEmail,
      dash.orgId,
      dash.visibility,
    );
  }
  return rowToView(row);
}

export async function deleteDashboardView(
  dashboardId: string,
  viewId: string,
  ctx: AccessCtx,
): Promise<void> {
  await assertAccess("dashboard", dashboardId, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const db = getDb() as any;
  await db
    .delete(schema.dashboardViews)
    .where(eq(schema.dashboardViews.id, viewId));
  const dash = await getDashboard(dashboardId, ctx);
  if (dash) {
    recordScopedChange(
      "dashboard-views",
      "delete",
      dashboardId,
      dash.ownerEmail,
      dash.orgId,
      dash.visibility,
    );
  }
}
