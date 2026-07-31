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
import { Button } from "@agent-native/dispatch/components/ui/button";
import { useMemo } from "react";
import { Link } from "react-router";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "dispatch-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "dispatch-workspace",
        label: t("settings.workspaceTitle"),
        keywords: "workspace resources integrations vault destinations",
        hash: "workspace-resources",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={agentSettingsTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
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
            <SettingsRow
              id="workspace-resources"
              label={t("settings.workspaceTitle")}
              description={t("settings.workspaceDescription")}
              control={
                <Button variant="outline" asChild>
                  <Link to="/workspace">
                    {t("settings.openResourceSettings")}
                  </Link>
                </Button>
              }
            />
          </SettingsGroup>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription="Set up a team to share dispatch destinations and approvals with your colleagues."
          />
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
