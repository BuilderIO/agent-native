import type { SettingsPageProps } from "../registry.js";

export default function WhatsNewSettingsPage({ bridge }: SettingsPageProps) {
  return <>{bridge.whatsNew}</>;
}
