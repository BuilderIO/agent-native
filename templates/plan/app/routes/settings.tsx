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
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "plan-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "plan-editor",
        label: t("settings.editorTitle"),
        keywords: "editor extension vscode ide",
        hash: "editor",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      teamLabel={t("header.team")}
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
              id="editor"
              label={t("settings.editorTitle")}
              description={t("settings.editorDescription")}
              control={
                <Button variant="outline" asChild>
                  <a
                    href="https://marketplace.visualstudio.com/items?itemName=Builder.agent-native"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t("settings.openEditorExtension")}
                  </a>
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
            createOrgDescription="Set up a team to share this app with your colleagues."
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
