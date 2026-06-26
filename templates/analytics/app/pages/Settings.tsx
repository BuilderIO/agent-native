import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import { Link } from "react-router";

import { useAuth } from "@/components/auth/AuthProvider";
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

export default function Settings() {
  const { auth } = useAuth();
  const t = useT();

  return (
    <SettingsTabsPage
      teamLabel={t("navigation.team")}
      whatsNewLabel={t("root.whatsNew")}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Card className="bg-card border-border/50">
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

          <Card className="bg-card border-border/50">
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

          <Card className="bg-card border-border/50">
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

          <Card className="bg-card border-border/50">
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

          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.agentTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {t("settings.agentDescription")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openAgentSettings()}
              >
                {t("settings.openAgentSettings")}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
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
        <div className="mx-auto w-full max-w-2xl">
          <TeamPage
            showTitle={false}
            createOrgDescription="Set up a team to share dashboards and data sources with your colleagues."
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
