import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeDashboardConfig } from "../../../shared/dashboard-config-normalization";
import type {
  DashboardSyncBase,
  FolderGitHubSyncConfig,
} from "../../../shared/dashboard-github-sync";
import { getDb, schema } from "../../db/index.js";
import {
  assertDashboardEditable,
  type DashboardRecord,
} from "../dashboards-store";

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

// Folder sync reads the whole folder before it plans anything, so a folder
// past this size is refused rather than synced partially.
const MAX_FOLDER_SQL_DASHBOARDS = 500;

const dashboardSyncBaseSchema = z.object({
  filePath: z.string().min(1),
  fileSha: z.string().min(1),
  panels: z.record(z.string(), z.string()),
  order: z.string(),
  meta: z.string(),
});

const folderSyncConfigSchema = z.object({
  link: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
    path: z.string(),
  }),
  pendingExport: z
    .object({
      branch: z.string().min(1),
      prNumber: z.number().int().positive(),
      prUrl: z.url(),
      dashboards: z.record(
        z.string(),
        z.object({
          blobSha: z.string().min(1),
          base: dashboardSyncBaseSchema,
        }),
      ),
    })
    .nullable(),
});

const dashboardConfigSchema = z.record(z.string(), z.unknown());

function access(ctx: AccessCtx) {
  return { userEmail: ctx.email, orgId: ctx.orgId ?? undefined };
}

// Stored sync state is never coerced: a row that cannot be read is an error
// that names the row, not a null that looks like "never synced".
function parseStoredJson<T>(
  label: string,
  raw: string,
  parser: z.ZodType<T>,
): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = parser.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label} has an invalid shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

function assertFolderWithinBound(folderId: string, count: number): void {
  if (count > MAX_FOLDER_SQL_DASHBOARDS) {
    throw new Error(
      `dashboard folder "${folderId}" has more than ${MAX_FOLDER_SQL_DASHBOARDS} SQL dashboards; GitHub folder sync refuses a partial folder`,
    );
  }
}

export async function readFolderSyncConfig(
  folderId: string,
  ctx: AccessCtx,
): Promise<FolderGitHubSyncConfig | null> {
  await assertAccess("dashboard-folder", folderId, "viewer", access(ctx));
  const [row] = await (getDb() as any)
    .select({ githubSync: schema.dashboardFolders.githubSync })
    .from(schema.dashboardFolders)
    .where(eq(schema.dashboardFolders.id, folderId))
    .limit(1);
  if (!row) throw new Error(`dashboard folder "${folderId}" not found`);
  if (row.githubSync === null) return null;
  return parseStoredJson(
    `dashboard_folders row ${folderId} github_sync`,
    row.githubSync,
    folderSyncConfigSchema,
  );
}

/** `null` clears the link. The config holds no credentials. */
export async function writeFolderSyncConfig(
  folderId: string,
  ctx: AccessCtx,
  config: FolderGitHubSyncConfig | null,
): Promise<void> {
  await assertAccess("dashboard-folder", folderId, "editor", access(ctx));
  const githubSync =
    config === null
      ? null
      : JSON.stringify(folderSyncConfigSchema.parse(config));
  await (getDb() as any)
    .update(schema.dashboardFolders)
    .set({ githubSync })
    .where(eq(schema.dashboardFolders.id, folderId));
}

export async function readDashboardSyncBase(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<DashboardSyncBase | null> {
  await assertAccess("dashboard", dashboardId, "viewer", access(ctx));
  const [row] = await (getDb() as any)
    .select({ githubSyncState: schema.dashboards.githubSyncState })
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, dashboardId))
    .limit(1);
  if (!row) throw new Error(`dashboard "${dashboardId}" not found`);
  if (row.githubSyncState === null) return null;
  return parseStoredJson(
    `dashboards row ${dashboardId} github_sync_state`,
    row.githubSyncState,
    dashboardSyncBaseSchema,
  );
}

/** The folder a dashboard sits in, or null when it is in none. */
export async function readDashboardFolderId(
  dashboardId: string,
  ctx: AccessCtx,
): Promise<string | null> {
  await assertAccess("dashboard", dashboardId, "viewer", access(ctx));
  const [row] = await (getDb() as any)
    .select({ folderId: schema.dashboards.folderId })
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, dashboardId))
    .limit(1);
  if (!row) throw new Error(`dashboard "${dashboardId}" not found`);
  return row.folderId;
}

/** `null` clears the base, which makes the next plan treat the dashboard as never synced. */
export async function writeDashboardSyncBase(
  dashboardId: string,
  ctx: AccessCtx,
  base: DashboardSyncBase | null,
): Promise<void> {
  await assertDashboardEditable(dashboardId, ctx);
  const githubSyncState =
    base === null ? null : JSON.stringify(dashboardSyncBaseSchema.parse(base));
  await (getDb() as any)
    .update(schema.dashboards)
    .set({ githubSyncState })
    .where(eq(schema.dashboards.id, dashboardId));
}

/**
 * Every SQL dashboard in the folder the caller can read, archived and hidden
 * rows included, because a file in GitHub for an archived row must still map to
 * its dashboard. `canEdit` is set per row from a second query, not per-row checks.
 */
export async function listFolderSqlDashboards(
  folderId: string,
  ctx: AccessCtx,
): Promise<DashboardRecord[]> {
  await assertAccess("dashboard-folder", folderId, "viewer", access(ctx));
  const db = getDb() as any;
  const inFolder = and(
    eq(schema.dashboards.folderId, folderId),
    eq(schema.dashboards.kind, "sql"),
  );
  const bound = MAX_FOLDER_SQL_DASHBOARDS + 1;
  const rows = await db
    .select()
    .from(schema.dashboards)
    .where(
      and(
        inFolder,
        accessFilter(schema.dashboards, schema.dashboardShares, access(ctx)),
      ),
    )
    .orderBy(asc(schema.dashboards.id))
    .limit(bound);
  assertFolderWithinBound(folderId, rows.length);

  const editableRows = await db
    .select({ id: schema.dashboards.id })
    .from(schema.dashboards)
    .where(
      and(
        inFolder,
        accessFilter(
          schema.dashboards,
          schema.dashboardShares,
          access(ctx),
          "editor",
        ),
      ),
    )
    .limit(bound);
  assertFolderWithinBound(folderId, editableRows.length);
  const editableIds = new Set(
    editableRows.map((row: { id: string }) => row.id),
  );

  return rows.map(
    (row: any): DashboardRecord => ({
      id: row.id,
      kind: "sql",
      title: row.title,
      config: normalizeDashboardConfig(
        parseStoredJson(
          `dashboards row ${row.id} config`,
          row.config,
          dashboardConfigSchema,
        ),
      ),
      ownerEmail: row.ownerEmail,
      orgId: row.orgId ?? null,
      visibility: row.visibility,
      createdAt: row.createdAt,
      createdBy: row.createdBy ?? null,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null,
      archivedAt: row.archivedAt ?? null,
      hiddenAt: row.hiddenAt ?? null,
      hiddenBy: row.hiddenBy ?? null,
      canEdit: editableIds.has(row.id),
    }),
  );
}
