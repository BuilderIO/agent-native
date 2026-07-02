import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import { useSetPageTitle } from "@/components/layout/HeaderActions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import messages from "@/i18n/en-US";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.routeTitles.settingsForms }];
}

export default function SettingsRoute() {
  const t = useT();
  useSetPageTitle(t("settings.title"));

  return (
    <SettingsTabsPage
      teamLabel={t("navigation.team")}
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
            createOrgDescription="Set up a team to share forms and view responses together."
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
