import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

import { APP_TITLE } from "@/lib/app-config";
import { workflow } from "@/lib/workflow";

const SEO_TITLE = workflow.title;
const SEO_DESCRIPTION = workflow.summary;

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
      tagline={workflow.summary}
      description={SEO_DESCRIPTION}
      primaryActionHref={appPath("/workspace")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
