import { AgentTabsPage, useT } from "@agent-native/core/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Agent - ${APP_TITLE}` }];
}

export default function AgentRoute() {
  const t = useT();
  useSetPageTitle(t("settings.agentTitle"));

  return <AgentTabsPage appName={APP_TITLE} />;
}
