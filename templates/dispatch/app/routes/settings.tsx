import {
  ChangelogSettingsCard,
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
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
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("settings.title")}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("settings.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.languageTitle")}
          </CardTitle>
          <CardDescription>{t("settings.languageDescription")}</CardDescription>
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
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/team">{t("settings.openTeamSettings")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/workspace">{t("settings.openResourceSettings")}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.agentTitle")}
          </CardTitle>
          <CardDescription>{t("settings.agentDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => openAgentSettings()}>
            {t("settings.openAgentSettings")}
          </Button>
        </CardContent>
      </Card>

      <ChangelogSettingsCard markdown={changelog} />
    </main>
  );
}
