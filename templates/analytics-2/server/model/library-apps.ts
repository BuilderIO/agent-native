import { and, desc, eq, isNull, or } from "@agent-native/core/db/schema";
import { accessFilter } from "@agent-native/core/sharing";
import { lt } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { requireWorkspaceScope, type WorkspaceScope } from "./scope.js";

export async function listLibraryApps(
  scopeInput: WorkspaceScope,
  options: { limit?: number; after?: { updatedAt: string; id: string } } = {},
) {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const { projects, projectVersions, statuses, projectShares } = schema;
  return getDb()
    .select({
      id: projects.id,
      title: projects.title,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(
      statuses,
      and(
        eq(statuses.id, projects.statusId),
        eq(statuses.orgId, scope.orgId),
        or(eq(statuses.endorsed, true), eq(statuses.inLibrary, true)),
      ),
    )
    .innerJoin(
      projectVersions,
      and(
        eq(projectVersions.id, projects.publishedVersionId),
        eq(projectVersions.projectId, projects.id),
        eq(projectVersions.kind, "published"),
      ),
    )
    .where(
      and(
        eq(projects.orgId, scope.orgId),
        isNull(projects.trashedAt),
        isNull(projects.archivedAt),
        options.after
          ? or(
              lt(projects.updatedAt, options.after.updatedAt),
              and(
                eq(projects.updatedAt, options.after.updatedAt),
                lt(projects.id, options.after.id),
              ),
            )
          : undefined,
        accessFilter(projects, projectShares, {
          userEmail: scope.ownerEmail,
          orgId: scope.orgId,
        }),
      ),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(options.limit ?? 101);
}
