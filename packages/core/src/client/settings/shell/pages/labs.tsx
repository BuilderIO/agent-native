import { LabsSettings } from "../../../labs/LabsSettings.js";
import type { SettingsPageProps } from "../registry.js";

export default function LabsSettingsPage({ bridge }: SettingsPageProps) {
  return (
    <LabsSettings
      labs={bridge.labs}
      title={bridge.labsLabel}
      intro={bridge.labsIntro}
    />
  );
}
