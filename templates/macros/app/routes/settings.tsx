import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

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
  return [{ title: messages.routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  return (
    <SettingsTabsPage
      teamLabel={t("team.title")}
      extraTabs={agentSettingsTabs}
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
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription={t("team.createOrgDescription")}
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
