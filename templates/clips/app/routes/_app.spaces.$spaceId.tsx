import { useT } from "@agent-native/core/client/i18n";
import { useParams } from "react-router";

import { LibraryGrid } from "@/components/library/library-grid";
import { LibraryPrimaryActions } from "@/components/library/library-primary-actions";
import { useSpaces, useOrganizations } from "@/hooks/use-library";
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

  return (
    <LibraryGrid
      view="space"
      spaceId={spaceId}
      folderId={null}
      emptyKind="space"
      title={(space as any)?.name ?? t("navigation.space")}
      breadcrumbItems={[
        { label: t("navigation.spaces"), to: "/spaces" },
        { label: (space as any)?.name ?? t("navigation.space") },
      ]}
      extraActions={<LibraryPrimaryActions spaceId={spaceId} />}
    />
  );
}
