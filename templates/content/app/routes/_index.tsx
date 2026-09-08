import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE = "Content - Open Source, agent-friendly Obsidian alternative";
const SEO_DESCRIPTION =
  "Open Source MDX editor for local docs, knowledge bases, and content systems, with custom blocks and agent-assisted editing.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
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
      appName="Content"
      tagline={SEO_TITLE}
      description={SEO_DESCRIPTION}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
