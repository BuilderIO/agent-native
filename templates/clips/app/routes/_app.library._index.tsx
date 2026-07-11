import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconPlayerRecord } from "@tabler/icons-react";
import { NavLink } from "react-router";

import { LibraryGrid } from "@/components/library/library-grid";
import { usePageHeaderLayout } from "@/components/library/page-header";

const SEO_TITLE =
  "Agent-Native Clips - Open Source, agent-friendly Loom alternative";
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
  const { sidebarHasNewRecordingAction } = usePageHeaderLayout();
  return (
    <LibraryGrid
      view="library"
      folderId={null}
      title="Library"
      extraActions={
        !sidebarHasNewRecordingAction && (
          <Button
            className="gap-1.5 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
            size="sm"
            asChild
          >
            <NavLink to="/record" aria-label={t("navigation.newRecording")}>
              <IconPlayerRecord className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("navigation.newRecording")}
              </span>
            </NavLink>
          </Button>
        )
      }
    />
  );
}
