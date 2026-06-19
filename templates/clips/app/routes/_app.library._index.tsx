import { LibraryGrid } from "@/components/library/library-grid";

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
  return <LibraryGrid view="library" folderId={null} title="Library" />;
}
