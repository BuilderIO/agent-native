import { AgentTabsPage } from "@agent-native/core/client/agent-chat";
import { createCreativeContextAgentTab } from "@agent-native/creative-context/client";

export default function AgentRoute() {
  return (
    <AgentTabsPage
      appName="Assets"
      extraTabFactories={[createCreativeContextAgentTab]}
    />
  );
}
