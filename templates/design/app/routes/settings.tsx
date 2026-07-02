import {
  SettingsPanel,
  SettingsTabsPage,
  useDevMode,
  ChangelogSettingsCard,
  LanguagePicker,
  openAgentSettings,
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
  const { isDevMode, canToggle, setDevMode } = useDevMode();
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <SettingsTabsPage
        general={
          <>
            <SettingsPanel
              isDevMode={isDevMode}
              onToggleDevMode={() => setDevMode(!isDevMode)}
              showDevToggle={canToggle}
            />
            <div className="mx-auto w-full max-w-2xl px-4 pb-8">
              <Card className="mb-6">
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
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("settings.agentTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.agentDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <button
                    type="button"
                    className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openAgentSettings()}
                  >
                    {t("settings.openAgentSettings")}
                  </button>
                </CardContent>
              </Card>
            </div>
          </>
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
