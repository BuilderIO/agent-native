import { AgentSettingsContent } from "@agent-native/toolkit/app/settings";

export function AnalyticsAgentSettingsPage() {
  return <AgentSettingsContent sections={["llm", "app-models"]} />;
}
