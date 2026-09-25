import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE =
  "Analytics - Open Source Alternative to Amplitude & FullStory";
const SEO_DESCRIPTION =
  "Open Source analytics app and alternative to Amplitude and FullStory where AI agents connect to warehouses, product analytics, and CRM data to answer questions and build dashboards.";

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
      appName="Analytics"
      tagline="Your AI agent queries your data sources, builds dashboards, and answers business questions alongside you."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Ask questions across BigQuery, HubSpot, Jira, and more",
        "Build dashboards from live data across your sources",
        "Re-run saved analyses with fresh numbers",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
