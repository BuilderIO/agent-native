import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Label } from "@agent-native/toolkit/ui/label";

import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  useSetPageTitle(t("settings.title"));

  return (
    <SettingsTabsPage
      teamLabel={t("header.team")}
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.editorTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.editorDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" asChild>
                <a
                  href="https://marketplace.visualstudio.com/items?itemName=Builder.agent-native"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("settings.openEditorExtension")}
                </a>
              </Button>
            </CardContent>
          </Card>
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
        <div className="mx-auto w-full max-w-3xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
