import { AgentTabsPage, useT } from "@agent-native/core/client";
import { createCreativeContextAgentTab } from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.agentTitle }];
}

export default function AgentRoute() {
  const t = useT();
  useSetPageTitle(t("settings.agentTitle"));

  return <AgentTabsPage extraTabFactories={[createCreativeContextAgentTab]} />;
}
