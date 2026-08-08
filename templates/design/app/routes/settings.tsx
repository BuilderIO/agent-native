import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import {
  CreativeContextSettingsLink,
  createCreativeContextAgentTab,
} from "@agent-native/creative-context/client";
import { useMemo } from "react";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settingsDesign }];
}

export default function SettingsRoute() {
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories: [createCreativeContextAgentTab],
  });
  const t = useT();

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "design-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        extraTabs={agentSettingsTabs}
        generalSearchEntries={generalSearchEntries}
        general={
          <div className="mx-auto w-full max-w-2xl space-y-6">
            <CreativeContextSettingsLink />

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
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("pages.teamCreateOrgDescription")}
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-2xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </div>
  );
}
