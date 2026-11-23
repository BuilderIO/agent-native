import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import { hasPendingWorkspaceInvite } from "./pending-workspace-invites.js";
import { type Queryable, type WorkspaceScope } from "./scope.js";

const { projectShares } = schema;

/**
 * Project access levels, in increasing strength. `owner` is the existing
 * relationship and is never stored as a grant; the framework's share roles map
 * onto the last three.
 */
export type ProjectAccessLevel = "owner" | "manage" | "edit" | "read";

export type ProjectGrant = {
  principalType: "user" | "group" | "org";
  principalId: string;
  role: string;
};

const ROLE_TO_LEVEL: Record<string, ProjectAccessLevel> = {
  admin: "manage",
  editor: "edit",
  commenter: "read",
  viewer: "read",
};

/**
 * What a viewer may do with a project, from the owner relationship and the
 * project's grants alone. Pure on purpose: the whole permission matrix is
 * testable without a database, and the async reader below only loads rows.
 */
export function resolveProjectAccess(input: {
  ownerEmail: string;
  viewerEmail: string;
  viewerOrgId?: string | null | undefined;
  projectOrgId?: string | null | undefined;
  grants: readonly ProjectGrant[];
  sharedGroups?: readonly string[] | undefined;
  visibility?: string | undefined;
  viewerHasPendingInvite?: boolean | undefined;
}): ProjectAccessLevel | null {
  const owner = input.ownerEmail.trim().toLowerCase();
  const viewer = input.viewerEmail.trim().toLowerCase();
  if (!owner || !viewer) return null;
  if (owner === viewer) return "owner";
  if (!input.projectOrgId) return null;
  const inProjectWorkspace = input.projectOrgId === input.viewerOrgId;
  if (!inProjectWorkspace && input.viewerHasPendingInvite !== true) {
    return null;
  }
  const groups = new Set(
    (input.sharedGroups ?? []).map((group) => group.trim().toLowerCase()),
  );
  let best: ProjectAccessLevel | null =
    input.visibility === "org" && inProjectWorkspace ? "read" : null;
  for (const grant of input.grants) {
    if (!inProjectWorkspace && grant.principalType !== "user") continue;
    const matches =
      (grant.principalType === "user" &&
        grant.principalId.trim().toLowerCase() === viewer) ||
      (grant.principalType === "org" &&
        grant.principalId === input.projectOrgId) ||
      (grant.principalType === "group" &&
        groups.has(grant.principalId.trim().toLowerCase()));
    if (!matches) continue;
    const level = ROLE_TO_LEVEL[grant.role] ?? null;
    if (level === null) continue;
    if (best === null || rank(level) > rank(best)) best = level;
  }
  return best;
}

function rank(level: ProjectAccessLevel): number {
  switch (level) {
    case "owner":
      return 4;
    case "manage":
      return 3;
    case "edit":
      return 2;
    case "read":
      return 1;
    default:
      return 0;
  }
}

/** Read and edit are separate answers: a viewer is not an editor. */
export function canReadProject(level: ProjectAccessLevel | null): boolean {
  return level !== null;
}

export function canEditProject(level: ProjectAccessLevel | null): boolean {
  return level === "owner" || level === "manage" || level === "edit";
}

export function canManageProject(level: ProjectAccessLevel | null): boolean {
  return level === "owner" || level === "manage";
}

/**
 * Loads the grants for one project and resolves the viewer's level.
 */
export async function projectAccessLevel(
  scope: WorkspaceScope,
  project: {
    id: string;
    ownerEmail: string;
    orgId?: string | null;
    visibility?: string | undefined;
  },
  viewerGroups: readonly string[] = [],
  db: Queryable = getDb(),
): Promise<ProjectAccessLevel | null> {
  if (
    project.ownerEmail.trim().toLowerCase() ===
    scope.ownerEmail.trim().toLowerCase()
  ) {
    return "owner";
  }
  const grants = (await db
    .select({
      principalType: projectShares.principalType,
      principalId: projectShares.principalId,
      role: projectShares.role,
    })
    .from(projectShares)
    .where(
      eq(projectShares.resourceId, project.id),
    )) as unknown as readonly ProjectGrant[];
  const viewerHasPendingInvite =
    project.orgId && project.orgId !== scope.orgId
      ? await hasPendingWorkspaceInvite(scope.ownerEmail, project.orgId, db)
      : false;
  return resolveProjectAccess({
    viewerHasPendingInvite,
    ownerEmail: project.ownerEmail,
    viewerEmail: scope.ownerEmail,
    viewerOrgId: scope.orgId,
    projectOrgId: project.orgId ?? null,
    grants,
    sharedGroups: viewerGroups,
    visibility: project.visibility,
  });
}
