import type { Folder } from "@shared/form-contract";

/** Only the shape a search needs, so this does not depend on a contract type name. */
type Workspace = { id: string; name: string; folders: readonly Folder[] };

export type PlaceHit =
  | {
      kind: "workspace";
      id: string;
      name: string;
      workspaceId: string;
      folderId: null;
    }
  | {
      kind: "folder";
      id: string;
      name: string;
      workspaceId: string;
      folderId: string;
      workspaceName: string;
    };

const matches = (name: string, query: string) =>
  name.toLowerCase().includes(query.toLowerCase());

/**
 * Workspaces and folders a search should offer. Forms alone were searchable, so
 * typing a workspace or folder name found nothing at all. A folder hit keeps its
 * workspace, because a folder name is only unique inside one.
 */
export function searchPlaces(
  workspaces: readonly Workspace[],
  query: string,
  limit = 5,
): PlaceHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const hits: PlaceHit[] = [];
  for (const workspace of workspaces) {
    if (matches(workspace.name, trimmed))
      hits.push({
        kind: "workspace",
        id: workspace.id,
        name: workspace.name,
        workspaceId: workspace.id,
        folderId: null,
      });
  }
  for (const workspace of workspaces) {
    for (const folder of workspace.folders as Folder[]) {
      if (!matches(folder.name, trimmed)) continue;
      hits.push({
        kind: "folder",
        id: folder.id,
        name: folder.name,
        workspaceId: workspace.id,
        folderId: folder.id,
        workspaceName: workspace.name,
      });
    }
  }
  return hits.slice(0, limit);
}
