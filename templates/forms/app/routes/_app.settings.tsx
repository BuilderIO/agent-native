import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useMemo } from "react";

import messages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.routeTitles.settingsForms }];
}

export default function SettingsRoute() {
  const t = useT();
  // /extensions redirects here and the agent's own navigate instructions list
  // "extensions" as a workspace view, so the settings tab must exist too —
  // otherwise /settings/extensions silently falls back to General.
  const agentSettingsTabs = useAgentSettingsTabs({ extensionTools: true });
  // The redesigned Settings has no app rows here: core Preferences owns the
  // interface language.
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
  useSetPageTitle(t("settings.title"));

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "forms-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={agentSettingsTabs}
      generalSearchEntries={redesign ? undefined : generalSearchEntries}
      general={
        redesign ? undefined : (
          <div className="mx-auto w-full max-w-2xl space-y-6">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.description")}
            </p>

            <SettingsGroup className="forms-settings-card">
              <SettingsRow
                id="language"
                label={t("settings.languageTitle")}
                description={t("settings.languageDescription")}
                control={
                  <div className="w-56">
                    <LanguagePicker label={t("settings.languageLabel")} />
                  </div>
                }
              />
            </SettingsGroup>
          </div>
        )
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
