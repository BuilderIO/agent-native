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
 * - `adhoc-analysis-{id}`          → owner=caller,   visibility='org' (if org ctx)
 */
import { and, eq } from "drizzle-orm";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import {
  getAllSettings,
  getOrgSetting,
  getUserSetting,
  getSetting,
  deleteOrgSetting,
  deleteUserSetting,
  deleteSetting,
} from "@agent-native/core/settings";
import { getDb, schema } from "../db/index.js";

export type DashboardKind = "explorer" | "sql";

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
}

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
}

interface AccessCtx {
  email: string;
  orgId: string | null;
}

const LOCAL_EMAIL = "local@localhost";
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

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

function rowToDashboard(row: any): DashboardRecord {
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
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  return rowToDashboard(row);
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
        ownerEmail: ctx.email || LOCAL_EMAIL,
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
  // Global fallback for both shapes
  const sqlGlobal = await getSetting(`${SQL_PREFIX}${id}`);
  if (sqlGlobal)
    return {
      data: sqlGlobal,
      kind: "sql",
      ownerEmail: ctx.email || LOCAL_EMAIL,
      orgId: null,
      visibility: "private",
    };
  const explorerGlobal = await getSetting(`${EXPLORER_PREFIX}${id}`);
  if (explorerGlobal)
    return {
      data: explorerGlobal,
      kind: "explorer",
      ownerEmail: ctx.email || LOCAL_EMAIL,
      orgId: null,
      visibility: "private",
    };
  return null;
}

/** Fetch a dashboard by id, enforcing access. Lazy-migrates from legacy keys. */
export async function getDashboard(
  id: string,
  ctx: AccessCtx,
): Promise<DashboardRecord | null> {
  const db = getDb() as any;
  // 1) SQL first, with access check.
  const access = await resolveAccess("dashboard", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (access) return rowToDashboard(access.resource);
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
  );
}

/** List dashboards visible to the caller. Union of SQL rows + not-yet-migrated legacy keys. */
export async function listDashboards(
  ctx: AccessCtx,
  filter?: { kind?: DashboardKind },
): Promise<DashboardRecord[]> {
  const db = getDb() as any;
  const where = filter?.kind
    ? and(
        eq(schema.dashboards.kind, filter.kind),
        accessFilter(schema.dashboards, schema.dashboardShares, {
          userEmail: ctx.email,
          orgId: ctx.orgId ?? undefined,
        }),
      )
    : accessFilter(schema.dashboards, schema.dashboardShares, {
        userEmail: ctx.email,
        orgId: ctx.orgId ?? undefined,
      });
  const rows = await db.select().from(schema.dashboards).where(where);
  const out: DashboardRecord[] = rows.map(rowToDashboard);
  const seen = new Set(out.map((r) => r.id));
  // Legacy: scan settings once and surface anything not yet migrated.
  try {
    const all = await getAllSettings();
    for (const [key, value] of Object.entries(all)) {
      let id: string | null = null;
      let kind: DashboardKind | null = null;
      let ownerEmail = ctx.email || LOCAL_EMAIL;
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
 * Upsert a dashboard. On create, caller becomes owner and visibility
 * defaults to `private` (single-user) or `org` (when org context is set).
 * On update, `assertAccess` requires `editor`.
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
      ownerEmail: ctx.email || LOCAL_EMAIL,
      orgId: ctx.orgId,
      // Default to org-wide when the user is in an org, private otherwise.
      visibility: ctx.orgId ? "org" : "private",
    });
  }
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id));
  return rowToDashboard(row);
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
  // Best-effort legacy cleanup.
  try {
    if (ctx.orgId) await deleteOrgSetting(ctx.orgId, `${SQL_PREFIX}${id}`);
    if (ctx.email) {
      await deleteUserSetting(ctx.email, `${SQL_PREFIX}${id}`);
      await deleteUserSetting(ctx.email, `${EXPLORER_PREFIX}${id}`);
    }
    await deleteSetting(`${SQL_PREFIX}${id}`);
    await deleteSetting(`${EXPLORER_PREFIX}${id}`);
  } catch {
    // legacy cleanup is best-effort
  }
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

function rowToAnalysis(row: any): AnalysisRecord {
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
        ownerEmail: ctx.email || LOCAL_EMAIL,
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
  const global = await getSetting(key);
  if (global)
    return {
      data: global,
      ownerEmail: ctx.email || LOCAL_EMAIL,
      orgId: null,
      visibility: "private",
    };
  return null;
}

async function migrateAnalysisFromSettings(
  id: string,
  data: Record<string, unknown>,
  ownerEmail: string,
  orgId: string | null,
  visibility: AnalysisRecord["visibility"],
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
  return rowToAnalysis(row);
}

export async function getAnalysis(
  id: string,
  ctx: AccessCtx,
): Promise<AnalysisRecord | null> {
  const access = await resolveAccess("analysis", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (access) return rowToAnalysis(access.resource);
  const legacy = await findLegacyAnalysis(id, ctx);
  if (!legacy) return null;
  return migrateAnalysisFromSettings(
    id,
    legacy.data,
    legacy.ownerEmail,
    legacy.orgId,
    legacy.visibility,
  );
}

export async function listAnalyses(ctx: AccessCtx): Promise<AnalysisRecord[]> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(schema.analyses)
    .where(
      accessFilter(schema.analyses, schema.analysisShares, {
        userEmail: ctx.email,
        orgId: ctx.orgId ?? undefined,
      }),
    );
  const out = rows.map(rowToAnalysis);
  const seen = new Set<string>(out.map((r) => r.id));
  try {
    const all = await getAllSettings();
    for (const [key, value] of Object.entries(all)) {
      let id: string | null = null;
      let ownerEmail = ctx.email || LOCAL_EMAIL;
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
      } else if (
        key.startsWith(ANALYSIS_PREFIX) &&
        !key.startsWith("u:") &&
        !key.startsWith("o:")
      ) {
        id = key.slice(ANALYSIS_PREFIX.length);
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
      author: ctx.email || LOCAL_EMAIL,
      ownerEmail: ctx.email || LOCAL_EMAIL,
      orgId: ctx.orgId,
      visibility: ctx.orgId ? "org" : "private",
    });
  }
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
  try {
    if (ctx.orgId) await deleteOrgSetting(ctx.orgId, `${ANALYSIS_PREFIX}${id}`);
    if (ctx.email)
      await deleteUserSetting(ctx.email, `${ANALYSIS_PREFIX}${id}`);
    await deleteSetting(`${ANALYSIS_PREFIX}${id}`);
  } catch {
    // best-effort
  }
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
}
