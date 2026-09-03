import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE =
  "CRM - Open Source agent-native customer relationship manager";
const SEO_DESCRIPTION =
  "Open Source CRM for accounts, people, opportunities, tasks, and connected customer data, with safe actions your agent can use.";

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
      appName="CRM"
      tagline="A complete Native SQL CRM or a connected companion grounded in its source system."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Run accounts, people, opportunities, tasks, and cadence on Native SQL",
        "Connect scoped HubSpot or Salesforce records without copying credentials",
        "Use the same safe actions from the UI or your CRM agent",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
