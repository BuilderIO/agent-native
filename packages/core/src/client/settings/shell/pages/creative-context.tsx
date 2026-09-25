import type { SettingsPageProps } from "../registry.js";

export default function CreativeContextSettingsPage({
  bridge,
}: SettingsPageProps) {
  return <>{bridge.tab("library")?.content ?? null}</>;
}
