import { useT } from "@agent-native/core/client/i18n";
import { IconVideoPlus } from "@tabler/icons-react";
import { NavLink } from "react-router";

import { ImportMenu } from "@/components/import-menu";
import { LibraryGrid } from "@/components/library/library-grid";
import {
  PageHeaderActionGroup,
  PageHeaderPrimaryAction,
} from "@/components/library/page-header";

const SEO_TITLE = "Clips - Open Source screen recorder";
const SEO_DESCRIPTION =
  "Open Source screen recorder and meeting-notes app with AI transcripts, summaries, search, dictation, and agent-readable share links.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function LibraryIndexRoute() {
  const t = useT();

  return (
    <LibraryGrid
      view="library"
      folderId={null}
      title={t("navigation.library")}
      extraActions={
        <PageHeaderActionGroup>
          <PageHeaderPrimaryAction asChild>
            <NavLink to="/record" aria-label={t("navigation.newRecording")}>
              <IconVideoPlus />
              <span className="hidden sm:inline">
                {t("navigation.newRecording")}
              </span>
            </NavLink>
          </PageHeaderPrimaryAction>
          <ImportMenu
            uploadHref="/record?autoUpload=1"
            importLoomHref="/import"
            iconOnly
            triggerIcon="chevron"
            size="sm"
            variant="default"
            className="w-8 self-stretch border-s border-primary-foreground/20 px-0 shadow-none"
            menuSide="bottom"
            menuAlign="end"
          />
        </PageHeaderActionGroup>
      }
    />
  );
}
