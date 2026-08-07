import { AgentTabsPage } from "@agent-native/core/client/agent-chat";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Agent - ${APP_TITLE}` }];
}

export default function AgentRoute() {
  return <AgentTabsPage appName={APP_TITLE} />;
}
