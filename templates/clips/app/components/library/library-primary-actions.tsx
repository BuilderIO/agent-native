import { useT } from "@agent-native/core/client/i18n";
import { IconVideoPlus } from "@tabler/icons-react";
import { NavLink } from "react-router";

import { ImportMenu } from "@/components/import-menu";

import { PageHeaderActionGroup, PageHeaderPrimaryAction } from "./page-header";

interface LibraryPrimaryActionsProps {
  folderId?: string | null;
  spaceId?: string | null;
}

function scopedPath(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function LibraryPrimaryActions({
  folderId,
  spaceId,
}: LibraryPrimaryActionsProps) {
  const t = useT();
  const scope = new URLSearchParams();
  if (spaceId) scope.set("spaceId", spaceId);
  if (folderId) scope.set("folderId", folderId);

  const recordHref = scopedPath("/record", scope);
  const uploadParams = new URLSearchParams(scope);
  uploadParams.set("autoUpload", "1");
  const uploadHref = scopedPath("/record", uploadParams);
  const importLoomHref = scopedPath("/import", scope);

  return (
    <PageHeaderActionGroup>
      <PageHeaderPrimaryAction asChild>
        <NavLink to={recordHref} aria-label={t("navigation.newRecording")}>
          <IconVideoPlus />
          <span className="hidden sm:inline">
            {t("navigation.newRecording")}
          </span>
        </NavLink>
      </PageHeaderPrimaryAction>
      <ImportMenu
        uploadHref={uploadHref}
        importLoomHref={importLoomHref}
        iconOnly
        triggerIcon="chevron"
        size="sm"
        variant="default"
        className="w-8 self-stretch border-s border-primary-foreground/20 px-0 shadow-none"
        menuSide="bottom"
        menuAlign="end"
      />
    </PageHeaderActionGroup>
  );
}
