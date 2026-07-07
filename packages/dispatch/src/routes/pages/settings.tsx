import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
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

import changelog from "../../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: "Settings - Dispatch" }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();

  return (
    <DispatchShell
      title={t("settings.title")}
      description={t("settings.description")}
    >
      <SettingsTabsPage
        extraTabs={agentSettingsTabs}
        general={
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
              <CardContent>
                <Button variant="outline" asChild>
                  <Link to="/workspace">
                    {t("settings.openResourceSettings")}
                  </Link>
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
    </DispatchShell>
  );
}
