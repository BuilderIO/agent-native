import { fail } from "@agent-native/core/action";
import { and, eq, inArray } from "@agent-native/core/db/schema";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { readDataCategories } from "./data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { type WorkspaceScope, requireWorkspaceScope } from "./scope.js";

const { projectCategories, projects } = schema;

export type ProjectCategoryAssignment = {
  projectId: string;
  categoryIds: string[];
};

/**
 * Every assignment that belongs to a project in the caller's account and
 * organisation. The join is what scopes the read: the assignment table itself
 * carries no owner, so a row is only visible through a project the caller can
 * already see.
 */
export async function readProjectCategories(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  project?: Pick<typeof projects.$inferSelect, "id" | "ownerEmail">,
): Promise<ProjectCategoryAssignment[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const rows = await getDb()
    .select({
      projectId: projectCategories.projectId,
      categoryId: projectCategories.categoryId,
    })
    .from(projectCategories)
    .innerJoin(projects, eq(projectCategories.projectId, projects.id))
    .where(
      and(
        eq(projects.ownerEmail, project?.ownerEmail ?? scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
        project === undefined
          ? undefined
          : eq(projectCategories.projectId, project.id),
      ),
    )
    .orderBy(projectCategories.addedAt, projectCategories.categoryId);

  const byProject = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byProject.get(row.projectId);
    if (existing === undefined) {
      byProject.set(row.projectId, [row.categoryId]);
    } else {
      existing.push(row.categoryId);
    }
  }
  return [...byProject].map(([projectId, categoryIds]) => ({
    projectId,
    categoryIds,
  }));
}

/**
 * Replaces a project's categories. The ids are validated against the
 * organisation's catalogue first, so a stale or foreign id can never be
 * stored; an unknown id is the same typed 400 as the original's rejected
 * label write rather than a silent skip.
 */
export async function setProjectCategories(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  categoryIds: readonly string[],
): Promise<ProjectCategoryAssignment> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);

  const requested = [...new Set(categoryIds)];
  const catalogue = await readDataCategories(scope);
  const known = new Set(catalogue.categories.map((category) => category.id));
  if (requested.some((categoryId) => !known.has(categoryId))) {
    fail("Choose categories from this workspace's catalogue.", {
      statusCode: 400,
      errorCode: "project_category_not_found",
    });
  }

  await getDb().transaction(async (tx) => {
    const owned = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.ownerEmail, scope.ownerEmail),
          eq(projects.orgId, scope.orgId),
          eq(projects.id, projectId),
        ),
      )
      .limit(1)
      .for("update");
    if (owned.length === 0) {
      fail("That project is not in this workspace.", {
        statusCode: 404,
        errorCode: "project_not_found",
      });
    }
    await tx
      .delete(projectCategories)
      .where(eq(projectCategories.projectId, projectId));
    if (requested.length > 0) {
      const addedAt = nowIso();
      await tx
        .insert(projectCategories)
        .values(
          requested.map((categoryId) => ({ projectId, categoryId, addedAt })),
        );
    }
  });
  return { projectId, categoryIds: requested };
}

/**
 * Drops every assignment of one catalogue entry, so removing a category never
 * leaves projects pointing at an id the catalogue no longer has.
 */
export async function clearCategoryAssignments(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  categoryId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const owned = new QueryBuilder()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
      ),
    );
  await getDb()
    .delete(projectCategories)
    .where(
      and(
        eq(projectCategories.categoryId, categoryId),
        inArray(projectCategories.projectId, owned),
      ),
    );
}
