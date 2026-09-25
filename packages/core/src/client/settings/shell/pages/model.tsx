import { AgentSettingsContent } from "../../SettingsPanel.js";
import type { SettingsPageProps } from "../registry.js";

// Bridge: today's Agent overview, which also carries voice, the app default
// model, background agents, and any `agentAdditionalContent` a template
// passed, so nothing is unreachable before the Model page lands.
export default function ModelSettingsPage({ bridge }: SettingsPageProps) {
  const tab = bridge.tab("agent");
  if (tab) return <>{tab.content}</>;
  return (
    <AgentSettingsContent
      sections={["llm", "app-models", "limits", "voice", "background"]}
    />
  );
}
