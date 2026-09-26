import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  // Tasks embeds an ExtensionSlot in TaskFieldsSidebar and wires /extensions
  // into agent navigation, so the settings management tab must exist too —
  // otherwise the /settings/extensions destination silently falls back to General.
  const agentSettingsTabs = useAgentSettingsTabs({ extensionTools: true });
  // The redesigned Settings has no app rows here: core Preferences owns the
  // interface language.
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
  useSetPageTitle(t("header.pageSettings"));

  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      whatsNewMarkdown={changelog}
      general={
        redesign ? undefined : (
          <div className="mx-auto w-full max-w-2xl space-y-6">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("header.pageSettings")}
            </p>

            <SettingsGroup>
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
    />
  );
}
