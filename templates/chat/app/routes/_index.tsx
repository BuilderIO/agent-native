import { appPath } from "@agent-native/core/client/api-path";
import { MarketingHome } from "@agent-native/toolkit/marketing";

import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = APP_TITLE + " - Open Source AI app starter with actions";
const SEO_DESCRIPTION =
  "Open Source starter for agent-native apps with durable chat, shared actions, UI state, tools, and a backend your agent can extend.";

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
      tagline="Start from a chat-first agent-native app and add actions, screens, and workflows as you grow."
      description={SEO_DESCRIPTION}
      valueProps={[
        "Full-page chat with durable threads and tool call history",
        "Use shared actions from chat, UI, HTTP, MCP, A2A, and CLI",
        "Plug in your own agent runtime or use the included app-agent loop",
      ]}
      primaryActionHref={appPath("/home")}
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
