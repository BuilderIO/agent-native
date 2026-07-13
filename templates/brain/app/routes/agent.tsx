import { AgentTabsPage } from "@agent-native/core/client";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.agentTitle }];
}

export default function AgentRoute() {
  return <AgentTabsPage appName="Brain" />;
}
