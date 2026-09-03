import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = APP_TITLE + " - Open Source agent-native task workspace";
const SEO_DESCRIPTION =
  "Open Source task workspace for inbox triage, ordered lists, custom fields, and agent-assisted follow-through.";

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
      appName={APP_TITLE}
      tagline="Manage personal tasks from inbox to completion, with an agent that can do the work alongside you."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Capture ideas in an inbox and promote them when they are ready",
        "Create, reorder, and complete tasks in the order you choose",
        "Track what matters with custom fields and selected values",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
