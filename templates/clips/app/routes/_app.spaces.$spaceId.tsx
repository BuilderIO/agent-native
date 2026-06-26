import { useT } from "@agent-native/core/client";
import { useMemo } from "react";
import { useParams } from "react-router";

import { FolderTree, type FolderNode } from "@/components/library/folder-tree";
import { LibraryGrid } from "@/components/library/library-grid";
import { useFolders, useSpaces, useOrganizations } from "@/hooks/use-library";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.spacePageTitle }];
}

export default function SpaceRoute() {
  const t = useT();
  const { spaceId } = useParams<{ spaceId: string }>();
  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data: spacesData } = useSpaces(currentOrganizationId);
  const space = (spacesData?.spaces ?? []).find((s: any) => s.id === spaceId);

  const { data: folders } = useFolders({
    organizationId: currentOrganizationId,
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
              style={{ background: (space as any)?.color ?? "#18181B" }}
            >
              {(space as any)?.iconEmoji ??
                (space as any)?.name?.slice(0, 1).toUpperCase() ??
                t("navigation.space").slice(0, 1)}
            </div>
            <span className="text-xs font-semibold text-foreground truncate">
              {(space as any)?.name ?? t("navigation.space")}
            </span>
          </div>
        </div>
        <div className="mt-2">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("navigation.folders")}
          </div>
          <FolderTree
            folders={folderList}
            organizationId={currentOrganizationId}
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
          title={(space as any)?.name ?? t("navigation.space")}
        />
      </div>
    </div>
  );
}
