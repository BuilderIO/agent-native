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
import { Label } from "@agent-native/toolkit/ui/label";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.metaTitle }];
}

export default function SettingsRoute() {
  const t = useT();
  useSetPageTitle(t("settings.title"));

  return (
    <div className="flex-1 overflow-auto">
      <SettingsTabsPage
        teamLabel={t("team.pageTitle")}
        general={
          <main className="mx-auto w-full max-w-3xl space-y-6">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.description")}
            </p>

            <section className="rounded-lg border border-border bg-card p-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">
                  {t("settings.languageTitle")}
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("settings.languageDescription")}
                </p>
              </div>
              <div className="mt-4 max-w-xs space-y-1.5">
                <Label>{t("settings.languageLabel")}</Label>
                <LanguagePicker label={t("settings.languageLabel")} />
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">
                  {t("settings.agentTitle")}
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("settings.agentDescription")}
                </p>
              </div>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => openAgentSettings()}
              >
                {t("settings.openAgentSettings")}
              </Button>
            </section>
          </main>
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("team.createOrgDescription")}
              className="max-w-3xl"
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-3xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </div>
  );
}
