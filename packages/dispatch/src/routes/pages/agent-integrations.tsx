import { useAgentSettingsTabs } from "@agent-native/core/client/settings";

import { DispatchShell } from "../../components/dispatch-shell";

export function meta() {
  return [{ title: "Integrations — Dispatch" }];
}

export default function AgentIntegrationsRoute() {
  const settingsTabs = useAgentSettingsTabs();
  const integrationsTab = settingsTabs.find((tab) => tab.id === "integrations");
  if (!integrationsTab) {
    throw new Error("The shared Integrations settings view is unavailable.");
  }

  return (
    <DispatchShell
      title="Integrations"
      description="Connect the tools and services available to your agent."
    >
      <div className="mx-auto w-full max-w-5xl">{integrationsTab.content}</div>
    </DispatchShell>
  );
}
