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

import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  // /extensions redirects here and navigation.view supports "extensions"
  // (see use-navigation-state.ts), so the settings tab must exist too —
  // otherwise /settings/extensions silently falls back to General.
  const agentSettingsTabs = useAgentSettingsTabs({ extensionTools: true });
  // Core Preferences owns the interface language in the redesigned Settings,
  // so Plan › General keeps only the editor row.
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
  useSetPageTitle(t("settings.title"));

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      ...(redesign
        ? []
        : [
            {
              id: "plan-language",
              label: t("settings.languageTitle"),
              keywords: "language locale translation i18n",
              hash: "language",
            },
          ]),
      {
        id: "plan-editor",
        label: t("settings.editorTitle"),
        keywords: "editor extension vscode ide",
        hash: "editor",
      },
    ],
    [redesign, t],
  );

  const editorRow = (
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
            {editorRow}
          </SettingsGroup>
        </div>
      }
      generalGroups={
        <SettingsGroup title={t("settings.editorGroupTitle")}>
          {editorRow}
        </SettingsGroup>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
