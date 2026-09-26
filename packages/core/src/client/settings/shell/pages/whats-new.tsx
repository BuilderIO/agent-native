import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@agent-native/toolkit/ui/empty";
import { IconNews } from "@tabler/icons-react";
import { useMemo } from "react";

import {
  ChangelogSettingsCard,
  parseChangelog,
} from "../../../changelog/Changelog.js";
import { useT } from "../../../i18n.js";
import { SettingsHeaderBadge } from "../../app-group/SettingsHeaderBadge.js";
import { SettingsGroup } from "../../SettingsRow.js";
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
  const markdown = bridge.whatsNewMarkdown;
  const hasEntries = useMemo(
    () => !!markdown && parseChangelog(markdown).length > 0,
    [markdown],
  );
  // A template that passed only a custom element keeps it.
  if (!markdown) return <>{bridge.whatsNew}</>;
  if (!hasEntries) {
    return (
      <SettingsGroup>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconNews aria-hidden="true" />
            </EmptyMedia>
            <EmptyDescription>
              {t("agentChat.settingsShell.appGroup.whatsNewEmpty")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SettingsGroup>
    );
  }
  return (
    <ChangelogSettingsCard
      markdown={markdown}
      className="rounded-xl border-border/70"
      hideTitle
      emptyText={t("agentChat.settingsShell.appGroup.whatsNewEmpty")}
      viewAllLabel={t("agentChat.settingsShell.appGroup.whatsNewViewAll")}
      collapseLabel={t("agentChat.settingsShell.appGroup.whatsNewShowFewer")}
    />
  );
}
