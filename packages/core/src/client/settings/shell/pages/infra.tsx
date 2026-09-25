import { WORKSPACE_SETTINGS_SECTIONS } from "../../agent-settings-search.js";
import { AgentSettingsContent } from "../../SettingsPanel.js";
import type { SettingsPageProps } from "../registry.js";

export default function InfrastructureSettingsPage({
  bridge,
}: SettingsPageProps) {
  const tab = bridge.tab("workspace");
  if (tab) return <>{tab.content}</>;
  return <AgentSettingsContent sections={WORKSPACE_SETTINGS_SECTIONS} />;
}
