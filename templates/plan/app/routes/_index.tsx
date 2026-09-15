import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

const SEO_TITLE = "Plan";
const SEO_DESCRIPTION =
  "Visual plans, diagrams, wireframes, and shareable reviews for coding-agent work.";

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
      appName="Plan"
      tagline="Turn coding-agent plans into visual, annotatable HTML before code changes happen."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Create diagrams, wireframes, mockups, and prototype options from one prompt",
        "Annotate plans as a visual review surface",
        "Share account-backed review links when a plan needs outside feedback",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
