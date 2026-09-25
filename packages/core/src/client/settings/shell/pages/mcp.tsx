import { McpAccessSettings } from "../../../resources/McpAccessSettings.js";
import type { SettingsPageProps } from "../registry.js";

export default function McpServerSettingsPage({ bridge }: SettingsPageProps) {
  const tab = bridge.tab("mcp");
  if (tab) return <>{tab.content}</>;
  return <McpAccessSettings />;
}
