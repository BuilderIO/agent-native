import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";
import { useParams } from "react-router";

import { LibraryGrid } from "@/components/library/library-grid";
import { LibraryPrimaryActions } from "@/components/library/library-primary-actions";
import {
  getFolderAncestorPath,
  useFolders,
  useOrganizations,
} from "@/hooks/use-library";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.folderPageTitle }];
}

export default function LibraryFolderRoute() {
  const t = useT();
  const { folderId } = useParams<{ folderId: string }>();

  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data: folders } = useFolders({
    organizationId: currentOrganizationId,
  });
  const folderPath = useMemo(
    () => getFolderAncestorPath(folders?.folders ?? [], folderId),
    [folders, folderId],
  );
  const folder = folderPath[folderPath.length - 1];

  return (
    <LibraryGrid
      view="library"
      kind="video"
      folderId={folderId}
      emptyKind="folder"
      title={folder?.name ?? t("navigation.folder")}
      breadcrumbItems={[
        { label: t("navigation.library"), to: "/library" },
        ...folderPath.slice(0, -1).map((ancestor) => ({
          label: ancestor.name,
          to: `/library/folder/${ancestor.id}`,
        })),
        { label: folder?.name ?? t("navigation.folder") },
      ]}
      extraActions={<LibraryPrimaryActions folderId={folderId} />}
    />
  );
}
