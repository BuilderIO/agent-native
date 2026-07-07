import {
  SettingsTabsPage,
  ChangelogSettingsCard,
  LanguagePicker,
  useAgentSettingsTabs,
  useT,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settingsDesign }];
}

export default function SettingsRoute() {
  const agentSettingsTabs = useAgentSettingsTabs();
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <SettingsTabsPage
        extraTabs={agentSettingsTabs}
        general={
          <div className="mx-auto w-full max-w-2xl space-y-6">
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
              createOrgDescription={t("pages.teamCreateOrgDescription")}
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-2xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </div>
  );
}
