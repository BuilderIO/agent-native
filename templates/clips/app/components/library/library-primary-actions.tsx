import { useT } from "@agent-native/core/client/i18n";
import { IconVideoPlus } from "@tabler/icons-react";
import { NavLink } from "react-router";

import { ImportMenu } from "@/components/import-menu";

import {
  buildLibraryActionHrefs,
  type LibraryActionScope,
} from "./library-action-hrefs";
import { PageHeaderActionGroup, PageHeaderPrimaryAction } from "./page-header";

interface LibraryPrimaryActionsProps extends LibraryActionScope {
  landing?: boolean;
}

export function LibraryPrimaryActions({
  folderId,
  spaceId,
  landing = false,
}: LibraryPrimaryActionsProps) {
  const t = useT();
  const { recordHref, uploadHref, importLoomHref } = buildLibraryActionHrefs({
    folderId,
    spaceId,
  });

  if (landing) {
    return (
      <PageHeaderActionGroup>
        <ImportMenu
          uploadHref={uploadHref}
          importLoomHref={importLoomHref}
          spaceId={spaceId}
          folderId={folderId}
          recordHref={recordHref}
          triggerIcon="upload"
          size="sm"
          variant="outline"
          menuSide="bottom"
          menuAlign="end"
        />
      </PageHeaderActionGroup>
    );
  }

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
        spaceId={spaceId}
        folderId={folderId}
        recordHref={recordHref}
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
