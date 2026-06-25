import {
  ChangelogSettingsCard,
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { Link } from "react-router";

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
  return [{ title: messages.raw.routeSettingsTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  useSetPageTitle(t("settings.title"));

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
        <CardContent>
          <Button variant="outline" asChild>
            <Link to="/team">{t("settings.openTeamSettings")}</Link>
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
