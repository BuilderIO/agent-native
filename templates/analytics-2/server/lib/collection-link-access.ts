import {
  requireReadableProject,
  type AuthorizedProject,
} from "./project-action-access.js";
import { workspaceAccess } from "./workspace-access.js";

/**
 * Filing a project into a collection (or taking it out) needs the workspace's
 * `create-project` capability and read access to the project; it does not need
 * ownership and never grants the project to anyone. The collection side is
 * checked by the store, which requires a Manager of that collection. Unlike
 * `requireWritableProject` this does not touch the project's working draft.
 */
export async function requireLinkableProject(
  projectId: string,
): Promise<AuthorizedProject> {
  const readable = await requireReadableProject(projectId);
  await workspaceAccess.assertPermission(["create-project"], readable.scope);
  return readable;
}
