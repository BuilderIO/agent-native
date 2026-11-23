import { and, eq, inArray, isNull } from "@agent-native/core/db/schema";
import { orgMembers } from "@agent-native/core/org";
import { accessFilter } from "@agent-native/core/sharing";

import { getDb, schema } from "../db/index.js";
import { listPendingWorkspaceInvites } from "./pending-workspace-invites.js";
import {
  canEditProject,
  canReadProject,
  projectAccessLevel,
} from "./project-grant-access.js";
import {
  type Queryable,
  type WorkspaceScope,
  requireWorkspaceScope,
} from "./scope.js";

const { projects, cells } = schema;
const appGrants = schema.publishedAppGrants;

export type ProjectRow = typeof projects.$inferSelect;

export class ProjectAccessError extends Error {
  readonly code = "analytics_project_not_found";
  readonly statusCode = 404;

  constructor(message = "That project is not in this workspace.") {
    super(message);
    this.name = "ProjectAccessError";
  }
}

/**
 * The one place a project id becomes trusted.
 *
 * Child rows (versions, cells, runs, outputs) have no owner or organisation of
 * their own, so every public child operation starts by resolving the parent
 * through this scope-bound read. A caller cannot reach a child by guessing its
 * id in another organisation or another account.
 */
export async function getAuthorizedProjectRow(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  db: Queryable = getDb(),
): Promise<typeof projects.$inferSelect | null> {
  const scope = requireWorkspaceScope(scopeInput);
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
        eq(projects.id, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Read through ownership or the workspace-scoped project grants. */
export async function getReadableProjectRow(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  db: Queryable = getDb(),
): Promise<typeof projects.$inferSelect | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.ownerEmail, requireWorkspaceScope(scopeInput).ownerEmail),
        eq(projects.orgId, requireWorkspaceScope(scopeInput).orgId),
        eq(projects.id, projectId),
      ),
    )
    .limit(1);
  const owned = rows[0] ?? null;
  if (owned !== null) return owned;
  const scope = requireWorkspaceScope(scopeInput);
  const candidate = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.orgId, scope.orgId),
        eq(projects.id, projectId),
        accessFilter(projects, schema.projectShares, {
          userEmail: scope.ownerEmail,
          orgId: scope.orgId,
        }),
      ),
    )
    .limit(1);
  if (candidate[0]) return candidate[0];
  return getPendingInviteeProjectRow(scope, projectId, db);
}

async function getPendingInviteeProjectRow(
  scope: WorkspaceScope,
  projectId: string,
  db: Queryable,
): Promise<ProjectRow | null> {
  const invitedOrgIds = (
    await listPendingWorkspaceInvites(scope.ownerEmail, db)
  )
    .map((invite) => invite.orgId)
    .filter((orgId) => orgId !== scope.orgId);
  if (invitedOrgIds.length === 0) return null;
  const found = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, projectId), inArray(projects.orgId, invitedOrgIds)),
    )
    .limit(1);
  const project = found[0];
  if (
    !project ||
    project.ownerEmail.trim().toLowerCase() ===
      scope.ownerEmail.trim().toLowerCase()
  )
    return null;
  const level = await projectAccessLevel(scope, project, [], db);
  return canReadProject(level) ? project : null;
}

async function getAppViewerProjectRow(
  scope: WorkspaceScope,
  projectId: string,
  db: Queryable = getDb(),
  lock = false,
): Promise<ProjectRow | null> {
  const query = db
    .select({ project: projects })
    .from(appGrants)
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.id, appGrants.memberId),
        eq(orgMembers.orgId, appGrants.orgId),
        eq(orgMembers.email, scope.ownerEmail),
        inArray(orgMembers.role, ["owner", "admin", "member"]),
        isNull(orgMembers.federationRemovalPendingAt),
      ),
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, appGrants.projectId),
        eq(projects.orgId, appGrants.orgId),
      ),
    )
    .where(
      and(
        eq(appGrants.orgId, scope.orgId),
        eq(appGrants.projectId, projectId),
        isNull(appGrants.revokedAt),
        isNull(projects.trashedAt),
      ),
    )
    .limit(1);
  const [match] = await (lock
    ? query.for("share", { of: [appGrants, orgMembers] })
    : query);
  return match?.project ?? null;
}

export async function resolvePublishedProjectAccess(
  scope: WorkspaceScope,
  projectId: string,
  db: Queryable = getDb(),
  lock = false,
) {
  const legacy = await getReadableProjectRow(scope, projectId, db);
  if (legacy)
    return legacy.trashedAt ? null : { project: legacy, appOnly: false };
  const project = await getAppViewerProjectRow(scope, projectId, db, lock);
  return project ? { project, appOnly: true } : null;
}

export async function assertAuthorizedProject(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  db: Queryable = getDb(),
): Promise<typeof projects.$inferSelect & { orgId: string }> {
  const row = await getAuthorizedProjectRow(scopeInput, projectId, db);
  if (row === null) throw new ProjectAccessError();
  return row as typeof projects.$inferSelect & { orgId: string };
}

export async function assertReadableProject(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  db: Queryable = getDb(),
): Promise<ProjectRow> {
  const row = await getReadableProjectRow(scopeInput, projectId, db);
  if (row === null) throw new ProjectAccessError();
  return row;
}

export async function assertEditableProject(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  db: Queryable = getDb(),
): Promise<ProjectRow> {
  const scope = requireWorkspaceScope(scopeInput);
  const row = await getReadableProjectRow(scope, projectId, db);
  if (
    row === null ||
    row.orgId !== scope.orgId ||
    row.trashedAt !== null ||
    !canEditProject(await projectAccessLevel(scope, row, [], db))
  )
    throw new ProjectAccessError();
  return row;
}

/** A cell id is only valid inside the project that was just authorised. */
export async function assertCellInProject(
  projectId: string,
  cellId: string,
  db: Queryable = getDb(),
): Promise<void> {
  const rows = await db
    .select({ id: cells.id })
    .from(cells)
    .where(and(eq(cells.projectId, projectId), eq(cells.id, cellId)))
    .limit(1);
  if (rows.length === 0) {
    throw new ProjectAccessError("That cell is not in this project.");
  }
}
