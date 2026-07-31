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
import { CreativeContextSettingsLink } from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useMemo } from "react";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.metaTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "content-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <div className="flex-1 overflow-auto">
      <SettingsTabsPage
        account={<AccountSettingsCard />}
        teamLabel={t("team.pageTitle")}
        extraTabs={agentSettingsTabs}
        generalSearchEntries={generalSearchEntries}
        general={
          <main className="mx-auto w-full max-w-2xl space-y-6">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.description")}
            </p>

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
          </main>
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("team.createOrgDescription")}
              className="max-w-3xl"
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
