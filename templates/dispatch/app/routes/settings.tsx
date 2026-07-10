import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useT,
  type SettingsSearchEntry,
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
import { useMemo } from "react";
import { Link } from "react-router";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "dispatch-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "dispatch-workspace",
        label: t("settings.workspaceTitle"),
        keywords: "workspace resources integrations vault destinations",
        hash: "workspace-resources",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <Card id="language" className="scroll-mt-16">
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

          <Card id="workspace-resources" className="scroll-mt-16">
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
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
