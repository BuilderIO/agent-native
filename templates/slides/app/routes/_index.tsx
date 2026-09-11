import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE =
  "Slides - Open Source AI presentation builder and Google Slides alternative";
const SEO_DESCRIPTION =
  "Open Source AI presentation builder for generating, editing, refining, and exporting React decks as Google Slides-ready presentations.";

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
      appName="Slides"
      tagline="Your AI agent builds, edits, and refines presentations alongside you."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Generate entire decks from a single prompt",
        "Make surgical slide edits while you present or review",
        "Collaborate in real time with your agent",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
