import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";
import { useParams } from "react-router";

import { LibraryGrid } from "@/components/library/library-grid";
import { LibraryPrimaryActions } from "@/components/library/library-primary-actions";
import {
  getFolderAncestorPath,
  useFolders,
  useOrganizations,
  useSpaces,
} from "@/hooks/use-library";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.folderPageTitle }];
}

export default function SpaceFolderRoute() {
  const t = useT();
  const { spaceId, folderId } = useParams<{
    spaceId: string;
    folderId: string;
  }>();

  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;
  const { data: spacesData } = useSpaces(currentOrganizationId);
  const space = (spacesData?.spaces ?? []).find(
    (candidate: any) => candidate.id === spaceId,
  );

  const { data: folders } = useFolders({
    organizationId: currentOrganizationId,
    spaceId,
  });
  const folderPath = useMemo(
    () => getFolderAncestorPath(folders?.folders ?? [], folderId),
    [folders, folderId],
  );
  const folder = folderPath[folderPath.length - 1];

  return (
    <LibraryGrid
      view="space"
      spaceId={spaceId}
      folderId={folderId}
      emptyKind="folder"
      title={folder?.name ?? t("navigation.folder")}
      breadcrumbItems={[
        { label: t("navigation.spaces"), to: "/spaces" },
        {
          label: space?.name ?? t("navigation.space"),
          to: `/spaces/${spaceId}`,
        },
        ...folderPath.slice(0, -1).map((ancestor) => ({
          label: ancestor.name,
          to: `/spaces/${spaceId}/folder/${ancestor.id}`,
        })),
        { label: folder?.name ?? t("navigation.folder") },
      ]}
      extraActions={
        <LibraryPrimaryActions folderId={folderId} spaceId={spaceId} />
      }
    />
  );
}
