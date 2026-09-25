import { useMemo } from "react";

import { ChangelogSettingsCard } from "../../../changelog/Changelog.js";
import { useT } from "../../../i18n.js";
import { SettingsHeaderBadge } from "../../app-group/SettingsHeaderBadge.js";
import { useSettingsPageHeader } from "../context.js";
import type { SettingsPageProps } from "../registry.js";

export default function WhatsNewSettingsPage({ bridge }: SettingsPageProps) {
  const t = useT();
  const appName =
    bridge.appName ?? t("agentChat.settingsShell.appFallbackName");
  const chipTooltip = t("agentChat.settingsShell.appGroup.whatsNewChip", {
    app: appName,
  });
  const header = useMemo(
    () => ({
      badge: <SettingsHeaderBadge label={appName} tooltip={chipTooltip} />,
    }),
    [appName, chipTooltip],
  );
  useSettingsPageHeader(header);
  // A template that passed only a custom element keeps it.
  if (!bridge.whatsNewMarkdown) return <>{bridge.whatsNew}</>;
  return (
    <ChangelogSettingsCard
      markdown={bridge.whatsNewMarkdown}
      hideTitle
      emptyText={t("agentChat.settingsShell.appGroup.whatsNewEmpty")}
      viewAllLabel={t("agentChat.settingsShell.appGroup.whatsNewViewAll")}
      collapseLabel={t("agentChat.settingsShell.appGroup.whatsNewShowFewer")}
    />
  );
}
