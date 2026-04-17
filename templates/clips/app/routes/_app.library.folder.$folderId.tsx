import { useParams } from "react-router";
import { LibraryGrid } from "@/components/library/library-grid";
import { useFolders } from "@/hooks/use-library";
import { useMemo } from "react";

export function meta() {
  return [{ title: "Folder · Clips" }];
}

export default function LibraryFolderRoute() {
  const { folderId } = useParams<{ folderId: string }>();

  const { data: folders } = useFolders({});
  const folder = useMemo(
    () =>
      (folders?.folders ?? []).find((f: any) => f.id === folderId) as
        | { name: string }
        | undefined,
    [folders, folderId],
  );

  return (
    <LibraryGrid
      view="library"
      folderId={folderId}
      emptyKind="folder"
      title={folder?.name ?? "Folder"}
      subtitle="Recordings in this folder"
    />
  );
}
