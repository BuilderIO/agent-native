import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

import messages from "@/i18n/en-US";

const SEO_TITLE = messages.seo.homeTitle;
const SEO_DESCRIPTION = messages.seo.homeDescription;

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
      appName="Macros"
      tagline="Log meals, exercises, and weight by typing or voice while the agent estimates calories and macros for you."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Log meals and exercises by voice or text",
        "See daily calories and macro progress",
        "Keep your health entries in a durable workspace",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
