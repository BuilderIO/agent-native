import { UsageSection } from "../../UsageSection.js";
import type { SettingsPageProps } from "../registry.js";

export default function UsageSettingsPage({
  bridge,
  context,
}: SettingsPageProps) {
  const tab = bridge.tab("usage");
  if (tab) return <>{tab.content}</>;
  return <UsageSection appId={context.appId} />;
}
