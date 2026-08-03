import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { IconBell } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import changelog from "../../CHANGELOG.md?raw";
import { useReplayStorageStatus } from "../hooks/use-replay-storage-status";
import { ReplayStorageHint } from "./sessions/SessionsPage";
import { AlertRulesSettingsCard } from "./settings/AlertRulesSettingsCard";
import { buildAnalyticsGeneralSettingsSearchEntries } from "./settings/settings-search";

export default function Settings() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  const replayStorageStatus = useReplayStorageStatus();

  const extraTabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "alerts",
        label: t("settings.alertsTitle"),
        icon: IconBell,
        keywords: "alerts rules notifications thresholds triggers monitoring",
        content: (
          <div className="mx-auto w-full max-w-5xl">
            <AlertRulesSettingsCard />
          </div>
        ),
      },
      ...agentSettingsTabs,
    ],
    [agentSettingsTabs, t],
  );

  const generalSearchEntries = useMemo(
    () =>
      buildAnalyticsGeneralSettingsSearchEntries(
        t,
        !!replayStorageStatus.data?.configured,
      ),
    [replayStorageStatus.data?.configured, t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      teamLabel={t("navigation.team")}
      whatsNewLabel={t("root.whatsNew")}
      extraTabs={extraTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <SettingsGroup className="bg-card border-border/50">
            <SettingsRow
              id="credentials"
              label={t("settings.credentials")}
              description={t("settings.credentialsDescription")}
              control={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/data-sources">
                    {t("settings.manageDataSources")}
                  </Link>
                </Button>
              }
            />
            <SettingsRow
              id="dashboard-templates"
              label={t("settings.dashboardTemplates")}
              description={t("settings.dashboardTemplatesDescription")}
              control={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/catalog">
                    {t("settings.openDashboardTemplates")}
                  </Link>
                </Button>
              }
            />
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
          </SettingsGroup>

          {replayStorageStatus.data?.configured ? (
            <Card
              id="replay-storage"
              className="bg-card border-border/50 scroll-mt-16"
            >
              <CardHeader>
                <CardTitle className="text-base">
                  {t("sessions.storageSetupTitle")}
                </CardTitle>
                <CardDescription>
                  {t("sessions.storageSetupDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReplayStorageHint embedded />
              </CardContent>
            </Card>
          ) : null}

          <Card id="about" className="bg-card border-border/50 scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">{t("settings.about")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{t("settings.aboutDescription")}</p>
              <p>{t("settings.aboutUsage")}</p>
            </CardContent>
          </Card>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-5xl">
          <TeamPage
            showTitle={false}
            createOrgDescription="Set up a team to share dashboards and data sources with your colleagues."
            className="max-w-5xl"
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
