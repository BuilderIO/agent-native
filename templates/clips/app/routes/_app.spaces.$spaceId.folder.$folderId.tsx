import { useMemo } from "react";
import { useParams } from "react-router";
import { LibraryGrid } from "@/components/library/library-grid";
import { useFolders } from "@/hooks/use-library";

export function meta() {
  return [{ title: "Folder · Clips" }];
}

export default function SpaceFolderRoute() {
  const { spaceId, folderId } = useParams<{
    spaceId: string;
    folderId: string;
  }>();

  const { data: folders } = useFolders({ spaceId });
  const folder = useMemo(
    () =>
      (folders?.folders ?? []).find((f: any) => f.id === folderId) as
        | { name: string }
        | undefined,
    [folders, folderId],
  );

  return (
    <LibraryGrid
      view="space"
      spaceId={spaceId}
      folderId={folderId}
      emptyKind="folder"
      title={folder?.name ?? "Folder"}
      subtitle="Folder in space"
    />
  );
}
