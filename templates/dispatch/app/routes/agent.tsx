import { AgentTabsPage } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { DispatchShell } from "@agent-native/dispatch/components";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.agentTitle }];
}

export default function AgentRoute() {
  const t = useT();

  return (
    <DispatchShell title={t("settings.agentTitle")}>
      <AgentTabsPage />
    </DispatchShell>
  );
}
