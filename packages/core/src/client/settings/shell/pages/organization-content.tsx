import { TeamPage } from "../../../org/TeamPage.js";
import type { SettingsBridge } from "../bridge.js";

/**
 * Today's Organization tab, or a template's override of it. General,
 * Members, and Apps all render it until TeamPage is split.
 */
export function BridgedOrganizationContent({
  bridge,
}: {
  bridge: SettingsBridge;
}) {
  const tab = bridge.tab("organization");
  if (tab) return <>{tab.content}</>;
  if (bridge.team) return <>{bridge.team}</>;
  return <TeamPage showTitle={false} />;
}
