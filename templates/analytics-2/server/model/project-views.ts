import { and, desc, eq, isNull, sql } from "@agent-native/core/db/schema";
import { accessFilter } from "@agent-native/core/sharing";

import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { type WorkspaceScope, requireWorkspaceScope } from "./scope.js";

const { projects, projectViews, projectVersions } = schema;

/**
 * How many days of opens "popular this week" counts. The reference ranks a
 * one-week window, so the read takes the same window rather than all history.
 */
export const POPULAR_WINDOW_DAYS = 7;

export type PopularProject = {
  id: string;
  title: string;
  allowEmbedding: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  ownerEmail: string;
  creatorEmail: string | null;
  createdAt: string;
  lastEditedAt: string;
};

/**
 * Record that one viewer opened one project.
 *
 * Recording is a side effect of a read that already happened, so a caller must
 * never fail the read because this write failed; the action wraps it. The row is
 * additive and carries no project content.
 */
export async function recordProjectView(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  viewerEmail: string,
  viewKind?: "app",
  viewId?: string,
): Promise<boolean> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const [recorded] = await getDb()
    .insert(projectViews)
    .values({
      id: viewId
        ? JSON.stringify([
            viewKind ?? "draft",
            scope.orgId,
            projectId,
            viewerEmail.trim().toLowerCase(),
            viewId,
          ])
        : newId("viw"),
      projectId,
      viewerEmail: viewerEmail.trim().toLowerCase(),
      orgId: scope.orgId,
      viewedAt: nowIso(),
      viewKind: viewKind ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: projectViews.id });
  return recorded !== undefined;
}

/** Published projects ranked by recorded app visits in the requested window. */
export async function listPopularProjects(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  options: { limit?: number; offset?: number; windowDays?: number } = {},
): Promise<PopularProject[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const limit = options.limit ?? 6;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Popular projects limit must be a positive integer.");
  }
  const windowDays = options.windowDays ?? POPULAR_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const rows = await getDb()
    .select({
      id: projects.id,
      title: projects.title,
      allowEmbedding: projects.allowEmbedding,
      viewCount: sql<number>`count(${projectViews.id})::int`,
      lastViewedAt: sql<string | null>`max(${projectViews.viewedAt})`,
      ownerEmail: projects.ownerEmail,
      creatorEmail: projectVersions.createdBy,
      createdAt: projects.createdAt,
      lastEditedAt: sql<string>`coalesce(${projects.userUpdatedAt}, ${projects.updatedAt})`,
    })
    .from(projects)
    .leftJoin(
      projectVersions,
      and(
        eq(projectVersions.projectId, projects.id),
        eq(projectVersions.number, "1"),
      ),
    )
    .leftJoin(
      projectViews,
      and(
        eq(projectViews.projectId, projects.id),
        eq(projectViews.viewKind, "app"),
        eq(projectViews.orgId, scope.orgId),
        sql`${projectViews.viewedAt} >= ${since}`,
      ),
    )
    .where(
      and(
        eq(projects.orgId, scope.orgId),
        isNull(projects.trashedAt),
        isNull(projects.archivedAt),
        sql`${projects.publishedVersionId} IS NOT NULL`,
        accessFilter(projects, schema.projectShares, {
          userEmail: scope.ownerEmail,
          orgId: scope.orgId,
        }),
      ),
    )
    .groupBy(
      projects.id,
      projects.title,
      projects.allowEmbedding,
      projectVersions.createdBy,
    )
    .orderBy(
      desc(sql`count(${projectViews.id})`),
      desc(sql`max(${projectViews.viewedAt})`),
      desc(projects.id),
    )
    .limit(limit)
    .offset(options.offset ?? 0);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    allowEmbedding: row.allowEmbedding,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt,
    ownerEmail: row.ownerEmail,
    creatorEmail: row.creatorEmail,
    createdAt: row.createdAt,
    lastEditedAt: row.lastEditedAt,
  }));
}
