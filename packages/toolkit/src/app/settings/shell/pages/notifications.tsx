import type { SettingsPageProps } from "../registry.js";

export default function NotificationsSettingsPage({
  bridge,
}: SettingsPageProps) {
  return <>{bridge.tab("notifications")?.content ?? null}</>;
}
