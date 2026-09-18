import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE = "Brain - Open Source company knowledge base for AI agents";
const SEO_DESCRIPTION =
  "Open Source company knowledge base that turns Slack, meetings, transcripts, docs, and decisions into cited answers for AI agents.";

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

export default function MarketingHomeRoute() {
  return (
    <MarketingHome
      appName="Brain"
      tagline="A company knowledge layer where raw conversations become reviewed, searchable institutional knowledge."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Import transcripts, notes, Slack exports, and meeting summaries",
        "Validate every fact against exact source quotes",
        "Review company knowledge through proposal workflows",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
