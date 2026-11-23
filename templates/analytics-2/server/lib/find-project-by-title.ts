import { listWorkspaceVisibleProjects } from "../model/projects-store.js";
import { matchProjectsByTitle } from "./project-title-match.js";
import { requireCurrentWorkspace } from "./workspace-access.js";

export async function findProjectsByTitle(name: string) {
  const current = await requireCurrentWorkspace();
  const visible = (
    await listWorkspaceVisibleProjects({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
    })
  ).filter((project) => !project.archivedAt);
  return matchProjectsByTitle(visible, name);
}
