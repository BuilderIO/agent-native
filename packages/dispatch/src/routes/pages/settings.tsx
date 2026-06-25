import {
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";
import { Link } from "react-router";

import { DispatchShell } from "@/components/dispatch-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function meta() {
  return [{ title: "Settings - Dispatch" }];
}

export default function SettingsRoute() {
  const t = useT();

  return (
    <DispatchShell
      title={t("settings.title")}
      description={t("settings.description")}
    >
      <div className="mx-auto w-full max-w-3xl space-y-6">
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
      </div>
    </DispatchShell>
  );
}
