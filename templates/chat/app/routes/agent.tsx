import * as AgentClient from "@agent-native/core/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { resolveAgentPageComponent } from "@/lib/agent-page";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Agent - ${APP_TITLE}` }];
}

export default function AgentRoute() {
  const t = AgentClient.useT();
  useSetPageTitle(t("settings.agentTitle"));

  const AgentPage = resolveAgentPageComponent(AgentClient);
  return <AgentPage appName={APP_TITLE} />;
}
