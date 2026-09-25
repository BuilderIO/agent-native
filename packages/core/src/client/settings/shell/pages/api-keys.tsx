import { AgentSettingsContent } from "../../SettingsPanel.js";
import type { SettingsPageProps } from "../registry.js";

export default function ApiKeysSettingsPage({ bridge }: SettingsPageProps) {
  const tab = bridge.tab("keys", "secrets");
  if (tab) return <>{tab.content}</>;
  return <AgentSettingsContent sections={["secrets"]} />;
}
