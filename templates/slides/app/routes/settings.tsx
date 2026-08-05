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
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useSlidesPrefs } from "@/hooks/use-slides-prefs";
import messages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.raw.routeSettingsTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));
  const { prefs, loading: prefsLoading, save: savePrefs } = useSlidesPrefs();

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "slides-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "slides-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notifications comments replies alerts",
        hash: "notifications",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      teamLabel={t("navigation.team")}
      extraTabs={agentSettingsTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
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
            <SettingsRow
              id="notifications"
              label={t("settings.emailNotifications")}
              description={t("settings.emailNotificationsDescription")}
              control={
                <Switch
                  aria-label={t("settings.emailNotifications")}
                  checked={prefs.emailNotifications !== false}
                  disabled={prefsLoading}
                  onCheckedChange={(checked) => {
                    savePrefs({ emailNotifications: checked }).catch((err) => {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : t("settings.saveFailed"),
                      );
                    });
                  }}
                />
              }
            />
          </SettingsGroup>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription={t("raw.teamDescription")}
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
