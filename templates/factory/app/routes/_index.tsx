import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE = "Factories";
const SEO_DESCRIPTION = "Review and manage your agent factories.";

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
      appName="Factory"
      tagline="Build agent factories: work in one end, shipped changes out the other, with gates you control."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Inspect Slack and pull-request signals in one queue",
        "Tune rules with prompts and reviewable feedback",
        "Approve bounded agent work with a durable audit trail",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
