import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  failNotFound,
  firstRow,
  orgScope,
  requireWorkspace,
  workspaceScope,
  type Access,
} from "./_access.js";

/** A live folder the caller can reach through its workspace, or a 404. */
export async function requireFolder(access: Access, id: string) {
  const { folders, workspaces } = schema;
  const row = firstRow(
    await getDb()
      .select({ folder: folders, workspace: workspaces })
      .from(folders)
      .innerJoin(workspaces, eq(workspaces.id, folders.workspaceId))
      .where(
        and(
          eq(folders.id, id),
          orgScope(folders, access.orgId),
          workspaceScope(access.orgId, access.userEmail),
        ),
      )
      .limit(1),
  );
  if (!row || row.folder.deletedAt || row.workspace.deletedAt)
    return failNotFound("Folder not found.");
  return row;
}

/** Checks a destination: a workspace, and a folder inside that workspace when given. */
export async function requireDestination(
  access: Access,
  workspaceId: string,
  folderId: string | null | undefined,
) {
  await requireWorkspace(access, workspaceId);
  if (!folderId) return;
  const { folder } = await requireFolder(access, folderId);
  if (folder.workspaceId !== workspaceId)
    failNotFound("Folder not found in that workspace.");
}
