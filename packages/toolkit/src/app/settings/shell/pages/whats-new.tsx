import { useT } from "@agent-native/core/client/i18n";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@agent-native/toolkit/ui/empty";
import { IconNews } from "@tabler/icons-react";
import { useMemo } from "react";

import {
  ModelSurface,
  rowAttributes,
} from "../../../../design-system/parts.js";
import {
  ChangelogSettingsCard,
  parseChangelog,
} from "../../../changelog/index.js";
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
  const markdown = bridge.whatsNewMarkdown;
  const hasEntries = useMemo(
    () => !!markdown && parseChangelog(markdown).length > 0,
    [markdown],
  );
  // A template that passed only a custom element keeps it.
  if (!markdown) return <>{bridge.whatsNew}</>;
  if (!hasEntries) {
    const emptyLabel = t("agentChat.settingsShell.appGroup.whatsNewEmpty");
    return (
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.whats-new.entries",
              part: "settings.group",
              label: t("agentChat.settingsShell.page.whatsNew"),
              labelHidden: true,
              rows: [
                {
                  id: "settings.whats-new.empty",
                  part: "settings.content",
                  label: emptyLabel,
                  slot: "empty",
                },
              ],
            },
          ],
        }}
        slots={{
          empty: (row) => (
            <Empty {...rowAttributes(row)}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconNews aria-hidden="true" />
                </EmptyMedia>
                <EmptyDescription>{emptyLabel}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ),
        }}
      />
    );
  }
  return <ChangelogSettingsCard markdown={markdown} hideTitle />;
}
