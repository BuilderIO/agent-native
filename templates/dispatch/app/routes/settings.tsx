import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import { Button } from "@agent-native/dispatch/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/dispatch/components/ui/card";
import { Label } from "@agent-native/dispatch/components/ui/label";
import { Link } from "react-router";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();

  return (
    <SettingsTabsPage
      general={
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.languageTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.languageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="max-w-xs space-y-1.5">
              <Label>{t("settings.languageLabel")}</Label>
              <LanguagePicker label={t("settings.languageLabel")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.workspaceTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.workspaceDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" asChild>
                <Link to="/workspace">
                  {t("settings.openResourceSettings")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.agentTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.agentDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => openAgentSettings()}>
                {t("settings.openAgentSettings")}
              </Button>
            </CardContent>
          </Card>
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
        <div className="mx-auto w-full max-w-3xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
