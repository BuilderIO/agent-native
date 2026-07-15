import { AgentTabsPage, useT } from "@agent-native/core/client";
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
