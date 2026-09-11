import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE =
  "Calendar - Open Source AI scheduling and Google Calendar automation";
const SEO_DESCRIPTION =
  "Open Source AI calendar app for Google Calendar scheduling, booking links, meeting coordination, and agent-managed event updates.";

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
      appName="Calendar"
      tagline={SEO_TITLE}
      description={SEO_DESCRIPTION}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
