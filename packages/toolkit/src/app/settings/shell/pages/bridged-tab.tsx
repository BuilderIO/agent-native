import type { SettingsPageProps } from "../registry.js";

/** A template tab no core page claims, shown as its own page in the app group. */
export default function BridgedTabSettingsPage({
  bridge,
  pageId,
}: SettingsPageProps) {
  return <>{bridge.tabForPage(pageId)?.content ?? null}</>;
}
