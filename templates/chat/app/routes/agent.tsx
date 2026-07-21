import {
  AgentChatSurface,
  AgentTabsPage,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { resolveAgentPageComponent } from "@/lib/agent-page";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Agent - ${APP_TITLE}` }];
}

export default function AgentRoute() {
  const t = useT();
  useSetPageTitle(t("settings.agentTitle"));

  const AgentPage = resolveAgentPageComponent({
    AgentChatSurface,
    AgentTabsPage,
  });
  return <AgentPage appName={APP_TITLE} />;
}
