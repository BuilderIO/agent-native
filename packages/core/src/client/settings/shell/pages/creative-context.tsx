import { useMemo } from "react";

import { useT } from "../../../i18n.js";
import { SettingsHeaderBadge } from "../../app-group/SettingsHeaderBadge.js";
import { useSettingsPageHeader } from "../context.js";
import type { SettingsPageProps } from "../registry.js";

/**
 * The creative-context library tab templates add while its lab is on. The
 * page shows only while that tab exists, and `/settings/library` redirects
 * here.
 */
export default function CreativeContextSettingsPage({
  bridge,
}: SettingsPageProps) {
  const t = useT();
  const labsLabel = t("agentChat.settingsShell.page.labs");
  const header = useMemo(
    () => ({ badge: <SettingsHeaderBadge label={labsLabel} /> }),
    [labsLabel],
  );
  useSettingsPageHeader(header);
  return <>{bridge.tab("library")?.content ?? null}</>;
}
