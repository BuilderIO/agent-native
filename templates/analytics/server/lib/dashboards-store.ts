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
import { and, eq, isNotNull, isNull } from "drizzle-orm";

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

interface AccessCtx {
  email: string;
  orgId: string | null;
}

const SQL_PREFIX = "sql-dashboard-";
const EXPLORER_PREFIX = "dashboard-";
const ANALYSIS_PREFIX = "adhoc-analysis-";

function nowIso(): string {
  return new Date().toISOString();
}

function nanoidFallback(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
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
    archivedAt: row.archivedAt ?? null,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
    ...accessFields(role),
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
 * Upsert a dashboard. On create, caller becomes owner and visibility defaults
 * to `private`; users explicitly promote useful dashboards to org/public via
 * sharing. On update, `assertAccess` requires `editor`.
 */
export async function upsertDashboard(
  id: string,
  kind: DashboardKind,
  body: Record<string, unknown>,
  ctx: AccessCtx,
): Promise<DashboardRecord> {
  // If the row exists (or legacy-migrates), require editor.
  const existing = await getDashboard(id, ctx);
  const db = getDb() as any;
  const { title, config } = configFromSettings(body);
  if (existing) {
    await assertAccess("dashboard", id, "editor", {
      userEmail: ctx.email,
      orgId: ctx.orgId ?? undefined,
    });
    await db
      .update(schema.dashboards)
      .set({
        kind,
        title,
        config: JSON.stringify(config),
        updatedAt: nowIso(),
      })
      .where(eq(schema.dashboards.id, id));
  } else {
    await db.insert(schema.dashboards).values({
      id,
      kind,
      title,
      config: JSON.stringify(config),
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
      visibility: "private",
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
    .set({ archivedAt: now, updatedAt: now })
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
    .set({ archivedAt: null, updatedAt: nowIso() })
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
    .set({ hiddenAt: now, hiddenBy: ctx.email, updatedAt: now })
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
): Promise<AnalysisRecord> {
  const existing = await getAnalysis(id, ctx);
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
    await db
      .update(schema.analyses)
      .set(patch)
      .where(eq(schema.analyses.id, id));
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
