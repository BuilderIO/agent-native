import { useT } from "../../../i18n.js";
import { LabsSettingsGroup } from "../../../labs/LabsSettings.js";
import type { SettingsPageProps } from "../registry.js";

export default function LabsSettingsPage({ bridge }: SettingsPageProps) {
  const t = useT();
  return (
    <LabsSettingsGroup
      labs={bridge.labs}
      title={bridge.appName ?? t("agentChat.settingsShell.appFallbackName")}
    />
  );
}
