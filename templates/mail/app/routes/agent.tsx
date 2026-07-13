import { AgentTabsPage, useT } from "@agent-native/core/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.settings.agentTitle }];
}

export default function AgentRoute() {
  const t = useT();
  useSetPageTitle(t("settings.agentTitle"));

  return <AgentTabsPage appName="Mail" />;
}
