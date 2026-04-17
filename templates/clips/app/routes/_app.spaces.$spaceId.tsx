import { useMemo } from "react";
import { useParams } from "react-router";
import { LibraryGrid } from "@/components/library/library-grid";
import { FolderTree, type FolderNode } from "@/components/library/folder-tree";
import { useFolders, useSpaces, useWorkspaces } from "@/hooks/use-library";

export function meta() {
  return [{ title: "Space · Clips" }];
}

export default function SpaceRoute() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { data: workspaces } = useWorkspaces();
  const currentWorkspaceId =
    workspaces?.currentId ?? workspaces?.workspaces?.[0]?.id;
  const { data: spacesData } = useSpaces(currentWorkspaceId);
  const space = (spacesData?.spaces ?? []).find((s: any) => s.id === spaceId);

  const { data: folders } = useFolders({
    workspaceId: currentWorkspaceId,
    spaceId,
  });
  const folderList: FolderNode[] = useMemo(
    () =>
      (folders?.folders ?? [])
        .filter((f: any) => f.spaceId === spaceId)
        .map((f: any) => ({
          id: f.id,
          parentId: f.parentId ?? null,
          spaceId: f.spaceId ?? null,
          name: f.name,
        })),
    [folders, spaceId],
  );

  return (
    <div className="flex flex-1 min-h-0">
      {/* Space-scoped folder rail */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-sidebar p-2 lg:flex">
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <div
              className="h-5 w-5 rounded flex items-center justify-center text-[10px] text-white"
              style={{ background: (space as any)?.color ?? "#625DF5" }}
            >
              {(space as any)?.iconEmoji ??
                (space as any)?.name?.slice(0, 1).toUpperCase() ??
                "S"}
            </div>
            <span className="text-xs font-semibold text-foreground truncate">
              {(space as any)?.name ?? "Space"}
            </span>
          </div>
        </div>
        <div className="mt-2">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Folders
          </div>
          <FolderTree
            folders={folderList}
            workspaceId={currentWorkspaceId}
            spaceId={spaceId ?? null}
            buildPath={(id) => `/spaces/${spaceId}/folder/${id}`}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <LibraryGrid
          view="space"
          spaceId={spaceId}
          folderId={null}
          emptyKind="space"
          title={(space as any)?.name ?? "Space"}
          subtitle="Shared recordings"
        />
      </div>
    </div>
  );
}
