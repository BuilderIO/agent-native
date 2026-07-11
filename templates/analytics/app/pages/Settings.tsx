import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useSession,
  useT,
  type SettingsSearchEntry,
  type SettingsTabItem,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
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

export default function Settings() {
  // Settings is also reachable directly from the full-page agent surface.
  // Read the session from the framework's owning AppProviders boundary rather
  // than the template-local compatibility context, which may be remounted
  // independently during that route transition.
  const { session: auth } = useSession();
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

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "analytics-account",
        label: t("settings.account"),
        keywords: "profile email signed in identity",
        hash: "account",
      },
      {
        id: "analytics-credentials",
        label: t("settings.credentials"),
        keywords: "data sources api keys manage credentials",
        hash: "credentials",
      },
      {
        id: "analytics-dashboard-templates",
        label: t("settings.dashboardTemplates"),
        keywords: "templates catalog dashboards",
        hash: "dashboard-templates",
      },
      ...(replayStorageStatus.data?.configured
        ? [
            {
              id: "analytics-replay-storage",
              label: t("sessions.storageSetupTitle"),
              keywords: "session replay recording storage s3 bucket builder",
              hash: "replay-storage",
            },
          ]
        : []),
      {
        id: "analytics-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "analytics-about",
        label: t("settings.about"),
        keywords: "about version info usage",
        hash: "about",
      },
    ],
    [replayStorageStatus.data?.configured, t],
  );

  return (
    <SettingsTabsPage
      teamLabel={t("navigation.team")}
      whatsNewLabel={t("root.whatsNew")}
      extraTabs={extraTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Card id="account" className="bg-card border-border/50 scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.account")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {auth && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("settings.signedInAs")}
                  </span>
                  <span className="text-sm font-medium">{auth.email}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card
            id="credentials"
            className="bg-card border-border/50 scroll-mt-16"
          >
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.credentials")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {t("settings.credentialsDescription")}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/data-sources">
                  {t("settings.manageDataSources")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card
            id="dashboard-templates"
            className="bg-card border-border/50 scroll-mt-16"
          >
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.dashboardTemplates")}
              </CardTitle>
              <CardDescription>
                {t("settings.dashboardTemplatesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link to="/catalog">
                  {t("settings.openDashboardTemplates")}
                </Link>
              </Button>
            </CardContent>
          </Card>

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
                <ReplayStorageHint />
              </CardContent>
            </Card>
          ) : null}

          <Card id="language" className="bg-card border-border/50 scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.languageTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="max-w-xs space-y-1.5">
              <Label>{t("settings.languageLabel")}</Label>
              <LanguagePicker label={t("settings.languageLabel")} />
            </CardContent>
          </Card>

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
