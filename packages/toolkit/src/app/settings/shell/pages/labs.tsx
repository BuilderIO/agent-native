import { useT } from "@agent-native/core/client/i18n";

import { LabsSettingsGroup } from "../../../labs/index.js";
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
