import { useT } from "@agent-native/core/client/i18n";

import { LibraryGrid } from "@/components/library/library-grid";
import { LibraryPrimaryActions } from "@/components/library/library-primary-actions";

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
      extraActions={<LibraryPrimaryActions />}
    />
  );
}
