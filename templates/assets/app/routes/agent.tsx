import { AgentTabsPage } from "@agent-native/core/client";
import { createCreativeContextAgentTab } from "@agent-native/creative-context/client";

export default function AgentRoute() {
  return (
    <AgentTabsPage
      appName="Assets"
      extraTabFactories={[createCreativeContextAgentTab]}
    />
  );
}
