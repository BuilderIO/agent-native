import { and, desc, eq, isNull, sql } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { requireWorkspaceScope, type WorkspaceScope } from "./scope.js";

export async function readShellProjects(scopeInput: WorkspaceScope) {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const { projects } = schema;
  const active = and(
    eq(projects.ownerEmail, scope.ownerEmail),
    eq(projects.orgId, scope.orgId),
    eq(projects.listed, true),
    isNull(projects.trashedAt),
    isNull(projects.archivedAt),
  );
  const db = getDb();
  const [recent, favorites] = await Promise.all([
    db
      .select({
        id: projects.id,
        title: projects.title,
        favorited: projects.favorited,
        publishedVersionId: projects.publishedVersionId,
        updatedAt: projects.updatedAt,
        lastOpenedAt: projects.lastOpenedAt,
      })
      .from(projects)
      .where(active)
      .orderBy(
        desc(sql`coalesce(${projects.lastOpenedAt}, ${projects.updatedAt})`),
        projects.id,
      )
      .limit(10),
    db
      .select({
        id: projects.id,
        title: projects.title,
        publishedVersionId: projects.publishedVersionId,
      })
      .from(projects)
      .where(and(active, eq(projects.favorited, true)))
      .orderBy(desc(projects.updatedAt), desc(projects.id)),
  ]);
  return { recent, favorites };
}
