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
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { CONTENT_EXPERIMENTS } from "@shared/experiments";
import { useMemo } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useContentPrefs } from "@/hooks/use-content-prefs";
import { useCreativeContextExperiment } from "@/hooks/use-creative-context-experiment";
import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.metaTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  const creativeContextEnabled = useCreativeContextExperiment();
  const agentAdditionalTabFactories = useMemo(
    () => (creativeContextEnabled ? [createCreativeContextAgentTab] : []),
    [creativeContextEnabled],
  );
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories,
  });
  useSetPageTitle(t("settings.title"));
  const { prefs, loading: prefsLoading, save: savePrefs } = useContentPrefs();

  const experiments = useMemo(
    () =>
      CONTENT_EXPERIMENTS.map((experiment) => ({
        ...experiment,
        displayName: t("settings.experimentCreativeContext", {
          defaultValue: experiment.displayName ?? "Creative Context",
        }),
        description: t("settings.experimentCreativeContextDescription", {
          defaultValue:
            experiment.description ??
            "Connect and reuse governed reference context in Content.",
        }),
      })),
    [t],
  );

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "content-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "content-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notifications comments replies mentions alerts",
        hash: "notifications",
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
        experiments={experiments}
        experimentsIntro={t("settings.experimentsIntro", {
          defaultValue: "Preview experimental features before they ship.",
        })}
        experimentsLabel={t("settings.experiments", {
          defaultValue: "Experiments",
        })}
        generalSearchEntries={generalSearchEntries}
        general={
          <main className="mx-auto w-full max-w-2xl space-y-6">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.description")}
            </p>

            {creativeContextEnabled ? <CreativeContextSettingsLink /> : null}

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
                      savePrefs({ emailNotifications: checked }).catch(
                        (err) => {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : t("settings.saveFailed"),
                          );
                        },
                      );
                    }}
                  />
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
