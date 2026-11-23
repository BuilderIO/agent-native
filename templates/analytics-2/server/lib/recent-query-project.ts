import { and, desc, eq, isNull, sql } from "@agent-native/core/db/schema";
import { z } from "zod";

import { sqlCellContentsSchema } from "../../app/lib/model/contracts.js";
import { compareOrder } from "../../app/lib/model/order.js";
import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "../model/database.js";
import { decodeJsonColumn } from "../model/json-column.js";
import { type WorkspaceScope, requireWorkspaceScope } from "../model/scope.js";

export const RECENT_QUERY_SQL_CELL_LIMIT = 5;
export const RECENT_QUERY_SOURCE_PREVIEW_LIMIT = 200;

export const recentQuerySqlCellSchema = z.strictObject({
  id: z.string(),
  label: z.string().nullable(),
  sourcePreview: z.string(),
});

export const recentQueryProjectSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  sqlCells: z
    .array(recentQuerySqlCellSchema)
    .min(1)
    .max(RECENT_QUERY_SQL_CELL_LIMIT),
});

export type RecentQueryProject = z.infer<typeof recentQueryProjectSchema>;

function boundedSourcePreview(source: string): string {
  const chars = Array.from(source.trim());
  if (chars.length <= RECENT_QUERY_SOURCE_PREVIEW_LIMIT) {
    return chars.join("");
  }
  return chars.slice(0, RECENT_QUERY_SOURCE_PREVIEW_LIMIT).join("");
}

/**
 * Finds the signed-in member's most recently updated active, listed notebook
 * whose working version contains at least one SQL cell. Used by `view-screen`
 * when no project is open (for example on `/home/data`) so follow-ups like
 * "that query" can locate the target notebook and SQL cell directly.
 */
export async function findRecentQueryProject(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
): Promise<RecentQueryProject | null> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const { projects, cells } = schema;
  const db = getDb();

  const [project] = await db
    .select({
      id: projects.id,
      title: projects.title,
      updatedAt: projects.updatedAt,
      workingVersionId: projects.workingVersionId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
        eq(projects.listed, true),
        isNull(projects.trashedAt),
        isNull(projects.archivedAt),
        sql`exists (
          select 1 from ${cells}
          where ${cells.projectId} = ${projects.id}
            and ${cells.versionId} = ${projects.workingVersionId}
            and ${cells.kind} = 'sql'
        )`,
      ),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(1);

  if (!project) return null;

  const cellRows = await db
    .select({
      id: cells.id,
      order: cells.order,
      label: cells.label,
      contents: cells.contents,
    })
    .from(cells)
    .where(
      and(
        eq(cells.projectId, project.id),
        eq(cells.versionId, project.workingVersionId),
        eq(cells.kind, "sql"),
      ),
    );

  const ordered = [...cellRows]
    .sort((a, b) => compareOrder(a.order, b.order) || a.id.localeCompare(b.id))
    .slice(0, RECENT_QUERY_SQL_CELL_LIMIT);

  const sqlCells = ordered.map((row) => {
    const contents = decodeJsonColumn(row.contents, sqlCellContentsSchema);
    return {
      id: row.id,
      label: contents?.label ?? row.label ?? null,
      sourcePreview: boundedSourcePreview(contents?.source ?? ""),
    };
  });

  if (sqlCells.length === 0) return null;

  return recentQueryProjectSchema.parse({
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt,
    sqlCells,
  });
}
